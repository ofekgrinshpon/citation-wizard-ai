
**Answer**
No reliable “hard kill” exists in the current app for an already-running backend query/job. Right now:
- the admin page can still start heavy reads,
- the embedding/ingestion tools can keep the backend busy,
- the Stop button only stops the client loop after the current request returns.

So the fix should be: stop waiting on stale work, stop launching more heavy work, and add a real cooperative cancel/pause mechanism for long-running admin jobs.

**What I found**
- `Admin.tsx` is better than before, but the Knowledge tab still launches 4 queries together, including large-table counts and `qa_logs` reads.
- `BatchEmbeddingPanel.tsx` only stops the next loop iteration locally; it does not cancel the in-flight `batch-embed-chunks` request.
- `batch-embed-chunks` still does large reads plus per-chunk updates, and only ends when a batch completes.
- `ApifyIngestionPanel.tsx` and ingestion functions can also keep the backend under pressure.
- Auth startup still depends on DB reads (`user_roles`, `projects`, `profiles`) with no hard timeout, so if the backend is saturated, login can look frozen.

**Plan**
1. **Make login immune to admin load**
   - Stop sending admins straight into the heavy dashboard immediately after sign-in.
   - Route successful login to a lightweight post-auth screen first, then let admins enter `/admin` manually.

2. **Add hard timeouts to startup auth reads**
   - Wrap admin-role, projects, and subscription/profile queries with timeout logic.
   - If a query stalls, fail soft with a visible retry state instead of an endless spinner.

3. **Remove remaining expensive admin startup reads**
   - Break the Knowledge tab into smaller fetches.
   - Defer `qa_logs` stats and large counts until explicitly requested.
   - Keep the admin shell visible immediately.

4. **Add real cancel/pause for long-running admin jobs**
   - Add a backend control table for job state (`running`, `pause_requested`, `cancel_requested`).
   - Update `batch-embed-chunks` and ingestion flows to check that flag between sub-batches and exit quickly.
   - Change the Admin UI Stop button to set the backend cancel flag, not just a local boolean.

5. **Add recovery UX**
   - If auth is ready but backend-dependent reads are slow, show:
     - “logged in successfully”
     - “admin data is still loading”
     - retry / continue to app actions

6. **Add targeted diagnostics**
   - Log exact timings for `getSession`, role lookup, projects fetch, subscription fetch, and admin tab fetches so the next stuck case is attributable immediately.

**Technical details**
- **Frontend files**
  - `src/hooks/useAuth.tsx`
  - `src/hooks/useProjects.tsx`
  - `src/hooks/useSubscription.tsx`
  - `src/pages/Auth.tsx`
  - `src/pages/Landing.tsx`
  - `src/App.tsx`
  - `src/pages/Admin.tsx`
  - `src/components/admin/BatchEmbeddingPanel.tsx`
  - `src/components/admin/ApifyIngestionPanel.tsx`
- **Backend functions**
  - `supabase/functions/batch-embed-chunks/index.ts`
  - `supabase/functions/apify-ingest-cases/index.ts`
  - possibly `supabase/functions/embed-legal-source/index.ts`
- **Database change likely needed**
  - small admin-only job-control table for cooperative cancellation/pause
  - RLS restricted to admins only

**Important constraint**
- I do not plan to use unsafe backend-process cancellation.
- I do plan to implement cooperative cancellation plus frontend timeouts, which is the safer and more reliable fix in this stack.

**Expected result**
- Login succeeds even if admin/background jobs are busy.
- Old admin work no longer makes auth appear frozen.
- Admin jobs can be paused/canceled cleanly.
- The app shows recovery UI instead of hanging on a spinner.
