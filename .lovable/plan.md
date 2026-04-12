

## Fix: Add GIN Indexes for Fast Retrieval + Verify End-to-End

### Current Status (after investigation)

**Good news**: The retrieval pipeline IS working now. The latest deployed edge function:
- Extracts keywords correctly ("ראש הממשלה לפטר היועצת המשפטית לממשלה")
- Finds 10 matching chunks from the local database
- The most recent stats row shows **10 local + 6 perplexity footnotes**

**Problem 1: No GIN indexes** — retrieval takes **18 seconds** scanning 18K documents and 290K chunks without indexes. This wastes half the timeout budget.

**Problem 2: Missing GIN index migration** — the first migration (`697cfebf`) was supposed to create a GIN index on `legal_document_chunks.content`, but it was overridden by the second migration (`277dbcdb`) which rewrote the function to search `legal_documents` titles instead. Neither migration created the GIN index.

**Problem 3: User tested before latest deployment** — The user's test at 15:28/15:41 ran against the old function code. The latest deployment (which I triggered) does work correctly.

### Changes

**1. Database migration — add GIN indexes for performance**

Two indexes to make the title-based search fast:

```sql
-- Index on legal_documents title/citation (used by current search function)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legal_docs_title_search
ON legal_documents
USING gin(to_tsvector('simple', title || ' ' || citation || ' ' || coalesce(case_number,'') || ' ' || coalesce(court,'')));

-- Index on legal_document_chunks content (for future chunk-level search)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legal_chunks_content_search
ON legal_document_chunks
USING gin(to_tsvector('simple', content));
```

This should reduce retrieval from 18 seconds to under 2 seconds.

**2. Add debug logging to the edge function**

Add a log line showing how many local vs perplexity source cards were built, so we can verify in logs without waiting for the full response:

```
"Source cards: 7 local, 5 perplexity, 1 document"
```

**3. Verify with a live test call**

After deploying the indexes and updated function, run the test question through the edge function and confirm:
- Retrieval time drops from 18s to <3s
- Local sources appear in the final footnotes
- The full round-trip completes within timeout

### Files
- Database migration: two GIN indexes
- `supabase/functions/legal-qa/index.ts`: minor logging addition

### Expected outcome
Retrieval drops from 18s to <2s, leaving 40+ seconds for AI generation. The AI cites local verified sources (already confirmed working in latest deployment).

