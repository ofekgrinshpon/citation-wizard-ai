

## Fix: Reduce batch size and cap chunk embeddings to prevent timeouts

### Problem
The edge function logs confirm that with `BATCH_SIZE = 5`, some batches still exceed the ~150s timeout — large documents generate 200+ chunks, each requiring an embedding API call with 300ms delays. One large document alone can take 60+ seconds.

### Changes

**1. `src/components/admin/ApifyIngestionPanel.tsx`**
- Reduce `BATCH_SIZE` from 5 to 2
- Add `AbortController` with 120s timeout per batch fetch call to prevent indefinite hangs
- On timeout, mark the batch as failed and continue to the next

**2. `supabase/functions/apify-ingest-cases/index.ts`**
- Cap chunk embedding generation at 30 chunks per document (store ALL chunks for text search, but only embed the first 30)
- This limits embedding time to ~10 seconds per document maximum
- Reduce inter-chunk delay from 300ms to 200ms

### Expected outcome
Each batch (2 docs, max 30 embeddings each) should complete in ~30-40 seconds, well within the 150s limit.

