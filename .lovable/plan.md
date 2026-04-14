

## Speed Up Batch Embedding: Bulk DB Updates

### Problem
The embedding API calls are fast (~2s for 200 chunks), but the **database updates are sequential** -- 500 individual `UPDATE` queries per edge function call, each with network round-trip overhead. This is the primary bottleneck.

### Solution: Batch upserts instead of individual updates

Replace the loop of 500 individual `.update().eq("id", ...)` calls with a single bulk upsert per sub-batch using `.upsert()` with `onConflict: 'id'`. This reduces 500 DB round-trips to 2-3.

### Changes

**`supabase/functions/batch-embed-chunks/index.ts`**:
- After getting embeddings for a sub-batch, collect all successful results into an array
- Use a single `adminClient.from("legal_document_chunks").upsert(updates, { onConflict: 'id' })` call instead of 200 individual updates
- Each update object contains `{ id, embedding }` only

### Before vs After
```text
Before: 500 sequential DB updates (~3-5s each = 25-40s total DB time)
After:  2-3 bulk upserts (~1s each = 2-3s total DB time)
```

### Expected improvement
- ~10x faster per edge function call
- Processing rate should jump from ~500 chunks/min to ~3,000-5,000 chunks/min
- 313K remaining chunks: from ~10 hours down to ~1-2 hours

### Files changed
- `supabase/functions/batch-embed-chunks/index.ts` -- replace sequential updates with bulk upsert

