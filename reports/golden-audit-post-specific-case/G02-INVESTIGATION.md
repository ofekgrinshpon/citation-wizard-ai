# G02 (Bank Mizrahi) persistence / liveness investigation

Read-only. No code changes.

## 1. Original G02 stuck run

| field | value |
|---|---|
| job_id | `55eb8988-7326-4226-ad0c-0f690007028a` |
| run_id (audit trigger) | returned, but job is keyed by `id` (job_id), not `run_id` |
| status | `running` |
| current_stage | `verifier` |
| completed_stages | `analyzer, planner, retrieval` |
| created_at | 2026-08-06 12:24:13.66Z |
| updated_at | 2026-08-06 12:25:57.29Z |
| time stale | ~50 min at inspection (no update since 12:25:57) |
| error | NULL (no error ever written) |
| verifier started | Yes (stage advanced to `verifier`) |
| verifier completed | No |
| last persisted checkpoint | end of `retrieval` (12:25:57) |
| edge/function logs | **Unavailable** — `function_logs` / `function_edge_logs` return 0 rows for this project (log ingestion empty), so no runtime trace exists for any run, stuck or successful |

## 2. Re-triggered G02 run

| field | value |
|---|---|
| job_id | `85dcdf05-3111-44f7-a121-b1d4d1f1e1da` |
| job row exists | **Yes** |
| qa_logs row exists | No (never reached finalize) |
| status / stage | `running` / `retrieval`, completed `analyzer, planner` |
| created_at / updated_at | 12:57:50Z / 12:59:12Z (stale ~17 min) |
| error | NULL |
| how the script searched | by `run_id` and too early — the table's primary key is `id` (job_id) |
| verdict | The "no job row" report was a **polling artifact**. The row existed. But the run itself genuinely **did not complete** — that part is real. |

## 3. System liveness

- Last successful `qa_logs` row: `de28a35b…` at **13:01:29Z** (G01 Ka'adan) — *after* both stuck G02 runs.
- Other jobs complete normally after the stuck runs: 14 `done` vs 5 `running` in the last 6h.
- Queue/background execution is **not blocked**; stale `running` rows have no effect on new jobs (no lock, no shared state).

### Decisive pattern — concurrency, not question

Grouping jobs by launch minute:

| batch | launched | done | stuck |
|---|---|---|---|
| 12:57 | 2 | 1 | 1 |
| 12:44 | 3 | 1 | 2 |
| 12:24 | 2 | 1 | 1 |
| all single-launch batches today (13) | 1 each | 12 | 1 |

**Every parallel batch completes exactly one job and strands the rest**, at whatever stage they had reached (retrieval, verifier, drafter — no consistent stage). G02 ran alone at 09:47 and completed cleanly in 3m22s. So this is not question-specific and not verifier-specific.

## 4. Classification

**Background execution failure under concurrency** (parallel edge invocations of `legal-research-v1` are evicted / starved; the background task dies without writing an error, leaving the row `running`).

Secondary: **polling/reporting artifact** in the audit runner (searched by `run_id` instead of `id`, too early).

Not: job creation failure (rows exist), not verifier-specific hang (stalls at three different stages), not queue/state blockage (unrelated jobs finish fine).

## 5. Action recommendation

1. **Rerun G02 alone**, sequentially.
2. **Continue G04–G20 strictly one at a time** (no parallel triggering) — the audit runner's batching is what produced the stranded rows, not a product defect.
3. No backend code fix is required to proceed; the concurrency limit is worth a separate track if real users may run parallel research jobs.
4. Optional hygiene: mark the pre-existing stale `running` rows as failed so they stop polluting audit tables.
