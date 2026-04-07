

# Add Rule 13.1 – תקנונים (Bylaws/Regulations) Support

## Overview
Add a new source type `regulation` (תקנון) to the citation system, covering Rule 13.1 for citing bylaws like the Knesset Rules of Procedure, Civil Service Code (תקשי"ר), and ethics codes.

## Formula
`[הפניה ספציפית] ל[שם התקנון או קיצורו] ([תאריך התקנון])`

Examples:
- ס' 141 לתקנון הכנסת (30.4.2019).
- פס' 06.211 לתקשי"ר (18.10.2010).
- ס' 10(ב) לתקנון האתיקה המקצועית של העיתונות (20.2.2017).

Amendment variant (via ילקוט הפרסומים):
- תיקון תקנון הכנסת, י"פ התשע"ב 5730, 5744.

## Changes

| File | Change |
|------|--------|
| **`src/data/abbreviations.ts`** | Add `'regulation'` to `SourceType` union. Add entry to `REQUIRED_FIELDS` (fields: `regulationName`, `fullDate`; optional: `section`). Add to `FIELD_LABELS`, `SOURCE_TYPE_LABELS`, `RULE_REFERENCES`. Update `detectSourceType` to detect `תקנון` input (before the generic legislation check) and return `'regulation'`. |
| **`src/data/citationEngine.ts`** | Add `regulation` rule set to `CITATION_RULES` with primaryRule `"13.1"`, template, example, and components (`section`, `regulationName`, `fullDate`). |
| **`src/lib/citationValidation.ts`** | Add `regulation` to `ENGINE_KEY_MAP`. Add field extraction patterns for regulation citations in `extractFieldsFromResponse` (detect regulation name after "ל", date in parentheses). |
| **`supabase/functions/citation-chat/index.ts`** | Add `"תקנון"` entry to `CITATION_ENGINE_TEMPLATES` with rule 13.1, template, required fields, and notes. Add תקנון rules to the system prompt's source type list. |

## Detection logic
In `detectSourceType`, add before the generic `חוק` check:
```
if (/תקנון/.test(hebrewText)) return 'regulation';
```

Note: `תקנון` is currently matched in `verifiedSources.ts` under secondary legislation patterns, but the main `detectSourceType` in `abbreviations.ts` doesn't have a dedicated path — it falls through to `secondary_legislation` via the `תקנות` check or `unknown`. This change gives it its own type.

## Validation fields
- `regulationName` (required) — name of the bylaw
- `fullDate` (required) — exact Gregorian date in DD.MM.YYYY format
- `section` (optional) — specific section reference

