
## Plan: keyword fallback + drop noise + fuzzy URL matching

### 1. DB function — top-1 AND fallback
Update `search_legal_chunks_text`: after the existing top-2-AND query runs, if `RETURN QUERY` produced 0 rows, retry with top-1 AND + rest OR. Implementation: capture row count via `GET DIAGNOSTICS`, branch on it.

```text
build top2 tsquery → run query into temp result → if 0 rows:
  build top1 tsquery: required=sorted_words[1:1], boosters=sorted_words[2:N]
  re-run same SELECT with new tsq
  RAISE NOTICE 'Keyword search fallback triggered: %' (top1 word)
return result
```

Use a `RETURN QUERY` pattern with a CTE materialization, or run the query into a temp table, check count, and conditionally re-run. Cleanest: wrap in a loop that tries top-2 first, then top-1, then plainto.

### 2. Edge function — remove score=0 force-keep
File: `supabase/functions/legal-qa/index.ts`. Currently force-keeps 2 low-score sources to fill the pool. Change to: drop everything with `score < 1`. Accept that final local count may be <6. Log: `Local kept after filter: N/M (no force-keep, threshold: 1)`.

### 3. Footnote URL fuzzy matcher
In `legal-qa/index.ts` post-process where unmatched footnotes are logged ("Kept footnote without URL"). Before logging, run a fuzzy match:
- Extract distinctive tokens from footnote citation (party names like "WOLT", "מדר", case numbers like "338/60", "35327-08-20").
- Search across all candidate source cards' `document_title`, `document_citation`, `case_number`, and `source_url` fields for substring/regex hits.
- If any card contains 2+ distinctive tokens or the case number, attach its `source_url`.
- Log: `Fuzzy URL match: footnote #N → card "title..." (matched on: tokens)`.

### 4. Verification logging
- DB function: `RAISE NOTICE` (visible in postgres logs) when fallback fires.
- Edge function: log keyword result count + whether fallback was used (visible from RPC NOTICE? No — Postgres NOTICE doesn't surface via supabase-js. Solution: have the function return an extra signal via a separate diagnostic RPC, OR simpler: log the keyword count and let absence of results vs. presence-after-retry be visible from Postgres logs which we can query via `analytics_query`).
- Practical approach: log to Postgres logs via `RAISE NOTICE`, and add an edge-function log line `Keyword search returned N results (top-2 AND or top-1 fallback)` based on count alone.

### File changes
- **New migration**: `CREATE OR REPLACE FUNCTION search_legal_chunks_text` with top-2 → top-1 → plainto cascade and `RAISE NOTICE` on fallback.
- **`supabase/functions/legal-qa/index.ts`**:
  - Remove force-keep logic in rerank section.
  - Add fuzzy URL matcher before "Kept footnote without URL" log.
  - Add diagnostic log after keyword search call.

### Out of scope
- No client changes, no embedding changes, no Hebrew morphology dictionaries.
- No prompt changes.
