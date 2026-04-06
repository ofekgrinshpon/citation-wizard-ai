

# Fix legislation citation: single page number after ס"ח (Rule 2.8)

## Problem
The citation engine template and Perplexity prompt incorrectly expect two numbers after ס"ח (issue number + page). Per Rule 2.8, only **one number** should follow — the first page where the law appears in the collection. Example: `ס"ח 63` (correct), not `ס"ח 446` (issue number — wrong).

## Changes

### 1. Update `src/data/citationEngine.ts` — primary_legislation rule

- **Template**: Change from `{collection} {firstPage}.` (which implies two numbers via example) — fix the example
- **Example** (line 57): Change `'חוק העונשין, התשל"ז-1977, ס"ח 864, 226.'` → `'חוק העונשין, התשל"ז-1977, ס"ח 226.'`
  - 864 is the issue number, 226 is the page — only 226 should appear
- **Remove** the `volume` component (line 63) — issue/booklet number is not cited
- Update `firstPage` description to clarify: "מספר העמוד הראשון שבו מופיע החיקוק בקובץ, ולא מספר החוברת"
- Add a note referencing Rule 2.8 about page vs. issue distinction

### 2. Update `src/data/citationEngine.ts` — basic_law rule

- **Example** (line 80): Change `'חוק-יסוד: כבוד האדם וחירותו, ס"ח 1391, 150.'` → `'חוק-יסוד: כבוד האדם וחירותו, ס"ח 150.'`
  - Same issue: 1391 is the booklet, 150 is the page

### 3. Update `supabase/functions/citation-chat/index.ts` — Perplexity legislation prompt (~lines 654-661)

- Add explicit instruction in the system prompt: "page הוא מספר העמוד הראשון שבו מופיע החיקוק בקובץ החקיקה, ולא מספר החוברת. דוגמה: חוק הירושה = ס"ח 63 (עמוד), ולא ס"ח 446 (חוברת)."
- Keep only `page` in the JSON schema — no separate booklet field needed since we never use it

### 4. Update hint injection (~line 681-682)

- Format stays: `${collection} ${page}` — just one number after the collection abbreviation
- This is already correct in the current code; the fix is ensuring Perplexity returns the right number

## Files

| File | Change |
|------|--------|
| `src/data/citationEngine.ts` | Fix template examples, remove volume component, clarify firstPage description |
| `supabase/functions/citation-chat/index.ts` | Harden Perplexity prompt with page vs. issue distinction and example |

