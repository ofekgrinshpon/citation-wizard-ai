

# Fix: Add Browser-Like Headers to DOCX Download

## Problem
The edge function fetches DOCX files from `gov.il` with a bare `fetch()` call — no `User-Agent` header. The server returns 403 because it detects a non-browser request. The files are perfectly accessible from a real browser.

## Solution
Add a `User-Agent` header (and optionally `Accept`) to the fetch request in `extractTextFromDocxUrl` to mimic a browser request.

## Changes

### 1. Update `extractTextFromDocxUrl` in `supabase/functions/apify-ingest-cases/index.ts`
- Add browser-like headers to the `fetch` call:
  ```
  fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ...",
      "Accept": "*/*",
    }
  })
  ```

### 2. Clean up existing failed records before re-ingestion
- Delete the 97 `partial_failure` caselaw records from `legal_documents` so they can be re-ingested cleanly (via migration or manual cleanup)
- Alternatively, add duplicate detection by `case_number` to skip already-existing records

### 3. Re-deploy and test
- Deploy the updated function
- Run the Apify fetch+ingest flow again to verify DOCX files download successfully

