---
name: Academic Chapter — Deep Pipeline Wiring
description: Academic chapter writes opt into the full Deep research pipeline (modeProfile, Stage E.5, citation engine resolver) via enableDeepPipeline gate, with a typed AcademicProfile and a chapter QA guard mirroring the research grounding architecture
type: feature
---

Academic chapter writes (`taskMode === "academic_writing"` + `academicStep === "write_chapter"` + not `isAbstract`) flow through the **same Deep pipeline** as research mode.

### Mechanism

A single `enableDeepPipeline = (taskMode === RESEARCH_MODE) || isAcademicChapter` gate (defined right after `isAcademicChapter` is computed in `legal-qa/index.ts`) replaces every bare `taskMode === RESEARCH_MODE` check that gates Deep behavior. For chapters, `modeProfile` is force-overridden to `MODE_PROFILES.deep` after `resolveModeProfile` — any `depth` from the body is ignored.

### What chapters now inherit

- **Decomposition + planner + claim map** (Frame → Decompose → Plan → Retrieve → Rank → SourcePack → ClaimMap → Draft).
- **Stage E.5 Perplexity completion** when `core < perplexityCompletionMinAnchored` (6 in Deep).
- **Round-2 retrieval** (Deep profile has `retrievalRounds: 2`).
- **Anchor pass** (Deep profile has `anchorPassEnabled: true`).
- **Structured drafter** (`gpt-5` legacy variant per Deep profile) with the **5-section Deep scaffold** and the hard 1200-word floor language.
- **Citation engine resolver** runs on `finalFootnotes` post-parse; canonical re-emission overwrites `fn.citation` when resolved. Telemetry in `qa_logs.metadata.chapter_engine = {resolved_count, unresolved_count, drop_reasons}`.

### Typed `AcademicProfile` (single source of truth)

`supabase/functions/legal-qa/academicProfiles.ts` mirrors the `MODE_PROFILES` pattern. `ACADEMIC_PROFILES` defines five sub-modes (`topics`, `validate`, `outline`, `abstract`, `chapter`) with typed knobs:

- `creditCost` (0 / 0 / 0 / 8 / 8)
- `prevChapterContextChars` (chapter: 2000)
- `documentContextChars` (chapter: 12000, others: 6000)
- `abstractWordCap` (abstract: 250)
- `enableDeepPipeline` + `inheritsFrom: "deep" | null` (chapter only)
- `qaGuardUnresolvedShareThreshold`, `qaGuardUnderWordFloorRatio`, `qaGuardNarrativeViolationThreshold`

`resolveAcademicProfile(academicStep, isAbstract)` returns `{ step, profile }`. `index.ts` reads `creditCost` and `documentContextChars` from the profile; previously these were hardcoded.

The resolved profile is logged into `qa_logs.metadata.profile_used_academic = { step, ...profile }`.

### Chapter QA guard

After the chapter-engine resolver loop, a `chapterQaGuard` block is computed (chapters only) and written to `qa_logs.metadata.chapter_qa_guard`. It mirrors `statute_completion.qa_guard` — pure observability, zero behavior change. Three flags:

- `high_unresolved_share` — `unresolved_count / total_footnotes > qaGuardUnresolvedShareThreshold` (default 0.4). Citation engine dropping too many candidates.
- `under_word_floor` — body words < `modeProfile.wordRangeMin × qaGuardUnderWordFloorRatio` (Deep × 0.7 = 840). Catches silent claim-map-miss collapses.
- `narrative_violation` — number of `[N]` markers without a narrative phrase ("בעניין X", "פרופ' Y", "ועדת Z", "השופט", "פס״ד", "חוק") within ±120 chars before the marker, ≥ `qaGuardNarrativeViolationThreshold` (default 3). Academic style mandates narrative citations.

`any_flag` ORs the three. When set, the function logs `[chapter][qa_guard] flags raised: ...`.

#### Diagnostic query

```sql
SELECT created_at,
       metadata->'chapter_qa_guard' AS guard,
       metadata->'profile_used_academic'->>'step' AS step
FROM qa_logs
WHERE task_mode = 'academic_writing'
  AND (metadata->'chapter_qa_guard'->>'any_flag') = 'true'
ORDER BY created_at DESC
LIMIT 50;
```

### Eval harness

`eval/academic-chapter-q1-q3.mjs` mirrors `deep-mode-q1-q6-q21.mjs`: 3 fixtures (constitutional-admin, statute-anchored, theoretical) × 1 rep, captures `answer_full` for qualitative diff plus `chapter_engine`, `chapter_qa_guard`, and `profile_used_academic`. `PHASE=before/after` for diff runs.

### Academic persona preserved + outline context

The academic system prompt (`getAcademicSubModePrompt("write_chapter", body)` — "חוקר אקדמי בכיר", high-register Hebrew, narrative citations, 12,000-char document context) is **prepended** to the structured drafter prompt when `useStructuredDrafterPath && isAcademicChapter`. The chapter prompt parses `body.outline` for thesis, line of argument, the current chapter's description and counter-arguments, plus the titles of all other chapters.

### Word envelope alignment

The legacy fallback drafter path reads `${modeProfile.wordRangeMin}-${modeProfile.wordRangeMax}` when `isAcademicChapter`, so a claim-map miss no longer collapses chapter length to 500–1200.

### Research question lock

`propose_outline` opens with: "שאלת המחקר שלהלן היא קבועה ואין לשנותה…". The user's RQ is interpolated **verbatim** into the מבוא section's "שאלת המחקר:" line.

### Cost / billing

Chapter cost stays at 8 credits — sourced from `ACADEMIC_PROFILES.chapter.creditCost`.

### Files

- `supabase/functions/legal-qa/academicProfiles.ts` — typed profiles + resolver.
- `supabase/functions/legal-qa/index.ts` — `enableDeepPipeline`, profile override, structured-drafter prompt prepend, post-parse engine resolver loop, `chapter_qa_guard` block, `profile_used_academic` metadata.
- `supabase/functions/legal-qa/modeProfiles.ts` — unchanged; chapters consume the existing `deep` profile.
- `eval/academic-chapter-q1-q3.mjs` — chapter eval harness.
- `supabase/functions/_shared/citationResolver.ts` — unchanged; reused on chapter output.

### Not adopted from Fast/Deep

- **Fast/Deep toggle for chapters** — rejected. Chapters are explicitly the richest envelope in the system; a "Fast academic chapter" would either be a worse chapter or a reskinned Fast research answer. Toggle stays research-only.
- **Shadow A/B logger** stays research-only to avoid extra background cost on chapters.
