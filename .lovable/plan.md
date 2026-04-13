

## Reclassify "עיוני משפט" Articles to journal_article

### What
Update 205 documents from the Tel Aviv University Law Review ("עיוני משפט") from `knesset_research` to `journal_article`.

### SQL

```sql
UPDATE legal_documents
SET source_type = 'journal_article'
WHERE (source_url LIKE '%taulawreview%' OR pdf_url LIKE '%taulawreview%')
  AND source_type = 'knesset_research';
```

### Note
205 records found (1 short of 206 — possibly a failed ingestion or different URL). No code changes needed — the `legal-qa` edge function already handles `journal_article` labeling from the previous deployment.

### Files affected
- Database data only

