

## Increase Batch Size to Maximum

OpenAI's embedding API accepts up to **2048 inputs** per request for `text-embedding-3-small`. However, there's also an edge function timeout to consider (~60s on Lovable Cloud). With 2048 chunks of up to 8K chars each, the payload and processing time could exceed limits.

A safe maximum is **2048** (OpenAI's hard limit). If timeouts occur, we can reduce to ~500.

### Changes

1. **`supabase/functions/batch-embed-chunks/index.ts`** -- change `BATCH_SIZE` from `100` to `2048`
2. **`src/components/admin/BatchEmbeddingPanel.tsx`** -- update the description text from "50 קטעים" to "2048 קטעים"
3. **Redeploy** the `batch-embed-chunks` edge function

This should process chunks ~20x faster than the current 100-per-batch setting.

