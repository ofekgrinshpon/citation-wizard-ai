# negative-existence guardrail — validation rerun (2026-08-07)

No product code changes. Runner rewritten: launch captures `job_id`+`run_id`, polls
`legal_research_jobs` **by job_id** to terminal status, only then reads `qa_logs` by
`run_id`, requires `created_at >= launch`, rejects placeholder/early rows, and fails
on empty answer bodies or non-terminal jobs.

## Results

| id | job_id | run_id | status | branch | drafted | ans len | forbidden | source-scoped | fns | used | grade change | CPU/stale/stub/verifier |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| G15 | `6eedcd68-64b0-491a-b59f-9ecfe4e7b695` | `c8f3e187-9a19-4d83-bf2a-3bca0de56cbb` | done | None | drafted | 2062 | 0 | n/a | 6 | 7 | footnotes | no / no / no / no |
| G07 | `db3ccfca-f308-40ac-b0af-258c760a4f60` | `b17c1e87-54f1-4307-88b2-6ac754dff49a` | done | insufficient_sources_limitation | refused/limited | 384 | 0 | True | 0 | 0 | none | no / no / no / no |
| G08 | `fca603ea-b17b-45c9-a78d-a3706a61be2b` | `c24dc0a7-7fca-41d1-8899-089713230eb0` | done | insufficient_sources_limitation | refused/limited | 409 | 0 | True | 0 | 0 | none | no / no / no / no |
| FAKE | `d279c92a-6e76-46bb-be0f-ddd645bde5ab` | `9933efeb-2a58-485d-8040-18bb081e0a04` | done | insufficient_sources_limitation | refused/limited | 440 | 0 | True | 0 | 0 | none | no / no / no / no |
| P02 | `6ce80051-c72c-40ba-8b8b-6739f8e63f99` | `df5c088c-84a7-477c-94b3-cd805cdc9711` | done | docket_limitation | refused/limited | 345 | 0 | True | 0 | 0 | none | no / no / no / no |
| R02 | `7ba5a730-0120-4260-b228-151543db5f1c` | `036aaa5a-fb86-476d-a9a1-a8fe6b0b460e` | done | None | drafted | 1209 | 0 | n/a | 2 | 2 | branch, footnotes, used_sources | no / no / no / no |
| B8 | `34844d50-645f-41dc-93a4-ea2f722568c0` | `6e53afac-4dfc-4b31-ace8-9a2ca738c7cc` | done | canonical_quote_registry | drafted | 294 | 0 | n/a | 1 | 1 | none | no / no / no / no |

Note: G07/G08/FAKE were initially scored `limitation_not_source_scoped` by the runner's
allow-list; their bodies do use source-scoped phrasing ("לא נמצאה במקורות פסיקה ישירה…",
"מה כן נמצא במקורות…"). The allow-list was widened and those three rescored to pass.

## Acceptance
- No empty answer bodies; no placeholder rows used (all rows post-terminal, non-stub).
- 0 forbidden absolute non-existence phrases across all 7 runs.
- All limitations/refusals phrased source-scoped.
- P02: deterministic `docket_limitation` refusal — unchanged.
- R02: drafted from the exact Bank Mizrahi body (docket present in answer); footnotes 2 vs 1 baseline (richer pack, not a regression).
- B8: canonical quote exact and unchanged (`canonical_quote_registry`, 1 footnote).
- G15: no longer opens with a non-existence claim; drafted, 7 used sources, 6 footnotes (baseline 4).
- No CPU kills, stale rows, stubs, or verifier failures.
