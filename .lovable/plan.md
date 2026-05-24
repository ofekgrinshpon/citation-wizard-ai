
# P6.1 — Queue + poll for `legal-research-v1`

## Problem

The synchronous edge-function call hits Supabase's hard 150s idle-timeout (pipeline takes ~2–3 min). User saw 504 at ~2:30. P6 frontend is fine; the runtime has to move off the request/response thread.

## Approach

Reuse the existing smoke-mode background path (`EdgeRuntime.waitUntil(runPipeline())` already returns `202` with a `run_id`). Generalize it to all callers, persist a job row, and poll it from the panel.

No retrieval / verifier / drafter / prompt changes. No new auth flow.

## Database (one migration)

New table `legal_research_jobs`:
- `id uuid pk default gen_random_uuid()`
- `user_id uuid not null` (auth.uid())
- `project_id uuid null`
- `question text not null`
- `status text not null default 'pending'`  — `pending | running | done | error`
- `result jsonb null`  — full success payload `{answer, footnotes, used_sources, debug}`
- `error text null`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`
- trigger `update_updated_at_column`
- index on `(user_id, created_at desc)`

RLS:
- SELECT: `auth.uid() = user_id`
- INSERT: `auth.uid() = user_id`
- No client UPDATE/DELETE (service role only — writes from the edge function bypass RLS).

No realtime subscription — simple polling is fine.

## Edge function `legal-research-v1` (single file edit, ~40 lines)

Restructure the existing `handle`:

1. After auth + body validation + credit pre-flight (unchanged), insert a row into `legal_research_jobs` with `status='pending'`.
2. Return **immediately** with `202 { run_id, job_id, status: 'queued' }`.
3. Wrap `runPipeline()` so that on entry it `UPDATE … status='running'`, on success it writes `status='done', result=<payload>`, on error `status='error', error=<message>`. Also keep existing `writeTelemetry` calls (no change).
4. Always use `EdgeRuntime.waitUntil(runPipeline())` (already conditionally used for smoke mode). Drop the `await runPipeline()` branch — every request becomes async.
5. Smoke-mode path can stay as-is (already returns 202) — collapse into the same code path.

Add a thin `GET /legal-research-v1/status?job_id=…` (handled in the same `serve`) or a second function. Cleanest: keep a single function, add `if (req.method === 'GET') return getStatus(...)` that selects from `legal_research_jobs` with the user's client (RLS enforces ownership) and returns `{ status, result, error }`.

## Frontend `LegalResearchV1Panel.tsx`

Replace the single `invoke` + `Promise.race` with:

1. POST to `legal-research-v1` → `{ job_id }`.
2. Poll every 2s via `supabase.functions.invoke('legal-research-v1', { method: 'GET', body: undefined })` passing `job_id` as a query param (use `supabase.functions.invoke` with `headers` doesn't accept query — switch to `fetch(${SUPABASE_URL}/functions/v1/legal-research-v1?job_id=…)` with the session JWT, or just `supabase.from('legal_research_jobs').select().eq('id', jobId).single()` which is simpler and RLS-safe).
3. Prefer the **direct DB read**: no second endpoint needed, RLS already protects rows. Each poll = one tiny indexed `SELECT`.
4. Stop polling on `status === 'done'` or `'error'`, or on client 5-min hard cap (still show timeout message).
5. Progress bar logic unchanged — driven by `setInterval` and `STAGES`.

## Out of scope (explicit)

URL hygiene, citation cleanup, Uniform Citation Rules, "שם" / "לעיל ה״ש", bibliography, streaming, realtime channels, Fast/Deep, DoctrineClassifier, SourceRequirements, marker parser, retrieval/verifier/drafter prompt changes.

## Verification

- Migration applies cleanly.
- Submit a question in `/app` Research tab → 202 + `job_id` → row visible in `legal_research_jobs` → row flips to `done` within ~3 min → panel renders answer + footnotes + debug.
- Kill network mid-run: job continues in background, next refresh of the panel can re-poll using the stored `job_id` if we keep it in `sessionStorage` (optional; defer).
- Error path (force pipeline throw): row goes to `status='error'`, panel shows the error.
