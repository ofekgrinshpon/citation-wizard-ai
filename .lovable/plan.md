## Academic Writing — current architecture

Academic Writing is **not a separate edge function**. It rides inside `supabase/functions/legal-qa/index.ts`, gated by `taskMode === "academic_writing"` plus an `academicStep` field. The whole feature is a **state machine over four sub-modes** that share the legal-qa retrieval/drafting plumbing:

```text
Frontend wizard (LegalQAChat.tsx + academic_sessions table)
  │
  ├─ suggest_topics      ─┐
  ├─ validate_question    │  cost = 0
  ├─ propose_outline     ─┘  light path: keyword search + single LLM call,
  │                          NO claim map / NO Stage 5e / NO anchor pass
  │
  ├─ write_chapter (isAbstract=true)  cost = 8
  │     pure synthesis of prior chapters, NO new citations,
  │     same light path as above
  │
  └─ write_chapter (real chapter)      cost = 8
        enableDeepPipeline = true  →  forced to MODE_PROFILES.deep
        full Frame→Decompose→Plan→Retrieve→Rank→SourcePack→ClaimMap→Draft
        Stage 5e + anchor pass + citation engine resolver all run
        Academic system prompt is PREPENDED to the structured drafter prompt
        Outline-aware: parses thesis / line-of-argument / chapter role /
                       counter-arguments / sibling titles from body.outline
```

Key contracts:
- `enableDeepPipeline = (taskMode === RESEARCH_MODE) || isAcademicChapter` — single gate that drives every Deep stage.
- For chapters, `modeProfile` is **force-overridden** to `MODE_PROFILES.deep` after `resolveModeProfile`, so any `depth` from the body is ignored.
- The legacy fallback drafter (claim-map miss path) reads `modeProfile.wordRangeMin/Max` for chapters so degraded runs no longer collapse to 500–1200 words.
- Academic persona ("חוקר אקדמי בכיר", narrative citations, high-register Hebrew) is preserved by prepending `getAcademicSubModePrompt("write_chapter", body)` to the Deep structured prompt.
- Cost: sub-modes free, abstract synthesis 8, real chapter 8 (not 5 like research).

Frontend:
- `taskMode` toggle in `LegalQAChat.tsx` (one of four).
- Wizard state persisted to `academic_sessions` table (cross-device resume).
- `academic_writing` does **NOT** show the Fast/Deep toggle — it's research-only by design.

## Legal Research — Fast/Deep architecture (what we're comparing against)

`MODE_PROFILES` config object in `modeProfiles.ts` is the single source of truth:
- Two profiles (`fast`, `deep`), every per-mode difference is a typed field.
- `index.ts` reads `modeProfile.X` everywhere — zero `if (deep)` branches.
- Telemetry: each `qa_logs.metadata.profile_used` records the exact resolved profile so eval runs can compare modes on identical questions.
- Mode-aware QA guard: `qaGuardExcessiveTriggerThreshold` differs between Fast (5) and Deep (8); the guard surfaces flags in `qa_logs.metadata.statute_completion.qa_guard` with no behavior change.
- Locked architectural invariants (Fast + Deep both): anchor pass = primary, Stage 5e = fallback gated by source-pack coverage + anchor proximity (±240 chars), sentence-end placement only.
- Validated by a dedicated eval harness (`eval/deep-mode-q1-q6-q21.mjs`, before/after JSON snapshots, qualitative answer text captured).

## What's worth adopting — recommendation

Three patterns from the Fast/Deep system map cleanly onto Academic and would make it materially safer to iterate. One pattern looks attractive but should be **rejected** for academic.

### 1. Adopt: a typed `AcademicProfile` (single source of truth)

Today, academic-specific knobs are spread across `index.ts` as ad-hoc constants and inline overrides:
- Force-override to `MODE_PROFILES.deep` (line ~1842).
- Hardcoded chapter `creditCost = 8` (line ~1831).
- Hardcoded abstract word cap of 250 inside the prompt (line ~1235).
- Hardcoded `chunk?.content?.slice(0, 2000)` for previous-chapter context (line ~1251).
- Hardcoded 12,000-char document context limit.
- Hardcoded outline parsing regexes.

Mirror what `MODE_PROFILES` did for research. Create a small `academicProfiles.ts`:

