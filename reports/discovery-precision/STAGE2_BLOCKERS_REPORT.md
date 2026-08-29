# discovery_precision_stage2_blockers_v1 — fix + Stage 2 rerun

## Fixes shipped

1. **Split listing metrics** (`discoveryPrecision.ts`, `candidatePool.ts`)
   - `raw_index_or_listing_ratio` — all listing/index/search/category candidates.
   - `suppressible_index_or_listing_ratio` — unprotected listing candidates only (acceptance gate).
   - `final_suppressible_listing_ratio` / `final_raw_index_or_listing_ratio` — same measures on the final pool.
   - Old `index_or_listing_ratio_before/after` removed; the Stage 2 runner now gates on the suppressible ratio.

2. **Local-corpus protection audit**
   - `local_corpus_document` (origin-only protection) removed.
   - A local candidate is protected only via: acquired body, judgment body, official primary/statute body, exact-source/exact-authority/exact-docket, article-report identity with body path, or `local_corpus_substantive` (integrity says citable + class is citable/possible-body).
   - Per-candidate `protected_reason`, `suppressible`, `not_suppressible_reason` recorded; aggregated as
     `protected_counts`, `protected_listing_counts`, `not_suppressible_reason_counts`.

3. **Telemetry always emits**
   - `DiscoveryDiagnostics` now carries `status` (`not_started`/`started`/`completed`), `not_run_reason`,
     `candidates_at_start`, `suppression_ran`, `backfill_ran`, `processed`, `o_n_guard_ok`, `ms`.
   - Durable checkpoints in `index.ts`: `discovery_precision_pending` (at retrieval entry, with reason),
     `discovery_precision_start` (candidate count), `discovery_precision_done` (full metric set). These survive an
     isolate kill / stale-job reaper, so an aborted run still shows whether the stage ran and where it stopped.

4. **B8 blow-up**
   - Root cause of the 884 s B8-M1 run: the job never left `retrieval` and was terminated by the 12-minute stale-job
     reaper (`reap_stale_research_jobs`) — discovery precision had not started yet, hence the missing telemetry.
     It was retrieval-side variance, not the new stage.
   - Hard guard added anyway: exactly one pass over the existing candidate list (`processed === candidates_at_start`,
     surfaced as `o_n_guard_ok`); backfill only reorders candidates already in the pool and triggers no retrieval,
     fetch, verifier pass or pool rebuild.

## Stage 1

`src/test/discoveryPrecision.test.ts` — **17/17 pass** (4 new cases for local-corpus protection and suppressibility).

## Stage 2 rerun (mini)

| Run | Runtime | Branch | Footnotes | raw ratio | suppressible before → after | Suppressed | Backfilled | O(n) guard | Result |
|---|---|---|---|---|---|---|---|---|---|
| D1-M1 | 162 s | normal draft | 2 | 0.437 | 0.310 → 0.000 | 39 | 14 | ok | PASS |
| D1-M2 | 131 s | normal draft | 2 | 0.500 | 0.402 → 0.000 | 45 | 15 | ok | PASS |
| B8-M1 | 111 s | normal draft | 0 | 0.505 | 0.368 → 0.000 | 35 | 20 | ok | PASS |
| R02 | 90 s | docket_limitation | 0 | 0.475 | 0.406 → 0.000 | 41 | 14 | ok | PASS |
| P02 | 131 s | docket_limitation | 0 | 0.475 | 0.418 → 0.000 | 59 | 15 | ok | PASS |

- **D1 divergence resolved**: eligible 8→8 and 5→5, both runs drafted (previously 6 vs 1 with a refusal).
- **B8 back to prior order of magnitude**: 111 s vs 884 s; no retrieval abort; telemetry present.
- **Suppressible listing ratio drops to 0 in the final pool** in all three runs; residual listing candidates in the
  raw ratio are protected with valid reasons (`exact_docket_identity`, `official_statute_page`).
- **Safety controls preserved**: R02 and P02 both still refuse with `docket_limitation` and 0 footnotes; suppression
  and backfill did not admit substitute authority for a named docket.

## Verdict

Blockers 1–4 fixed and verified; all Stage 2 acceptance gates pass, including both safety controls. Cleared to run
the full sweep.
