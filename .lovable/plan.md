

## Update Hapraklit Documents to `journal_article`

### What
153 records currently typed as `knesset_research` where `pdf_url` or `source_url` contains `hapraklit` will be updated to `source_type = 'journal_article'`.

### SQL
```sql
UPDATE legal_documents
SET source_type = 'journal_article'
WHERE pdf_url LIKE '%hapraklit%'
   OR source_url LIKE '%hapraklit%';
```

### Technical details
- Uses the data insert/update tool (not a migration, since this is a data change)
- No schema or code changes needed
- 153 rows affected

