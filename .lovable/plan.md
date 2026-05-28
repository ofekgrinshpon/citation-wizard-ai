## Goal

Stop shipping answers that are internally valid (hard gates green, sources correct) but visibly untrustworthy — adjacent superscript runs like `⁸⁹¹⁰` when only 9 sources exist, end-of-paragraph citation dumps, and broken Hebrew phrases. Do this with a narrow post-drafter quality gate + at most one targeted regeneration call against the same fixed source set.

Out of scope (explicitly unchanged): retrieval, verifier, candidate pool, source selection, sources-only path, DB schema, frontend, Phase 3 compound logic, tokenizer conservatism, marker movement, body separators (commas/thin spaces).

## Where it lives

A new module `supabase/functions/legal-research-v1/stages/qualityGate.ts` invoked from `index.ts` immediately after `runDrafter` (around line 595), before `writeTelemetry` and the response is built. No new edge function, no new stage in the pipeline contract.

`runDrafter` itself is not modified. The gate wraps it:

```text
drafter(initial) → quality_gate.evaluate
   pass  → ship initial
   fail  → drafter(retry, same sources, stricter presentation system msg)
           → quality_gate.evaluate
              pass  → ship retry
              fail  → controlled_failure response
```

## Quality gate triggers

Computed from the drafter result (`answer_markdown`, `used_sources`, `marker_validation`, `marker_validation.citation_cleanup.phase3`, `marker_validation.placement`):

1. `phase3.discarded_reason === "ambiguous_raw_superscript_run"` **and** `placement.max_cluster_len >= 4`
2. `placement.end_paragraph_dump_count > 0`
3. `placement.cluster_run_count >= 8` **or** `placement.cluster_count >= 15`
4. **Phantom-footnote heuristic**: any adjacent superscript-digit run in the body that, under either per-char parsing or any contiguous-digit grouping, yields a marker number `> used_sources.length`. Example with 9 sources: `⁸⁹¹⁰` ⇒ contains `10` which is `> 9`. This is the strongest user-visible signal and the one that motivated this gate.
5. **Hebrew artifact denylist** present in the answer (case/whitespace-insensitive, word-boundary-aware):
   `שורת התחתית`, `המשדר להפרה`, `בפברגים`, `זהות של פגיעים`, `סעדיים`, `הצהריתיות`, `מנגנון מעשיר של פיקוח`.
   Kept as a constant `LANGUAGE_ARTIFACTS` so it can grow over time. No NLP, no model call.

Any single trigger fires the retry. The list of fired triggers is recorded in telemetry.

## Retry behavior (one shot, max)

Call `runDrafter` again with:
- **identical inputs**: same `question`, `claims`, `candidates`, `verifier.usable/verdicts`, same `userDocs`, same `useAsSource`, same `atomicMode`;
- a **presentation-only addendum** appended to the existing `SYSTEM_PROMPT` (via a new optional `runDrafter` opt: `extraSystemSuffix?: string`). The drafter does not lose any current rules; it only gains:

  ```
  המהות המשפטית ומאגר המקורות קבועים. נסח מחדש את התשובה באמצעות אותם מקורות בלבד, בלי להוסיף או להסיר מקור. שפר את מיקום האזכורים ואת איכות העברית.
  אל תניח שני סימני הערה זה לצד זה. אל תיצור רצפים כגון ¹²³ או ⁸⁹¹⁰, ואל תיצור שום רצף ספרות־על שאפשר לקרוא כמספר הערה שאינו קיים.
  אם כמה מקורות תומכים באותה טענה — נסח אותה כטענה אחת מתומכת־ריבוי שתאסף תחת הערה אחת, או פצל את הטענות למשפטים נפרדים, כל אחת עם המקור שלה.
  אל תרכז אזכורים בסוף פסקה. אל תסיים בסיכום עם מצבור מקורות.
  כתוב עברית משפטית ישראלית טבעית; אל תייצר ביטויים מעוותים כגון "שורת התחתית", "בפברגים", "סעדיים", "הצהריתיות", "מנגנון מעשיר של פיקוח".
  ```

- The retry passes through the same downstream pipeline already inside `runDrafter`: marker validation, citation cleanup phases 1/2, Phase 3 v3 compound. No bypass.

### Source-set invariance hard check on retry

Before considering the retry shippable:
- `retry.used_sources.map(s => s.candidate_id).sort()` MUST equal the initial set.
- Counts must match. If a source was dropped or added, the retry is discarded and treated as failed gate (forces controlled failure rather than silently shipping a different source set).

## Fail-closed behavior

If the retry also fails the gate (or violates source-set invariance):
- Return a controlled error payload from the edge function. Shape mirrors existing error responses:
  ```json
  { "error": "answer_quality_gate_failed",
    "user_message": "לא הצלחנו להפיק תשובה עם אזכורים תקינים מספיק. נסו להריץ שוב או לנסח את השאלה באופן ממוקד יותר.",
    "debug": { "quality_gate": { ... } } }
  ```
