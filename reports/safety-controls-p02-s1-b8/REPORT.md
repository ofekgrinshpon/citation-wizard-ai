# Safety controls — P02 / S1 / B8 (2026-08-06)

No code changes. Runner: `scripts/legal-research-v1-safety-controls-p02-s1-b8.ts`.

## Tooling/reporting correction (not a product failure)

The earlier R02 "no job row / no qa_logs row" result was a **polling artifact**: the validation
script queried `legal_research_jobs` by **`run_id`**, but that table's `id` is a **job id** and is a
distinct identifier from the pipeline `run_id` (there is no `run_id` column on the jobs table).
The job row existed the whole time. Classified as **tooling/reporting**, not a pipeline
persistence failure. This runner matches job rows by `question` + `created_at` window.

## Results

| control | run_id | job_id | branch | drafted | status | retrieval elapsed | exact docket found/usable | identity passed | footnote 1 / refusal | CPU kill | stubs/verifier |
|---|---|---|---|---|---|---|---|---|---|---|---|
| P02 fake docket | `943abeac-edff-46f0-9f82-fb02b73bbc06` | `c6391d80-8bd6-4624-a077-78cd24e426ba` | `docket_limitation` | no | done (146.7s) | 29.2s | false / false | true | refusal `no_exact_docket_source` | no | no |
| S1 commentary-only | `a5364f3f-fbc5-484b-b40d-a9e86b786c4e` | `89f30851-811a-49a1-9eac-9491fc08fca3` | `docket_limitation` | no | done (293.2s) | 22.0s | false / false | true | refusal `no_exact_docket_source` | no | no |
| B8 canonical quote | `88975830-9fb0-4d57-9455-6c46655fae90` | `985101ee-cd55-424b-b204-862c8a701613` | `canonical_quote_registry` | yes | done (125.7s) | 7.1s | n/a (`not_specific_case_mode`) | n/a | חוק-יסוד: כבוד האדם וחירותו – נוסח רשמי (PDF), m.knesset.gov.il | no | no |

fast_lane: not hit on any control (no exact-docket candidate for P02/S1; B8 is not specific_case).

## Acceptance

- All 3 completed cleanly; job rows persisted; 0 used_sources on both refusals.
- No scholarship-carried specific-case holding (both refusals explicitly decline similar cases /
  secondary literature; `used_sources_count = 0`).
- No unrelated case consumed specific_case acquisition budget (`acquisition_success=false`,
  no acquired body, retrieval well under the deadline; `guard_triggered=false`).
- No CPU kills, no stubs, no verifier failures.
- B8 quote text and shape unchanged vs. the earlier baseline
  (`reports/quality-audit/runs-drafter-sharpness/B8.json`).
- Stale `running` rows in the table all pre-date these runs (oldest 2026-07-31, newest 2026-08-06
  09:27); none produced by these three controls.
