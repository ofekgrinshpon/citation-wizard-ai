

## Problem

The `apify-ingest-cases` edge function processes 97 documents sequentially, generating embeddings for each document and every chunk. This takes ~18 minutes total, but edge functions timeout after ~150 seconds. The client gets "failed to fetch" because the function is killed mid-execution.

## Solution: Batch Processing

Split the 97 items into small batches (5 documents per call) and process them sequentially from the frontend, showing progress as each batch completes.

### Changes

**1. Update `apify-ingest-cases` edge function**
- Add a `batchSize` and `offset` parameter so the frontend can request a slice of the array
- Alternatively (simpler): the frontend sends only 5 items at a time instead of all 97

**2. Update `ApifyIngestionPanel.tsx`**
- After fetching all 97 items from Apify, split them into batches of 5
- Call `apify-ingest-cases` for each batch sequentially
- Show real-time progress: "Processing batch 3/20... (12 inserted, 2 skipped, 1 failed)"
- Accumulate results across all batches
- If one batch fails, continue with the next (resilient processing)

### Technical Details

Frontend batching approach (no edge function changes needed):
```text
items = [97 items from Apify]
batches = split into groups of 5
for each batch:
  POST /apify-ingest-cases with batch (5 items)
  accumulate inserted/skipped/failed counts
  update progress UI
show final totals
```

Each batch of 5 documents should complete in ~50 seconds (well within the timeout).

### Files Modified
- `src/components/admin/ApifyIngestionPanel.tsx` — add batch loop with progress tracking

