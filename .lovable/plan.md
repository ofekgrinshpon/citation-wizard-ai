
## Plan: Replace hard threshold with top-N by score

### Change in `supabase/functions/legal-qa/index.ts` (rerank section, ~lines 466–487)

Replace the current hard-filter (`KEEP_THRESHOLD = 1` → drop below) with a sort-and-slice approach:

1. **Build `docScores` as today** (raw keyword score + verb-topic bonus).
2. **Sort `docScores` by `score` descending**, with a tiebreaker preserving original retrieval order (which already reflects vector similarity from the upstream merge).
3. **Take the top 6 docs**, regardless of whether their score is 0. This guarantees that purely vector-retrieved chunks (lexically empty but semantically strong) survive.
4. **Push all matching chunks** for those top 6 docs into `result` with their score attached.
5. **Update logs**:
   - Keep the existing per-doc score map (`Rerank scores per doc:`).
   - Replace the "Filtered out low-relevance" line with a single summary: `Rerank: kept top-6 of N docs by score (zero-score kept: K)` so we can audit how many semantic-only matches survived.
   - Replace the existing `Local kept after filter:` line with `Local kept after top-6 slice: keptDocs/totalDocs (zero-score: K, active verb pairs: …)`.

### Constant rename
Remove `KEEP_THRESHOLD`. Introduce `const TOP_N_DOCS = 6;` so the cap is explicit and easy to tune later.

### Out of scope
- No DB / SQL changes.
- No changes to the upstream candidate retrieval, vector channel, Perplexity backfill, fuzzy URL matcher, or footnote logic.
- No changes to the verb-topic bonus map.

### Expected impact
- `Local kept after top-6 slice` should jump from 1 → 4–6 on hybrid queries like the vicarious-liability question, because vector-only chunks (score 0 + bonus 0) now survive instead of being filtered out.
- Documents that match both lexically and semantically still rank first thanks to the score-desc sort; pure vector hits backfill the rest.
