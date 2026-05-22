# Batch Verifier (Priority 1)

Goal: collapse the verifier from N calls per claim (chunked at 8) to **one call per claim** covering all of its top candidates, while keeping the existing verdict schema, ledger contract, and downstream stages untouched.

## Current behavior (`supabase/functions/legal-qa/core/verifier.ts`)

- `verify()` runs per-claim tasks with a concurrency limiter (3).
- Inside each task, candidates are chunked `MAX_PER_CALL = 8` and `callJudge()` is invoked sequentially per chunk. So a claim with 10–16 candidates triggers 2 LLM calls; very rich claims more.
- Each `callJudge` is a `gpt-5-mini` JSON call returning `{ verdicts: [{candidate_id, support, rationale, pinpoint?}] }`.
- Missing verdicts are auto-filled with `unrelated`. `annotate()` + `aggregate()` produce `ClaimVerification`, which is what the ledger consumes.

## Changes (single file: `verifier.ts`, plus telemetry surface in `runCore.ts`)

### 1. One call per claim
- Remove the `for (… i += MAX_PER_CALL)` chunk loop. Send **all** of the pack's candidates to `callJudge` in a single batch.
- Cap the batch defensively at `MAX_BATCH = 24` (drop tail; tail rarely has signal, and ledger will mark them `unrelated` via the existing missing-verdict fallback). Practically packs already top out around top_n × sources, so this only fires on pathological packs.
- Tighten prompt budget so one call stays comfortably under context:
  - `MAX_SNIPPET_CHARS`: keep 1200 for the first 8 candidates, shrink to 700 for candidates 9–16, 450 for 17–24. (Information density drops with rank.)
  - Snippets are already truncated; just parameterize.
- Keep `MAX_CONCURRENCY = 3` across claims. Net effect: ~1 LLM call per claim instead of ceil(N/8).

### 2. Verdict schema preservation + optional confidence
- Keep `Verdict { candidate_id, support, rationale, pinpoint? }` exactly as today (don't touch `types.ts`).
- Add optional `confidence?: number` (0–1) on `Verdict` in `types.ts` only as an optional field — backward compatible; ledger ignores it. Surface it through `AnnotatedVerdict` too.
- Update `VERIFIER_SYSTEM` / `VERIFIER_USER` in `prompts.ts` to request `"confidence": <0..1>` alongside the existing fields, with explicit instruction: "Return one verdict per candidate. Do not omit candidates."
- Parser: read `confidence` if present, clamp to [0,1], else leave undefined. Missing-verdict fallback unchanged.

### 3. Ledger contract is unchanged
- `ClaimVerification.aggregates` and per-candidate `support` flow into the ledger exactly as today.
- `confidence` is additive metadata only — not read by `ledger.ts`. No DB schema change, no UI change, no drafter prompt change.

### 4. Telemetry
Extend `VerifyResult` with a `telemetry` block:

```ts
telemetry: {
  verifier_batch_size_max: number;          // MAX_BATCH config
  verifier_batch_size_avg: number;          // avg candidates per call
  verifier_calls_before_estimate: number;   // Σ ceil(candidates/8) — what the old code would have done
  verifier_calls_after: number;             // actual LLM calls made this run
  verifier_duration_ms: number;             // == result.duration_ms, duplicated for log clarity
  prompt_tokens?: number;                   // sum of usage.prompt_tokens if gateway returns it
  completion_tokens?: number;
  total_tokens?: number;
}
```

- `callJudge` returns `{ verdicts, usage? }` so we can sum tokens (the Lovable gateway echoes OpenAI-style `usage`).
- In `runCore.ts` verify stage, merge `verification.telemetry` into the existing `recordStage({ stage: "verify", ... })` call (it already supports a metadata object via `stage_runs`). Log line at info level for quick smoke comparison: `[verify] claims=… before=… after=… dur=…ms toks=…`.

### 5. Acceptance / smoke
- 10-question smoke set (existing Deep-mode harness): verify
  - `verifier_calls_after ≤ claims` (one call per claim, possibly fewer if a pack is empty).
  - `verifier_calls_after < verifier_calls_before_estimate` on every run.
  - Wall-time of verify stage drops materially (target ≥30%).
  - Ledger asserts (`quality_insufficient_verified_sources` rate, supported-claim count, drafter `cite:LS#` integrity) are equal or better.
  - No increase in unsupported-claim leaks (sample-grade by re-running ledger invariants).

## Out of scope
- Planner, retrieval, drafter, citation engine, footnote builder, enrichment, UI, DB schema — untouched.
- No streaming verify, no entailment merging, no model swap.

## Files touched
- `supabase/functions/legal-qa/core/verifier.ts` — main change.
- `supabase/functions/legal-qa/core/prompts.ts` — add `confidence` to prompt + "one verdict per candidate" instruction.
- `supabase/functions/legal-qa/core/types.ts` — add optional `confidence?: number` to `Verdict`.
- `supabase/functions/legal-qa/core/runCore.ts` — propagate `verification.telemetry` into the verify stage log/metadata.
