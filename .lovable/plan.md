

## Resume Ingestion and Prevent Sleep Interruptions

### Current State
- 19/97 documents ingested (11 complete, 4 partial_failure, 4 pending)
- ~78 documents were never sent because the browser tab lost connection when the computer went to sleep

### Root Cause
The frontend drives the batch loop sequentially. When the computer sleeps, the browser suspends, the auth token expires, and remaining batches are never sent.

### Plan

**1. Clean up failed/pending records**
- Delete the 4 `partial_failure` and 4 `pending` documents (and their chunks) so they can be re-ingested cleanly

**2. Add Wake Lock + Visibility handling to `ApifyIngestionPanel.tsx`**
- Request a `navigator.wakeLock` (Screen Wake Lock API) during ingestion to prevent the device from sleeping
- On `visibilitychange` to "hidden", pause the loop; on "visible", refresh the auth token and resume
- Before each batch, call `supabase.auth.refreshSession()` to ensure the token is still valid (already done, but add error recovery)

**3. Add resilient batch recovery**
- Store the current batch index and full items list in component state
- If a batch fails due to auth/network error, show a "Resume" button instead of losing all progress
- On resume, re-authenticate and continue from where it left off

### Files Modified
- `src/components/admin/ApifyIngestionPanel.tsx` — wake lock, visibility handling, resume capability
- Database cleanup via migration tool (delete partial_failure + pending caselaw records)

### Technical Details

```text
Ingestion flow (updated):
1. Fetch items from Apify (97 items)
2. Request Wake Lock to prevent sleep
3. For each batch of 2:
   a. Refresh auth token
   b. POST to apify-ingest-cases
   c. Update progress UI
   d. If network error → pause, show "Resume" button
4. Release Wake Lock when done
```

Wake Lock fallback: if the API is not available (older browsers), the process works as before but with the resume button as a safety net.

