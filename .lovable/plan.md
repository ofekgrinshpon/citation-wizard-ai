

# Add Perplexity Book Search for Source Type "ספר"

## Overview
When a user query is classified as a book (`ספרות` / `ספר`), use Perplexity to search for the book's bibliographic details (author, full title, year, edition, volume count, publisher) — similar to how case law, legislation, and regulation searches already work.

## Trigger Condition
In `citation-chat/index.ts`, after the existing regulation search block (~line 843), add a book search block that activates when:
- The classification tag contains `ספרות` or `ספר`
- No verified source match was found (`!hasVerifiedCandidates`)

## Perplexity Query Design
Ask Perplexity to find the Israeli legal book and return JSON:
```json
{
  "found": true,
  "author": "שם המחבר/ים",
  "bookTitle": "שם הספר המלא",
  "year": 2019,
  "hebrewYear": "התשע\"ט",
  "edition": "מהדורה שנייה",
  "editor": "שם העורך",
  "translator": "שם המתרגם",
  "volumes": "מספר כרכים אם יש",
  "publisher": "הוצאה לאור",
  "isInstitutional": false
}
```

The system prompt for Perplexity will instruct it to:
- Search for Israeli legal/academic books
- Return author names without titles (per Rule 23.2.3)
- Identify institutional authors (per Rule 23.2.4)
- Determine whether Hebrew year, Gregorian year, or both are listed
- Identify edition number if applicable

## Hint Injection
The search result is injected as a `bookHint` into the user message, using the same `══` delimiter pattern:
```
══ נתוני ספר שנמצאו בחיפוש ══
מחבר: ...
שם הספר: ...
שנה: ...
[מהדורה: ... (if applicable)]
[עורך: ... (if applicable)]
══ השתמש בנתונים אלו לעיצוב אזכור הספר לפי כלל 23. סמן [חסר:...] רק לשדות שאינם מופיעים למעלה. ══
```

## Changes

| File | Change |
|------|--------|
| `supabase/functions/citation-chat/index.ts` | Add ~60-line book search block after regulation search. Add `bookHint` to the `allHints` concatenation on line ~856. |

## Technical Details

### Detection
```typescript
const isBook = classMatch && /ספרות|ספר/.test(classMatch[1]);
```

### Search term extraction
Same pattern as legislation — strip classification tag and engine hint block, use the remaining text as search input.

### Perplexity system prompt
Instruct JSON-only response. Focus on Israeli legal/academic books. Include fields for author, title, year (both Hebrew and Gregorian if available), edition, editor, translator, and whether the author is institutional.

### Hint construction
- If found: build `bookHint` with all available fields
- If not found: inject fallback hint instructing the LLM to use `[חסר:...]` for unknown fields and not fabricate data
- Add `bookHint` to `allHints` string alongside existing hints

### Guard against hallucination
- Validate that `bookTitle` and at least one of `author`/`year` are non-empty before marking as usable
- Log search results for debugging

