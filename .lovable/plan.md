

# Add Perplexity search for legislation (law name, year, ס"ח)

## Problem
When a user queries a law (e.g., "חוק התכנון והבנייה"), the system only checks the local `laws.ts` database and `verified_sources` table. If the law isn't there or has incomplete data (missing ס"ח page), the AI has no way to find the official publication details and either guesses or leaves them out.

## Solution
Add a legislation search block in `citation-chat/index.ts` (after the case law search block, ~line 624) that triggers when:
1. The source type is classified as חקיקה, חוק יסוד, or חקיקת משנה
2. No verified source with a complete citation was returned as a direct match

### How it works

1. **Detection**: Check if `classMatch` contains חקיקה/חוק יסוד/חקיקת משנה. Extract the law name from the user input (strip the classification tag).

2. **Perplexity query**: Ask Perplexity to find the official publication details — return JSON:
   ```json
   {
     "found": true,
     "lawName": "חוק התכנון והבנייה",
     "hebrewYear": "התשכ\"ה",
     "gregorianYear": 1965,
     "collection": "ס\"ח",
     "page": 307,
     "isNewVersion": false,
     "isCombinedVersion": false
   }
   ```

3. **System prompt**: Instruct Perplexity to search for the law's official publication in ספר החוקים (ס"ח), קובץ התקנות (ק"ת), or נוסח חדש (נ"ח), and return the first page number in that collection.

4. **Validation**: Only use results if `found` is true, `lawName` is non-empty, and `collection` is non-empty.

5. **Hint injection**: Inject a `legislationHint` into the user message with verified publication data (same pattern as `caseLawHint`), so the AI formats the citation with ס"ח and page number.

6. **Fallback**: If search fails or data is unusable, inject a hint with `[חסר:...]` for unknown publication fields.

7. **Skip condition**: If verified sources already returned a direct best-match (the early-return at line 454), the Perplexity search never runs since the function already returned.

## Technical details

| File | Change |
|------|--------|
| `supabase/functions/citation-chat/index.ts` | Add ~50 lines after line 624: legislation Perplexity search block with detection, query, validation, hint injection, and fallback |

The new block mirrors the case law search pattern — a `legislationHint` variable initialized to `""`, a Perplexity fetch with structured JSON response, validation, and injection into `enhancedMessages` alongside `caseLawHint`.

