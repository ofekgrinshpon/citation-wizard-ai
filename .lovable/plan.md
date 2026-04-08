

# Add Partial-Failure Handling to Ingestion Pipeline

## Problem
If a document is inserted into `legal_documents` but embedding/chunking fails, it's currently lost — no way to identify or retry it.

## Changes

### 1. Database Migration
Add an `ingestion_status` column to `legal_documents`:
- `ingestion_status text NOT NULL DEFAULT 'pending'` — values: `pending`, `complete`, `partial_failure`
- `ingestion_error text` — stores the error message on failure

### 2. Edge Function: `apify-ingest-cases` (new)
For each case record:
1. Insert into `legal_documents` with `ingestion_status = 'pending'`
2. Attempt chunking + embedding
3. On success → update to `complete`
4. On failure → update to `partial_failure` with error message in `ingestion_error`
5. Continue to next record (never abort the batch)

Return summary: `{ inserted, skipped, failed: [{ title, error }] }`

### 3. Edge Function: `retry-failed-ingestion` (new)
- Queries `legal_documents WHERE ingestion_status = 'partial_failure'`
- Re-attempts chunking + embedding for each
- Updates status accordingly
- Admin-only auth gate

### 4. Admin UI
- Show a "Failed Ingestions" count badge on the admin panel
- Add a "Retry Failed" button that calls `retry-failed-ingestion`
- Display list of failed documents with their error messages

### 5. Updated Apify Actor Code
Provide final `src/main.js` with corrected Hebrew labels, תקציר filter, and dual file extraction — unchanged from previous plan.

## Database Migration SQL
```sql
ALTER TABLE public.legal_documents
  ADD COLUMN IF NOT EXISTS court text,
  ADD COLUMN IF NOT EXISTS decision_date text,
  ADD COLUMN IF NOT EXISTS case_number text,
  ADD COLUMN IF NOT EXISTS judges text,
  ADD COLUMN IF NOT EXISTS procedure_type text,
  ADD COLUMN IF NOT EXISTS district text,
  ADD COLUMN IF NOT EXISTS docx_url text,
  ADD COLUMN IF NOT EXISTS pdf_url text,
  ADD COLUMN IF NOT EXISTS scraped_at timestamptz,
  ADD COLUMN IF NOT EXISTS ingestion_status text NOT NULL DEFAULT 'complete',
  ADD COLUMN IF NOT EXISTS ingestion_error text;
```

Note: default is `'complete'` so existing records are unaffected.

