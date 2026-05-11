
# Critic-Pass for Academic Chapters

## Goal

Insert a single, cheap **critic stage** between the structured drafter and post-processing for academic chapter writes (`write_chapter` non-abstract, `write_introduction`, `write_conclusion`). The critic audits the draft for claim coverage, footnote density, narrative-citation compliance, and ungrounded paragraphs, and — only when material issues are found — triggers **one** targeted revision pass.

This is the highest-leverage quality lever before touching retrieval or drafter models. Existing `chapterQaGuard` already computes most of the signals we need; today they are observability-only. The critic turns those signals (plus a claim-map coverage check the guard doesn't do) into an actionable revision.

## Scope (what this adds)

- New stage `critic` and conditional stage `revision` recorded in `qa_logs.metadata.stage_runs`.
- Only runs for academic chapter classes; Fast/Deep legal-QA paths are untouched.
- Strict latency / cost budget: at most one critic call + one revision call. Default off behind a feature flag for one shipping cycle, then on by default.

Out of scope: re-running retrieval, changing drafter model, multi-turn critique loops, critic-driven Perplexity completion.

## Architecture

```text
                  ┌────────── existing ──────────┐
  retrieval ─► claim_map ─► structured drafter ─► (current post-processing)
                                       │
                                       ▼
                              ┌──────────────────┐
                              │   critic pass    │   gpt-5-mini, JSON tool-call
                              │  (read-only)     │   inputs: draft + claimMap +
                              └────────┬─────────┘            sourcePack summary
                                       │
                       needs_revision? │ no ──► post-processing (unchanged)
                                       │
                                       ▼ yes
                              ┌──────────────────┐
                              │  revision pass   │   same drafter variant,
                              │ (targeted patch) │   constrained instructions
                              └────────┬─────────┘
                                       ▼
                              post-processing (unchanged)
```

## What the critic checks

Critic is given: the draft body (footnotes stripped for analysis but included for audit), the `claimMap` (which claims must be supported by which source IDs), a compact `sourcePack` summary (id → title/url/type/usable_for_analysis), and the academic profile thresholds.

Returns a JSON tool-call:

```text
{
  "verdict": "pass" | "revise",
  "issues": [
    {
      "kind": "missing_claim" | "ungrounded_paragraph" |
              "weak_narrative_citation" | "footnote_density_low" |
              "off_topic_paragraph" | "anchor_misuse",
      "severity": "low" | "medium" | "high",
      "evidence": "<≤200 chars quoted from draft>",
      "fix_hint": "<≤200 chars actionable suggestion>",
      "claim_id"?: "<from claimMap when applicable>",
      "source_ids"?: ["..."]
    }
  ],
  "coverage": {
    "claims_total": N,
    "claims_supported": M,
    "cards_total": K,
    "cards_cited": J
  }
}
```

Revision triggers iff:
- `verdict === "revise"` **and**
- at least one `high` issue, **or** ≥ 2 `medium` issues, **or** `claims_supported / claims_total < 0.7`.

## Revision pass

Same model + variant as the original drafter (`structuredDrafting` → `gpt-5-mini` primary). System prompt is a thin wrapper: keep the existing draft, apply ONLY these surgical fixes, do not introduce new citations outside the claim map, do not change tone, return the full revised chapter. The critic's `issues[]` are embedded verbatim.

Constraints:
- Single revision call, no loop.
- Same `aiMaxTokens` and `drafterTimeoutMs` as the original drafter.
- If the revision call fails or returns < 50 chars → fall back to the original draft (the critic remains advisory). Logged as `status: "error"` in `stage_runs`.

## Files & changes

1. **`supabase/functions/legal-qa/critic.ts`** (new, ~150 LOC)
   - `runChapterCritic({ draft, claimMap, sourcePack, profile, timeoutMs }): Promise<{ result: CriticResult | null, run: StageRun }>`.
   - Internally calls `callPlannerJSON` (already supports JSON tool-call + telemetry) with `stage: "critic"`, `reasoningEffort: "low"`, `timeoutMs: 25_000`.
   - Defines the tool schema above; `forceProvider` left unset (mirrors decomposition's provider preference).

2. **`supabase/functions/legal-qa/criticRevision.ts`** (new, ~80 LOC)
   - `runChapterRevision({ originalDraft, issues, drafterSystemPrompt, userMessage, variant, maxTokens, timeoutMs })`.
   - Builds a revision system prompt that prepends issues to the existing `drafterSystemPrompt` and calls `callDrafter` (non-streaming — revisions don't need SSE; they're a quick patch). Returns `{ text, modelUsed, run }`.

3. **`supabase/functions/legal-qa/index.ts`**
   - After the drafter block (~line 4549, right before post-processing kicks in), add:
     ```text
     if (isAcademicChapter && CRITIC_ENABLED && useStructuredDrafterPath && claimMap) {
       emitStage("critic", "running");
       const critic = await runChapterCritic(...);
       stageRuns.push(critic.run);
       if (shouldRevise(critic.result)) {
         emitStage("revision", "running");
         const revised = await runChapterRevision(...);
         stageRuns.push(revised.run);
         if (revised.text) { answerText = revised.text; drafterModelUsed = revised.modelUsed; }
       }
       emitStage("critic", "complete", `${critic.result?.issues.length ?? 0} ממצאים`);
     }
     ```
   - Wire feature flag: `const CRITIC_ENABLED = Deno.env.get("ACADEMIC_CRITIC_ENABLED") !== "false"` (default on, env can disable).
   - Extend `qa_logs.metadata` with `critic: { verdict, coverage, issues_summary }` for evals.

4. **`supabase/functions/legal-qa/academicProfiles.ts`**
   - Add per-step knobs: `criticEnabled: boolean`, `criticHighSeverityTriggers: number`, `criticMinCoverage: number` (default 0.7). Lets us tune introduction vs body vs conclusion independently.

5. **`eval/academic-critic-q1-q3.mjs`** (new)
   - 3 fixtures × `PHASE=before/after`. Captures: word count, footnote count, claims_supported ratio, narrative-violation count, total latency, and whether revision fired. Mirrors the existing `academic-chapter-q1-q3.mjs` harness so we can A/B before flipping the default.

6. **`.lovable/memory/features/academic-writing-mode/critic-pass.md`** (new memory)
   - Documents trigger thresholds, model, fallback semantics, and the `qa_logs.metadata.critic` shape so future sessions don't re-derive it.

## Telemetry & observability

- `stage_runs` gains `critic` (always when enabled) and `revision` (only when triggered).
- `qa_logs.metadata.critic.coverage` enables a simple dashboard query: "what % of academic chapters needed revision, and did revised chapters score better on `chapterQaGuard`?"
- Existing `chapterQaGuard` block stays — it now measures the **post-revision** answer, which is exactly what we want.

## Latency & cost

Per academic chapter, additional budget when enabled:
- Critic: ~3–6s, `gpt-5-mini` low-reasoning, ~1–2k output tokens.
- Revision (fires on ~30–40% of runs based on current `chapterQaGuard` flag rate): ~10–18s, same drafter as today.
- Worst case: +20s on chapters that already take 45–70s. Acceptable for academic mode (users expect quality > speed).

If revision rate is materially higher than 40% on the first 50 real runs, tighten `criticMinCoverage` to 0.6 or require `high` severity for trigger.

## Rollout

1. Ship behind `ACADEMIC_CRITIC_ENABLED=false` default. Internal eval run with `--phase=after` on 3 fixtures.
2. Compare against the existing baseline (`academic-chapter-q1-q3.mjs`): claims_supported ratio, narrative-violation count, footnote density.
3. Flip default to enabled. Keep env kill-switch.
4. After ~2 weeks of telemetry, decide whether to also gate the legacy (non-structured) drafter path through the critic.

## Open questions worth confirming before implementation

- **Critic model choice**: `gpt-5-mini` (matches drafter) vs `gemini-2.5-flash` (cheaper, faster, but worse at strict Hebrew structured criticism). Default to `gpt-5-mini` unless you want to optimize for cost from day one.
- **Revision scope**: surgical patch (current plan) vs full re-draft using critic feedback as constraints. Surgical is faster and preserves tone but can leave deeper structural issues untouched.
- **Should the critic also see Perplexity-completion sources** (anchor-only) to flag "footnote-rich, analysis-poor" paragraphs? Recommended yes — it directly attacks one of the weaknesses identified earlier.