- HTTP 200 with `error` field (consistent with current sources_only / verifier error handling), so the existing `LegalResearchV1Panel` already-present error rendering path shows it. No frontend change.
- Telemetry still written with `final_action = "controlled_failure"` so we can measure how often this last resort triggers.

## Telemetry

Add to the `metadata` block written by `writeTelemetry` a new `quality_gate` object:

```ts
quality_gate: {
  triggered: boolean,
  reasons: string[],                 // e.g. ["phantom_footnote_run", "end_paragraph_dump", "lang_artifact:בפברגים"]
  retry_attempted: boolean,
  retry_passed: boolean,
  final_action: "shipped_initial" | "shipped_retry" | "controlled_failure",
  source_set_equal_on_retry: boolean | null,
  language_artifact_count_initial: number,
  language_artifact_count_final: number,
  before: {
    cluster_count, cluster_run_count, max_cluster_len,
    end_paragraph_dump_count,
    phase3_applied, phase3_discarded_reason,
    compound_group_count,
    ambiguous_run_samples,           // copied from phase3.ambiguous_run_samples (truncated)
  },
  after: { /* same shape; null when no retry */ },
  extra_drafter_ms: number,          // 0 when no retry
}
```

`metadata.drafter` keeps pointing at the **shipped** drafter result so existing consumers (history rehydration, panel, runners) see one consistent answer/marker_validation. The initial run is preserved under `metadata.quality_gate_drafter_initial` for debugging only.

## Minimal code changes

1. **New file** `supabase/functions/legal-research-v1/stages/qualityGate.ts`
   - `LANGUAGE_ARTIFACTS: string[]`
   - `evaluateQualityGate(drafterResult, usedSourcesCount): { triggered, reasons, metrics }`
   - `detectPhantomFootnoteRuns(answer, maxValidMarker): { found, samples }`
   - Pure functions, no I/O, fully unit-testable in `qualityGate.test.ts`.
2. **`stages/drafter.ts`**: add optional `extraSystemSuffix?: string` to `runDrafter` opts. When present, append it to `SYSTEM_PROMPT` for both attempts. No other behavior change.
3. **`index.ts`** (around the existing drafter call, ~lines 588–620):
   - Call `evaluateQualityGate(drafter, ...)`.
   - If `triggered`, call `runDrafter` again with `extraSystemSuffix = RETRY_PRESENTATION_ADDENDUM`, measure `extra_drafter_ms`, validate source-set invariance, re-evaluate gate.
   - Choose `finalAnswer` / `finalFootnotes` / `drafterMeta` based on `final_action`.
   - On `controlled_failure`, short-circuit with the error response **after** writing telemetry.
4. **`lib/types.ts`**: add `QualityGateReport` interface; no changes to existing types.

No changes to: `localRetrieval.ts`, `perplexityRetrieval.ts`, `verifier.ts`, `candidatePool.ts`, `claimAnalyzer.ts`, `queryPlanner.ts`, `sourcesOnly.ts`, `attachments.ts`, frontend components, DB.

## Acceptance gates (must all hold)

- Source set identical between initial and shipped result on every shipped retry.
- All hard grounding gates remain green on shipped answers (`marker_validation_ok`, no `internal_id_leak`, `used ⊆ usable`, `footnote_eq_used`).
- Zero token leaks (`[[fn:…]]`) in shipped answer.
- No phantom-footnote run (no superscript run reads as `> used_sources.length`) in any shipped answer.
- `end_paragraph_dump_count` = 0 or strictly improved on shipped retry.
- `max_cluster_len` strictly reduced on shipped retry.
- No item from `LANGUAGE_ARTIFACTS` present in shipped answer.
- Phase 3 applies when achievable; otherwise `phase3.discarded_reason` is set (unchanged behavior).
- At most one extra `runDrafter` call per request. Clean answers pay zero extra latency (gate is pure JS over already-computed fields, sub-ms).

## Validation plan

New runner `scripts/legal-research-v1-quality-gate-runner.ts` (mirrors compound runner shape), driving the same fixtures: `T1, T2, T3, PROT, L1–L6, RPT1–RPT3` (+ explicit re-run of the exact PROT question that produced the failure).

Per-fixture report `reports/legal-research-v1-quality-gate-<id>.json` and aggregate `…-summary.json` with:
- counts: `triggered`, `retry_attempted`, `retry_passed`, `controlled_failure`;
- per-fixture before/after metrics listed under telemetry above;
- latency delta only on triggered fixtures (`extra_drafter_ms`);
- 3 before/after cluster snippet pairs and 3 before/after Hebrew-artifact pairs;
- source-set equality verdict for every retry;
- list of any controlled failures with their reasons.

Stop after the validation report; no rollout flag flip in this step beyond the gate itself being on by default (it is fail-safe — clean answers go through untouched). If we want a kill switch, expose `LRV1_QUALITY_GATE = "off" | "on"` (default `"on"`) read once at module load; setting `"off"` reverts to current behavior with zero code path change beyond a single early `return drafter`.
