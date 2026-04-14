

## Fix: Reduce Batch Size to 500

The network logs show every batch of 1000 chunks fails completely (0 processed, 1000 failed). OpenAI is likely rejecting the large payload. Reducing to 500 should work reliably.

### Changes

1. **`supabase/functions/batch-embed-chunks/index.ts`** -- change `BATCH_SIZE` from `2048` to `500`
2. **`src/components/admin/BatchEmbeddingPanel.tsx`** -- update description text to say "500 קטעים"
3. **Redeploy** the edge function

