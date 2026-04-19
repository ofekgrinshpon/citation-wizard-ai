
## Plan: Rewrite `search_legal_chunks_text` for full-content search + index-backed performance + dual-field ranking

### Migration changes

**1. Add GIN indexes** for index-backed lookups:
```sql
CREATE INDEX IF NOT EXISTS idx_chunks_content_fts
  ON public.legal_document_chunks
  USING gin (to_tsvector('simple', content));

CREATE INDEX IF NOT EXISTS idx_docs_meta_fts
  ON public.legal_documents
  USING gin (to_tsvector('simple',
    title || ' ' || citation || ' ' ||
    coalesce(case_number,'') || ' ' || coalesce(court,'')
  ));
```

**2. Rewrite `search_legal_chunks_text`** with three improvements:

- **Remove `LIMIT 2`** on the LATERAL chunk join → all chunks searched.
- **Loosen AND-mode**: keep only the **top-2 longest** distinctive terms as required (`&`); all other terms (length ≥ 2) become OR boosters. Final tsquery shape: `(top1 & top2) | (other1 | other2 | ...)`. Edge cases: 1 term → just that term; 2 terms → both AND; 3+ terms → top-2 AND, rest OR.
- **Combined ranking**: compute `ts_rank` separately on the metadata tsvector and on the chunk-content tsvector, then sum them with a small bonus when both fields match:

```sql
WITH q AS (SELECT <ts> AS ts)
SELECT ...,
  (
    ts_rank(meta_tsv, q.ts)
    + ts_rank(content_tsv, q.ts)
    + CASE WHEN meta_tsv @@ q.ts AND content_tsv @@ q.ts THEN 0.1 ELSE 0 END
  )::float AS similarity
FROM legal_documents d
JOIN LATERAL (
  SELECT c2.id, c2.content, to_tsvector('simple', c2.content) AS content_tsv
  FROM legal_document_chunks c2
  WHERE c2.document_id = d.id
    AND to_tsvector('simple', c2.content) @@ q.ts
) c ON true
WHERE meta_tsv @@ q.ts OR content_tsv @@ q.ts
```

The `WHERE` and the LATERAL filter both use index-backed `@@` against the precomputed tsvector expressions matching the GIN index, so Postgres uses the indexes (no full scan). Documents with matches in both metadata AND content rank above documents with a match in only one.

**3. Tokenizer**: drop common length-<2 noise; sort remaining by `length(w) DESC`; first 2 → AND-required; rest → OR. Wrap `to_tsquery` in EXCEPTION block; on parse error fall back to `plainto_tsquery('simple', search_query)`.

### File changes
- **New migration file** containing both `CREATE INDEX` statements and `CREATE OR REPLACE FUNCTION search_legal_chunks_text` with the rewrite above.
- **No edge function code changes** — `legal-qa/index.ts` already calls this RPC; the SQL change alone delivers the fix.

### Expected impact
- בג"ץ גילון surfaces via keyword match on chunk 3+ content (e.g., "פיטור היועצת המשפטית").
- Hebrew morphology mismatches no longer kill results: "לפטר" missing from content is fine as long as "היועצת" + "המשפטית" match.
- Documents matching both title and body rank above title-only or body-only hits.
- GIN indexes keep latency low even with full-corpus content search.

### Out of scope
- No re-embedding, no edge function changes, no client changes, no Hebrew stemming dictionary.
