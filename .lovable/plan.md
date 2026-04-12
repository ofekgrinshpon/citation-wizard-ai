

## Fix: Local Database Search Never Finds Matches

### Root Cause
Two compounding issues prevent the local text search from returning results:

1. **`plainto_tsquery` uses AND logic** — the full question "האם ראש הממשלה יכול לפטר את היועצת המשפטית לממשלה?" creates a query requiring ALL words (including "האם", "יכול", "את") to appear in the same chunk. This almost never matches.

2. **No GIN index** — the `legal_document_chunks` table (293K rows) has no text search index, so even when a simpler query could match, the search times out scanning the full table.

Evidence: searching "יועץ משפטי לממשלה" (3 keywords) returns 5 results. The full question returns 0 (or times out).

### Changes

**1. Database migration — add GIN index for text search performance**
```sql
CREATE INDEX IF NOT EXISTS idx_legal_chunks_text_search
ON legal_document_chunks
USING gin(to_tsvector('simple', content));
```

**2. Database migration — create a smarter search function**
Replace `search_legal_chunks_text` with a function that:
- Strips Hebrew stop words (האם, יכול, את, של, על, כי, זה, הם, אם, לא, גם, כל, עם, היא, הוא, אין, מה, איך, כאשר, כדי, בין, אלא, רק, עוד, אשר, היה, יש, אך, אף, כך, לפי, בו, בה, או, אל, כן, פי, שלא, שהיא, שהוא, שלו, שלה, אותו, אותה, etc.)
- Uses OR logic (`websearch_to_tsquery` or manually built OR query) so partial keyword overlap still returns results
- Falls back to progressively fewer keywords if no results found

**3. Edge function (`supabase/functions/legal-qa/index.ts`)**
- Add a keyword extraction step before calling the search: strip common Hebrew words, extract the 3-5 most meaningful terms
- Add logging to show how many local matches were found vs. skipped
- If the first search returns 0, try again with fewer keywords

### Technical details

New `search_legal_chunks_text` function logic:
```sql
-- Use websearch_to_tsquery which supports OR operator
-- Strip stop words from the query before searching
-- Search content, title, and citation with the cleaned query
```

Edge function keyword extraction (in TypeScript):
```typescript
const STOP_WORDS = new Set(["האם","יכול","את","של","על","כי","זה","הם","אם","לא","גם","כל","עם","היא","הוא","אין","מה","איך","כאשר","כדי","בין","אלא","רק","עוד","אשר","היה","יש","אך","אף","כך","לפי","או","אל","כן","שלא","אותו","אותה","הזה","הזאת","לפני","אחרי","תחת","מול","ליד","בו","בה","שהיא","שהוא"]);

function extractKeywords(question: string): string {
  return question.split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w))
    .slice(0, 6)
    .join(" OR ");
}
```

### Files
- Database migration: GIN index + updated search function
- `supabase/functions/legal-qa/index.ts`: keyword extraction, better logging

### Expected outcome
After this change, the question "האם ראש הממשלה יכול לפטר את היועצת המשפטית לממשלה?" will search for "ראש הממשלה OR לפטר OR היועצת OR המשפטית OR לממשלה" — matching relevant Knesset research documents about the Attorney General that already exist in the database.

