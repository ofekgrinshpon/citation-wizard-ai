

## Reclassify "משפט ועסקים" Articles to journal_article

### What
Update 630 documents from the "משפט ועסקים" journal (Reichman University Law Review, hosted at `runilawreview.org`) from `knesset_research` to `journal_article`.

No `idclawreview` documents were found in the database — all articles came from a single source.

### SQL

```sql
UPDATE legal_documents
SET source_type = 'journal_article'
WHERE source_url LIKE '%runilawreview.org%'
  AND source_type = 'knesset_research';
```

### Result
After this update, total `journal_article` count will be ~1,874 (1,244 existing + 630 new).

### Files affected
- Database data only — no code changes needed

