

## Problem
1. **TPM rate-limit thrashing**: Loop fires 500-chunk batches back-to-back (~380K tokens each), exhausting the 1M TPM bucket. ~80% of sub-batches return 429.
2. **Per-request token cap hits**: Some sub-batches (200 chunks × long content) exceed the 300K-tokens-per-request OpenAI limit → 400 errors.
3. **Misleading "failed" counter**: A 429/400 marks chunks as failed in UI counters, but rows stay `embedding IS NULL`, so they're retried in the next batch. So `21,400 failed` ≠ permanently lost — it's mostly the same chunks being rate-limit-rejected over and over. Already-embedded ones are NOT re-sent.

## Fix (in `supabase/functions/batch-embed-chunks/index.ts`)

### 1. Token-aware sub-batching
Replace fixed `SUB_BATCH_SIZE = 200` with a token-budgeted packer:
- Estimate tokens per chunk: `Math.ceil(content.length / 3.5)` (Hebrew-aware, ~3.5 chars/token).
- Pack chunks into a sub-batch until cumulative est. tokens ≥ **250,000** (safety margin under the 300K hard cap).
- Guarantees no more 400 "request too large" errors.

### 2. Respect the TPM bucket — sequential sub-batches with budget tracking
- Process sub-batches **sequentially** (not parallel) within a function invocation.
- Keep a rolling 60-second token budget (target: stay under 800K TPM, leaving headroom).
- Before sending a sub-batch, if estimated tokens + tokens-used-in-last-60s > 800K → `await sleep(time_until_oldest_token_ages_out)`.

### 3. Honor 429 `retry-after` properly
- On 429, parse `Please try again in X.Xs` from the OpenAI error body (already in logs).
- Sleep for `parsedDelay + 500ms` jitter, then retry that exact sub-batch up to 3 times **inside the function** instead of returning failure.
- Only count as "failed" if it fails after 3 retries.

### 4. Reduce per-invocation batch size
- Drop `BATCH_SIZE` from 500 → **200** per invocation.
- One invocation now does ~1 minute of work cleanly within the TPM bucket, then the client loop picks up the next 200. Smoother, fewer wasted retries.

### 5. Clearer counters in the UI (`BatchEmbeddingPanel.tsx`)
- Rename "failed" → "rate-limited (will retry)" when the failure cause is 429.
- Add a `rate_limited` field to the function response so the UI doesn't scare you with a fake 21K "failed" number.

## Files to change
- `supabase/functions/batch-embed-chunks/index.ts` — token-aware packer, sequential sub-batches, TPM budget tracker, 429 retry-after parser, BATCH_SIZE 500→200.
- `src/components/admin/BatchEmbeddingPanel.tsx` — show `rate_limited` separately from true failures.

## Out of scope
- Switching embedding provider (e.g., to Lovable Gateway) — keeping OpenAI text-embedding-3-small to preserve the existing 768-dim HNSW index.
- Re-embedding already-completed chunks (function correctly skips them via `embedding IS NULL` filter — no change needed).

## Expected outcome
- Throughput goes from ~100 processed / 400 failed per batch → ~200 processed / ~0 failed per batch.
- No more 400 "request too large" errors.
- "Failed" counter in UI reflects only real, permanent failures.
- Full ~46K remaining `israeli_law` chunks finish in ~4 hours of steady, uninterrupted progress instead of thrashing.

