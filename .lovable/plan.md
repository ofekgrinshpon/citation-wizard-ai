# persistent_background_research_jobs_v1

Make legal research survive the browser: the job runs server-side, the DB row is the source of truth, and the user can refresh, switch screens, close the tab, or come back tomorrow and find the answer.

No change to retrieval, sufficiency, claim-source-match, acquisition, drafting, or citation logic.

## What already exists (verified in code)

- `legal-research-v1` already creates a `legal_research_jobs` row before the pipeline runs, executes the pipeline under `EdgeRuntime.waitUntil`, returns `202 { job_id, run_id, status }` immediately, and updates `current_stage` / `completed_stages` per stage (`index.ts` lines ~125-170, ~355, ~2790-2840).
- Terminal states are persisted: `done` + `result` (answer/footnotes/used_sources/debug) or `error` + `error` text, with credit refunds on non-delivery, plus a 9-minute in-isolate watchdog.
- A pg_cron reaper (`reap_stale_research_jobs`, every minute, 12-minute staleness) closes abandoned rows with a Hebrew "retrieval interrupted" limitation instead of a stub, and back-fills the `qa_logs` trace row.
- RLS on `legal_research_jobs`: owner-only SELECT, owner-only INSERT, admin SELECT. No cross-user read path.
- The panel already polls the job row by id.

So the pipeline is already background-safe. The gaps are all at the edges: resume is tab-local, there is no shareable job URL, running jobs are invisible in history, and a double-submit creates two paid jobs.

## Gaps to close

1. **Resume is `sessionStorage`-only** — a closed tab, a new tab, or another device loses the running job even though it is still running server-side.
2. **No job URL** — nothing to return to; history replay only works for finished runs via `qa_logs`.
3. **History shows completed runs only** (`qa_logs`), so running and failed jobs are invisible.
4. **No idempotency** — a fast double-click charges credits twice and starts two pipelines.
5. **Running-screen copy** does not tell the user it is safe to leave.
6. **No `progress_label_he`** — the client maps stage keys ad hoc.

## Work

### Backend

- **Migration** on `public.legal_research_jobs`:
  - add `client_request_id text`, `progress_label_he text`, `started_at timestamptz`, `completed_at timestamptz`;
  - partial unique index on `(user_id, client_request_id)` where `client_request_id is not null`;
  - index on `(user_id, status)` for the "active job" lookup;
  - no policy widening — existing owner-scoped RLS already satisfies requirement 8; re-assert grants if missing.
- **`legal-research-v1/index.ts`** (edges only, pipeline untouched):
  - accept `client_request_id` in the request body; before charging credits, look up a job with the same `(user_id, client_request_id)` created in the last 15 minutes — if found, return `202` with that `job_id` and do not charge again;
  - set `started_at` on insert and `completed_at` on every terminal write;
  - write `progress_label_he` alongside `current_stage` in `markStage`, from a fixed stage→Hebrew map (מנתח את השאלה / מתכנן מחקר / מחפש מקורות / קורא מקורות / מאמת התאמה / בודק מספיקות / מנסח תשובה / מסיים).
- **Reaper**: keep the existing terminal-limitation semantics (it already avoids stubs and preserves `prior_stage`), and extend it to stamp `completed_at` and a `timed_out` marker inside `result` so the UI can label it distinctly.

### Frontend

- **Route `/research/:jobId`** rendering the existing research panel in "job view" mode: load the row by id, poll while `queued|running`, render the stored `result` when `done`, render a clean failure when `error` — never a stub.
- **`LegalResearchV1Panel`**:
  - after submit, send a generated `client_request_id`, then `navigate('/research/' + job_id)` (replace) so the URL itself is the resume token;
  - on mount without a job id, query the user's most recent `queued|running` job and offer/auto-resume it (replaces the `sessionStorage` dependency; keep the key as a fallback hint only);
  - running screen shows the required Hebrew copy plus the current `progress_label_he`;
  - guard the submit button while a job is in flight.
- **`QAHistorySidebar`**: merge `legal_research_jobs` rows (running / failed / timed out) with the existing `qa_logs` history, de-duplicated by `run_id`, showing question title, timestamp, and stage or completion state. Clicking a job navigates to `/research/:jobId`.

## Validation

- Stage 1 — unit/fixture: idempotency resolver (same key twice → one job), stage→Hebrew label map, history merge/de-dup.
- Stage 2 — cheap mock job: insert a synthetic job row, drive it through stages, verify the result screen reflects each stage after a hard refresh, and that a stale row is reaped and rendered as a clean failure.
- Stage 3 — one real `legal-research-v1` run: submit, close the page mid-`reading_sources`, reopen `/research/:jobId`, confirm progress continued and the final answer matches a control run for the same input; plus a double-submit check (one job, one charge) and a cross-user read check (RLS denies).

Report: `reports/persistent-background-jobs/ACCEPTANCE_REPORT.md`, delivered here when done.
