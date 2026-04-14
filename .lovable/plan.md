

## Plan: Fix batch embedding + speed optimizations

### Root cause (confirmed from logs)
Line 185: `{ payload: JSON.stringify(payload) }` — the Supabase JS client already serializes arguments to JSON, so calling `JSON.stringify` wraps the array in a string scalar. The DB function then fails with `cannot extract elements from a scalar`.

### Changes

**1. Fix the RPC call in `supabase/functions/batch-embed-chunks/index.ts`**
- Remove `JSON.stringify()` around the payload — pass the raw array directly
- The embedding strings inside each item are already JSON-stringified, which is correct for the DB function

**2. Speed optimizations in the same file**
- Increase `SUB_BATCH_SIZE` from 50 to 200 (OpenAI batch embedding API handles large arrays efficiently)
- Reduce inter-batch delay from 1000ms to 200ms
- Fire 2 sub-batches in parallel using `Promise.all` when possible (2 concurrent OpenAI calls, then 1 RPC write per batch) — this roughly doubles throughput while staying under rate limits
- Keep the existing retry/backoff logic for 429s

**3. UI fix in `src/components/admin/BatchEmbeddingPanel.tsx`**
- Handle `remaining === null` correctly (don't treat as 0)
- Show backend error text when present
- Only show success toast when `remaining === 0`

### Files to change
- `supabase/functions/batch-embed-chunks/index.ts`
- `src/components/admin/BatchEmbeddingPanel.tsx`

### No migration needed
The existing `bulk_update_legal_chunk_embeddings` DB function is correct — only the caller is broken.

### Expected speed
With SUB_BATCH_SIZE=200, 2 parallel calls, and 200ms delays: ~1000 chunks per function invocation, completing ~313K chunks in ~5-6 hours of continuous running (vs current 0 due to the bug).

