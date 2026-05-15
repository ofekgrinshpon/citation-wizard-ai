## Delete recent broken caselaw ingest

The May 14 crawl inserted **2,364 caselaw documents** with avg 65-char content (title-only stubs — no extracted body text). Deleting them and their chunks so you can re-ingest after fixing the scraper.

### Scope (verified)

```
SELECT date_trunc('day', created_at), COUNT(*), AVG(length(content))
FROM legal_documents WHERE source_type='caselaw' GROUP BY 1;

 2026-05-14 →  2,364 rows, avg   65 chars   ← DELETE
 2026-04-14 →    573 rows, avg  427 chars   ← keep
 2026-04-09 → 10,895 rows, avg 9,910 chars  ← keep
 2026-04-08 →     11 rows, avg 108k chars   ← keep
```

### Steps

1. **Snapshot the doomed IDs** into a temp list (single SELECT, for the log):
   `SELECT id, title FROM legal_documents WHERE source_type='caselaw' AND created_at::date = '2026-05-14' AND length(content) < 200;`
2. **Delete chunks first** (no FK cascade exists):
   `DELETE FROM legal_document_chunks WHERE document_id IN (SELECT id FROM legal_documents WHERE source_type='caselaw' AND created_at::date='2026-05-14' AND length(content) < 200);`
3. **Delete documents:**
   `DELETE FROM legal_documents WHERE source_type='caselaw' AND created_at::date='2026-05-14' AND length(content) < 200;`
4. **Verify:** re-run the daily-count query — May 14 bucket should be 0 (or only rows with real content if any slipped through with ≥200 chars).

### Safety guards

- `length(content) < 200` filter protects any May 14 row that *did* get full text (none expected, but cheap insurance).
- Chunks for these docs have `embedding IS NULL`, so no vector index bloat to worry about.
- No `verified_sources` / `qa_logs` / `citation_history` rows reference `legal_documents.id` by FK, so no cascade collateral.

### Not in scope

- Scraper fix (you're handling).
- Re-ingest (will run via existing `apify-ingest-cases` after your fix).
- Embedding batch (deferred until real content lands).

Tool: this is a data delete, so it runs through `supabase--insert` (DML), not a migration.