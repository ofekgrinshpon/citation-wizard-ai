

## Fix: Token Limit Exceeded (318K > 300K max)

### Problem
The logs show: **"Requested 318095 tokens, max 300000 tokens per request"**. 500 chunks with up to 8000 chars each exceeds OpenAI's 300K token-per-request limit. Every batch fails with 0 processed, 500 failed.

### Solution: Adaptive sub-batching within each edge function call

Instead of sending all 500 chunks in one API call, split them into **token-safe sub-batches** (~200 chunks each) and make multiple API calls per edge function invocation. This keeps each API call under the 300K token limit while still processing 500 chunks per edge function call.

### Changes

**`supabase/functions/batch-embed-chunks/index.ts`**:
- Keep `BATCH_SIZE = 500` (DB fetch size)
- Add a `SUB_BATCH_SIZE = 200` constant for API calls
- Split chunks into groups of 200 before calling `getEmbeddingsBatch`
- Loop through sub-batches, accumulating results
- This means 2-3 API calls per edge function call instead of 1, but each stays well under the 300K token limit

### Expected result
- 200 chunks × ~636 tokens avg = ~127K tokens per API call (safely under 300K)
- 500 chunks processed per edge function call via 2-3 sub-batches
- ~3,000+ chunks/min throughput maintained

