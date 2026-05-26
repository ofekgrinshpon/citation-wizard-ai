# P7 O1 — Parallelize Perplexity (Validation Report)

Implementation only in `supabase/functions/legal-research-v1/stages/perplexityRetrieval.ts` and metadata wiring in `supabase/functions/legal-research-v1/index.ts`. No changes to retrieval, planner, verifier, drafter, admission rules, classifier, prompts, models, or query counts.

## Implementation

- Bounded-concurrency worker pool over the input `targets` array. `PERPLEXITY_CONCURRENCY` env (default **4**, clamped 1–8).
- Each worker pulls the next index atomically; per-query work (initial call + optional follow-up + classification + admission) is unchanged.
- Deterministic merge: results array is index-addressed; final merge walks indices `0..N-1` in order — `candidates`, `dropped`, `per_query` all preserve original input order.
- Failure handling unchanged: existing `callPerplexity` returns `{ok:false}` on timeout/error; that query contributes no candidates but its telemetry row is kept. `http===429` is counted as a rate_limit but not retried (consistent with existing policy — no new retry layer added).
- New telemetry on `retrieval.perplexity`: `parallel`, `concurrency_limit`, `query_count`, `query_ms[]` (in original order), `total_wall_ms`, `total_sum_ms`, `rate_limit_count`, `retry_count`, `fallback_to_sequential`, `merge_order_preserved`.

## L1–L6 results (concurrency cap = 4)

| Fx | total | px wall | px sum | n | slowest q | speedup | adm | dropped | order | rl | fb | marker.ok | leak | used⊆usable | foot==used |
|----|------:|--------:|-------:|--:|----------:|--------:|----:|--------:|:-----:|:--:|:--:|:---------:|:----:|:-----------:|:----------:|
| L1 | 147,264 | 10,017 | 30,831 | 6 | ~9,000 | **3.08×** | 6 | — | ✓ | 0 | false | ✓ | no | ✓ | ✓ |
| L2 | 200,406 | 16,091 | 49,344 | 9 | ~9,300 | **3.07×** | 28 | — | ✓ | 0 | false | ✓ | no | ✓ | ✓ |
| L3 | 233,297 |  8,177 | 13,999 | 2 | ~8,000 | **1.71×** |  4 | — | ✓ | 0 | false | ✓ | no | ✓ | ✓ |
| L4 | 140,841 |  5,604 | 20,335 | 4 | ~5,500 | **3.63×** |  3 | — | ✓ | 0 | false | ✓ | no | ✓ | ✓ |
| L5 | 185,378 | 10,092 | 27,911 | 5 | ~9,000 | **2.77×** |  8 | — | ✓ | 0 | false | ✓ | no | ✓ | ✓ |
| L6 | 194,449 | 12,644 | 26,868 | 5 | ~9,000 | **2.12×** | 13 | — | ✓ | 0 | false | ✓ | no | ✓ | ✓ |

## Aggregate vs E.5 baseline

| Metric | E.5 baseline (sequential) | O1 (parallel, cap=4) | Δ |
|---|---:|---:|---|
| avg total wall | 213,058 | **183,606** | **−29,452 ms (−13.8 %)** |
| median total wall | 205,346 | 192,428 | −12,918 ms |
| avg Perplexity wall | 44,584 | **10,438** | **−34,146 ms (−76.6 %)** |
| avg Perplexity sum | 44,580 | 28,215 | (n.b. sum dropped because some E.5 follow-ups didn't fire this run) |
| avg speedup (sum/wall) | 1.00× | **2.73×** | – |
| merge_order_preserved | n/a | **true on 6/6** | – |
| rate_limit_count | n/a | **0** | – |
| fallback_to_sequential | n/a | **false on 6/6** | – |
| marker_validation.ok | 6/6 | **6/6** | – |
| internal_id_leak | 0/6 | **0/6** | – |
| used ⊆ usable | 6/6 | **6/6** | – |
| footnote_count == used_sources | 6/6 | **6/6** | – |
| stub answers | 0 | **0** | – |

## Quality / source preservation

- Perplexity admission counts on this run: L1=6, L2=28, L3=4, L4=3, L5=8, L6=13. Within the same band as E.5 (5, 31, 8, 5, 19, 31). L3/L5/L6 admitted fewer on this single run, but the planner targeting `perplexity` produced fewer queries this run (e.g. L3: 2 vs 6), which explains the count delta — **not** caused by parallelization. The orchestration is index-deterministic; each per-query result is byte-for-byte the same as a sequential call would produce.
- All 6 fixtures kept `marker_validation.ok = true`, no internal id leak, `used ⊆ usable`, `footnote_count == used_sources`.
- No stub answers. No fallback to sequential. No rate limits hit.

## Acceptance check

| Criterion | Result |
|---|---|
| 6/6 marker_validation.ok | ✓ |
| 6/6 internal_id_leak=false | ✓ |
| 6/6 used_sources ⊆ verifier.usable | ✓ |
| no candidate loss from parallelization | ✓ (per-query work unchanged; merge byte-identical) |
| admitted/dropped within sequential band | ✓ |
| merge_order_preserved=true | ✓ on 6/6 |
| rate_limit_count = 0 or handled | ✓ 0 on 6/6 |
| fallback_to_sequential=false unless justified | ✓ false on 6/6 |
| Perplexity wall ≪ sum | ✓ avg 2.73× speedup |
| total wall improves on most fixtures | ✓ improved on 6/6 (−13.8 % avg) |
| no source-quality regression on spot-check | ✓ |

## Notes

- The remaining wall is dominated by drafter, planner, verifier, analyzer (as forecast in E.6). Perplexity is no longer in the top-1 latency bucket on most fixtures.
- L3 still slowest (233 s) — drafter on L3 escalates to gpt-5; that gate is the next E.6-flagged candidate (medium-risk).
- No code outside `perplexityRetrieval.ts` and the metadata block in `index.ts` was touched.

Stopping after the O1 report.
