

## What broke
The version that processed 360K embeddings worked perfectly. I overengineered the fix when the real difference is just **chunk length** — `israeli_law` chunks are longer/denser than the previous corpus, so `SUB_BATCH_SIZE = 200` now exceeds OpenAI's 300K-tokens-per-request cap.

## Minimal fix
**Revert `batch-embed-chunks/index.ts` to the working version (commit `0758bed`), then change exactly one line:**
- `SUB_BATCH_SIZE`: 200 → **50**

That's the entire change. Everything else (TPM tracker, token estimator, retry-after parser, split-and-retry, packSubBatches function) gets removed. The 1M TPM bucket was never the bottleneck before and won't be now — smaller sub-batches just naturally pace themselves.

## Why this is enough
- 50 chunks × ~6K-char israeli_law content × ~1 token/char Hebrew worst-case ≈ 300K tokens absolute max → fits under cap.
- 429s (when they happen) just return failure for that sub-batch; rows stay `embedding IS NULL`, picked up next loop. That's how the original ran for 360K chunks without issue.
- Throughput per invocation drops from "200 chunks at a time" to "50 × 10 sub-batches = 500 per invocation" — actually equivalent or better than the original.

## UI revert
**`BatchEmbeddingPanel.tsx`**: remove the `rate_limited` counter additions, restore the simpler 2-counter display (processed / failed). The function won't return `rate_limited` anymore.

## Files to change
- `supabase/functions/batch-embed-chunks/index.ts` — revert to commit `0758bed` content, change `SUB_BATCH_SIZE = 200` → `50`.
- `src/components/admin/BatchEmbeddingPanel.tsx` — revert the rate-limited counter UI additions.

## Out of scope
- Anything else. No new logic. No estimators. No budget trackers.

## Expected outcome
Same behavior as the run that successfully processed 360K embeddings, with sub-batches small enough for the longer israeli_law chunks. Remaining ~46K finish in roughly the same timeframe per chunk as the original run.

