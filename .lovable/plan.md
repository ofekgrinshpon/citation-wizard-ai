
# Phase E.1 — Parallel verifier batches (source-safe)

Single-file change to `supabase/functions/legal-research-v1/stages/verifier.ts`. Orchestration-only. No change to candidates, prompts, model selection, schema, support logic, role-match, usable/dropped derivation, or anything downstream.

## Scope

**Changed:** the `for (const batch of batches)` loop in `runVerifier` (verifier.ts ~line 315) becomes a bounded-concurrency runner.

**Unchanged (hard constraints):**
- `planBatches(...)` — same batches, same candidates in each, same order.
- `buildBatchUserMessage`, `SYSTEM_PROMPT`, `VERIFIER_TOOL_PARAMETERS`, `validateBatchVerdicts`.
- Initial model `MODEL_MINI`, escalation to `MODEL_FULL`, escalation trigger (`!parsed.ok`).
- `rolesMatch` role-match backfill.
- Missing-pair backfill as `support: "unrelated"` with existing reason.
- Aggregation: `bestByCand` by min `SUPPORT_RANK`, all downstream `usable` / `dropped` derivation.
- `VerifierResult` shape — existing fields keep identical types and meanings.

## Deterministic merge (guardrail)

Results are flushed in **plan order**, never completion order:

1. `const batches = planBatches(...)` — fixed input order, indexed 0..N-1.
2. Each batch's processing populates a slot in fixed-size arrays sized to `batches.length`:
   - `slotStageRuns: StageRun[][]`
   - `slotVerdicts: Verdict[][]`
   - `slotMeta: BatchMeta[]` (label, claim_ids, candidates, escalated, ms)
   - `slotErrors: Array<{claim_id,reason}>[]`
   - `slotPerClaimMs: Array<Record<string, number>>`
   - `slotEscalatedClaimIds: string[][]`
3. After `await` of the pool, flush slots in index order into the existing accumulators (`stage_runs`, `allVerdicts`, `batchesMeta`, `errors`, `per_claim_ms`, `escalated_claims`). This guarantees byte-identical ordering to the sequential path for stage_runs and batchesMeta, regardless of which batch's LLM call returned first.
4. `bestByCand` aggregation is order-independent (`SUPPORT_RANK` min), so flush order does not affect `usable` / `dropped` content.

Telemetry will assert and log `merge_order_preserved: true` after the flush (cheap structural check: `slotMeta.map(m => m.label)` equals `batches.map(b => b.label)`).

## Concurrency

- Constant `VERIFIER_BATCH_CONCURRENCY = 2` at top of file. Cap=2 is sufficient (current `planBatches` produces ≤2 normal batches plus oversized-per-claim); cap is enforced even if future planner changes generate more.
- Simple promise pool: keep an active set of size N; on each completion start the next pending batch. No `Promise.all` over an unbounded list, no third-party dep.

## Failure handling

- Each batch reuses the existing initial→escalate flow exactly. No new retry logic added (keeps behavior identical when batches succeed).
- If a batch throws (network/5xx/timeout from `callOpenAIJsonTool`), the error is captured in that slot as `{ error, claim_ids }`. The pool drains remaining in-flight batches (does not cancel siblings — partial parallel results are still usable and identical to what those batches would have produced sequentially).
- After drain: if any slot has an error, the function returns the existing error path — push an `errors[]` entry per failed batch with `reason` = error message and let downstream behave as it does today when `callOpenAIJsonTool` fails. **No silent candidate drop**: failed batches do not contribute verdicts, which means their candidates are still considered (just without verdicts), matching sequential behavior on the same failure.
- **Sequential fallback (rate-limit safety net):** if `parallelErrorCount >= 1` and the error message includes `429` / `rate` (case-insensitive), the function records `verifier.fallback_to_sequential: true` and re-runs only the failed batches sequentially. This is a small, bounded retry of just the failed slots — does not re-run successful ones — and preserves deterministic order because retries write back into their original slot indexes.

## Telemetry additions

Added to `VerifierResult` (and surfaced top-level in `index.ts` `verifierMeta`):

```
parallel: true
concurrency_limit: 2
batch_count: number
batch_ms: number[]              // per-batch wall, plan order
total_wall_ms: number           // Date.now() - t_total at end of pool
total_sum_ms: number            // sum(batch_ms)
escalated_batches: number
merge_order_preserved: boolean  // structural assertion result
rate_limit_count: number        // count of caught 429-like errors
retry_count: number             // count of slots re-run via sequential fallback
fallback_to_sequential: boolean
```

Existing `batches[]`, `ms`, `per_claim_ms`, `escalated_claims`, `usable`, `dropped`, `verdicts`, `counts`, `candidates_verified/usable/dropped` stay byte-identical in shape.

## Validation (Phase E.1 report)

Deploy `legal-research-v1`. Re-run L1–L6 using a Phase-E copy of the Phase-D runner. Write `reports/legal-research-v1-p7-phaseE1-{L1..L6}.json` + summary.

| Gate | Target |
|---|---|
| `marker_validation.ok` | 6/6 |
| `internal_id_leak=false` | 6/6 |
| `used_sources ⊆ verifier.usable` | 6/6 |
| `footnote_count == used_sources_count` | 6/6 |
| `no_raw_atomic_tokens` | 6/6 |
| `no_candidate_id_leak` | 6/6 |
| `atomic.validation.ok` | 6/6 |
| verifier candidates verified (count) | equal to Phase D per fixture |
| `verifier.usable` candidate-id set | equal to Phase D per fixture (LLM nondeterminism may shift borderline `partial↔tangential` verdicts but not the set on identical prompts; report any drift) |
| `verifier.dropped` count | equal to Phase D per fixture (allow ±1 from LLM noise; report) |
| L6 `verifier.total_wall_ms` | materially lower than 136 s; expected ~95 s (≈ max(batch_ms)) |
| L1–L5 `verifier.total_wall_ms` | within ±2 s of Phase D (single batch → no parallelism gain) |
| `rate_limit_count` | 0 |
| `fallback_to_sequential` | false on all 6 |
| `merge_order_preserved` | true on all 6 |

Report will compare slot-by-slot: Phase D `batches[].ms` and Phase D `batches[].label` vs Phase E.1 equivalents to confirm identical batch plans.

## Rollback

Revert `verifier.ts` `runVerifier` body to the sequential `for` loop. Single-file revert. No schema, contract, or env-flag changes.

## Out of scope (explicit, not implemented)

Retrieval, Perplexity, candidate pool, source selection, verifier strictness/prompts/schema, drafter, footnotes, citation formatting, Rule 37, atomic emit, placement repair, caching, eager gpt-5, model downgrades, UI streaming.
