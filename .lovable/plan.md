

## Reclassify Remaining 829 Journal Articles

### Context
All 210 previously reclassified documents confirmed to be from `lawjournal.huji.ac.il` — no reverting needed.

### Change
Run a single data update:

```sql
UPDATE legal_documents
SET source_type = 'journal_article'
WHERE source_url LIKE '%lawjournal.huji.ac.il%'
  AND source_type = 'knesset_research';
```

This updates the remaining 829 misclassified records. No code or schema changes needed.

