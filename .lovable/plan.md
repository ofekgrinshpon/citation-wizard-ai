
Goal: make batch embedding work reliably again, then speed it up safely.

What I found
- The current failure is real and reproducible from the logs.
- Root cause 1: `batch-embed-chunks` now fetches only `id, content` and then does `upsert({ id, embedding })`.
- But `legal_document_chunks` has required non-null columns: `document_id`, `chunk_index`, and `content`.
- In Postgres, an upsert payload must still satisfy NOT NULL checks before conflict resolution, so the current bulk write fails with:
  - `null value in column "document_id" ... violates not-null constraint`
- Root cause 2: logs also show intermittent OpenAI `429 rate_limit_exceeded` on embedding requests, so even after fixing the DB write path, throughput can still stall without retry/backoff.

Plan to fix it
1. Repair the database write path in `supabase/functions/batch-embed-chunks/index.ts`
- Change the fetch to include all required columns:
  - `id, document_id, chunk_index, content`
- Build the bulk payload with all required fields plus `embedding`
- Keep bulk writes, but only for valid rows

2. Add resilient retry handling for embedding API calls
- Detect 429 responses in `getEmbeddingsBatch`
- Retry the sub-batch with capped exponential backoff and jitter
- Respect the provider’s suggested wait time when available
- If retries still fail, mark only that sub-batch as failed instead of silently poisoning the whole run

3. Make the batch size safer under rate pressure
- Reduce `SUB_BATCH_SIZE` from 200 to a safer value if needed
- Keep `BATCH_SIZE` at 500 for DB fetches unless logs show timeout pressure
- Optionally insert a small delay between sub-batches to stay under tokens-per-minute limits

4. Improve operator visibility in the admin panel
- Return clearer response details from the function:
  - processed
  - failed
  - remaining
  - sub-batches attempted
  - retry count / rate-limited status
- Update `src/components/admin/BatchEmbeddingPanel.tsx` to surface “rate limited, retrying” vs “DB write failed” so failures are diagnosable from the UI

5. Verify the fix after deployment
- Redeploy `batch-embed-chunks`
- Trigger one batch run
- Check logs to confirm:
  - no more NOT NULL upsert errors
  - processed count is greater than 0
  - remaining decreases
  - 429s, if they occur, are retried instead of failing the whole batch

Recommended implementation detail
```text
Fetch:
  select id, document_id, chunk_index, content

Upsert payload per success:
  {
    id,
    document_id,
    chunk_index,
    content,
    embedding
  }
```

Why this approach
- It preserves the intended speedup from bulk writes.
- It fixes the actual hard failure shown in the logs.
- It also addresses the second bottleneck already visible: provider rate limiting.

Technical notes
- No schema migration is required for this fix.
- The main code file to update is:
  - `supabase/functions/batch-embed-chunks/index.ts`
- Secondary optional UI update:
  - `src/components/admin/BatchEmbeddingPanel.tsx`
- Existing auth and admin-role checks can remain as-is.

Expected result
- The batch process should start embedding successfully again instead of returning `0 processed, 500 failed`.
- Throughput should improve versus individual updates, while staying stable under API rate limits.