```text
ACADEMIC_PROFILES = {
  chapter: {
    inheritsFrom: "deep",         // explicit, not a hidden override
    creditCost: 8,
    prevChapterContextChars: 2000,
    documentContextChars: 12000,
    drafterPersona: "academic-senior",
  },
  abstract: { wordCap: 250, creditCost: 8, ... },
  outline:  { creditCost: 0, ... },
  topics:   { creditCost: 0, ... },
  validate: { creditCost: 0, ... },
}
```

Why: today changing the chapter envelope or the prev-chapter context window means hunting through `index.ts`. With a profile, every academic-specific knob is one `git grep` away and is auto-logged via `metadata.profile_used`.

### 2. Adopt: mode-aware QA guard for chapters

The QA guard is the cheapest, lowest-risk win from the Deep eval batch. For chapters, we have a clear analogue: the **citation engine resolver** already records `chapter_engine = {resolved_count, unresolved_count, drop_reasons}` in `qa_logs.metadata`. We're not yet **flagging regressions** off it.

Add `qaGuardChapter` flags computed at end of chapter generation:
- `unresolved_share` — `unresolved_count / max(total_footnotes, 1)`. Flag if > 0.4.
- `under_word_floor` — answer length < `modeProfile.wordRangeMin`. Currently we silently let claim-map-miss runs collapse; this surfaces it.
- `narrative_citation_violation` — body contains `[N]` markers without a matching narrative phrase ("בעניין X", "פרופ' Y סבור"). Academic style requires narrative citations; Deep's structured drafter doesn't enforce this.
- `any_flag` — OR of the above, with a `[chapter][qa_guard]` warning log.

This is observability-only, no behavior change, and gives us the same ability we have for research to catch regressions in CI/eval without re-reading the answer.

### 3. Adopt: a chapter eval harness modeled on `deep-mode-q1-q6-q21.mjs`

Today academic changes ship without any structured before/after measurement. The Deep batch we just ran (Q1/Q6/Q21, captured `answer_full` for qualitative diff, `anchored_count`, `wall_ms`, `qa_guard`) is the right template.

Create `eval/academic-chapter-q1-q3.mjs`:
- 3 fixed (research_question, outline, chapter_index, prev_chapters) tuples spanning a constitutional, statutory, and theoretical chapter.
- Capture `answer_words`, `anchored_count`, `unresolved_share`, `narrative_violation_count`, `chapter_engine.drop_reasons`, `wall_ms`, `answer_full`.
- Same before/after report layout we used for Deep.

This is what made the Deep partial-revert decision possible — without it, we couldn't have rejected the soft-target tuning with confidence. Academic deserves the same baseline.

### 4. Reject: a Fast/Deep toggle for chapters

It's tempting to symmetrise — give academic chapters their own Fast/Deep toggle. **Don't.** The Deep eval showed that Fast's *prompt language* (soft-target footnotes, smaller envelope) does not transfer cleanly to a richer envelope, and chapters are explicitly the richest envelope in the system (1200–2000 words, hard footnote floor, gpt-5 drafter, narrative citations). A "Fast academic chapter" would either be a worse chapter or a reskinned Fast research answer — neither is a real product.

Keep chapter writes locked to Deep. The toggle stays research-only, as today.

## Sequencing if approved

The three "adopt" items are independent and can ship in any order, but the natural order is:

1. **Eval harness first** — gives us a baseline before any structural change.
2. **`AcademicProfile` extraction** — pure refactor, no behavior change; eval should produce identical numbers before/after.
3. **QA guard** — observability layer on top of the new profile, validated by re-running the same eval and confirming flags fire on known-bad chapters from the qa_logs history.

## Files this would touch

- `supabase/functions/legal-qa/academicProfiles.ts` (new) — typed `ACADEMIC_PROFILES` and `resolveAcademicProfile()`.
- `supabase/functions/legal-qa/index.ts` — replace inline academic constants/overrides with profile reads; add `qaGuardChapter` block alongside the existing `chapter_engine` telemetry.
- `eval/academic-chapter-q1-q3.mjs` (new) — chapter eval harness.
- `.lovable/memory/features/academic-writing-mode/deep-pipeline-wiring.md` — update to reference the new profile + guard.

No DB migrations, no frontend changes, no new secrets.
