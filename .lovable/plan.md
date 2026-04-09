

## Resume Ingestion: Stream-and-Ingest with Live Counter

### Key Answer
**No duplicates will be created.** The existing deduplication check (`case_number` lookup) ensures items already in the DB are skipped. You can safely re-run the fetch.

### Problem
The current flow downloads ALL items into memory before ingesting, which causes the connection to drop on large datasets (7,000+ items). You also can't see how many documents are already in the DB.

### Changes

**1. `src/components/admin/ApifyIngestionPanel.tsx` — Stream-and-ingest pattern**
- Instead of accumulating all items first, fetch one page (50 items) from Apify, ingest it immediately, then fetch the next page
- Add a live "Documents in DB" counter that queries the database on load and after each batch
- Add auto-retry (2 attempts with 3s delay) before showing the Resume button
- Show running totals: "Inserted: X | Skipped: Y | Failed: Z"

**2. `supabase/functions/fetch-apify-dataset/index.ts` — Increase default page size**
- Change default from 25 to 50 items per page (small JSON objects, well within memory limits)

### Expected Result
- Re-running will skip the ~5,000 already-ingested documents and insert the remaining ones
- No memory overflow, no connection drops
- Live progress counter so you always know where things stand

