
Goal: make batch embedding actually complete again, then restore speed safely.

What the issue is
- I now know the main failure: it is no longer the old NOT NULL bug.
- The current edge logs show repeated database write failures:
  - `57014 canceling statement due to statement timeout`
- So the problem is the current bulk `upsert` itself is too heavy.
- There is also a UI bug: when the function returns `remaining: null`, the code coerces it to `0`, so the admin panel can wrongly show “all chunks processed” even when `0 processed / 500 failed`.

Why the current approach fails
- `upsert` still sends large payloads for every row:
  - `id`
  - `document_id`
  - `chunk_index`
  - `content`
  - `embedding`
- That means each DB write is pushing large text blobs plus vectors through the REST layer.
- The logs show this write path is timing out before completion.
- So the fix should stop using `upsert` for this job.

Plan to fix
1. Replace bulk `upsert` with a real bulk `update`
- Add a database function via migration, e.g. `bulk_update_legal_chunk_embeddings(payload jsonb)`.
- Inside it, use `jsonb_to_recordset(...)` + `UPDATE ... FROM ...` keyed by `id`.
- Update only the `embedding` column.
- Return the number of rows updated.
- Revoke public execute access so only backend code can use it safely.

2. Update the edge function to call the bulk-update function
- In `supabase/functions/batch-embed-chunks/index.ts`:
  - stop building full upsert rows
  - send a compact payload like:
    ```text
    [{ id, embedding }]
    ```
  - call the database function with the service-role client
- Keep the existing auth/admin gate.
- Add strict error handling for:
  - update RPC failure
  - count query failure
  - rate-limit exhaustion

3. Make the batch safer while recovering
- Temporarily lower `SUB_BATCH_SIZE` to a safer value like `25` or `50`.
- Keep retry/backoff for 429s.
- Once the new DB write path is stable, increase the sub-batch again if logs stay clean.

4. Fix the admin UI so it stops lying about success
- In `src/components/admin/BatchEmbeddingPanel.tsx`:
  - do not treat `null` remaining as `0`
  - only show success when:
    - `remaining === 0`
    - and no fatal error occurred
  - if `processed === 0` and `failed > 0`, show an error toast instead
  - surface backend error text when available

5. Verify with logs and one live run
- Redeploy the function and migration.
- Run one batch from `/admin`.
- Confirm:
  - no more `statement timeout`
  - processed count increases
  - remaining decreases correctly
  - no false “all done” message
- If timeouts still happen, use the fallback:
  - controlled concurrent per-row `update` calls (small concurrency) instead of RPC batching

Files to change
- `supabase/functions/batch-embed-chunks/index.ts`
- `src/components/admin/BatchEmbeddingPanel.tsx`
- new migration in `supabase/migrations/...sql`

Technical notes
- This likely needs a schema migration because the best fix is a dedicated bulk-update database function.
- No auth model changes are needed.
- The console ref warnings in Admin/Apify are unrelated to the embedding failure.

Expected result
- The embedding process should stop failing at the DB write step.
- The admin panel should report the real state instead of false success.
- Throughput should improve because the backend will update only `{id, embedding}` instead of re-sending full chunk rows.
