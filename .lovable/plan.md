
# Add Rule 15 – החלטות של גופים שלטוניים (Governmental Body Decisions)

## Overview
Add a new source type `government_decision` covering Rules 15.1–15.4, 15.7, and 15.8 for citing decisions of governmental bodies, patent registrar proceedings, and planning appeal committees.

## Formula (Rule 15.1)
`החלטה [מספר] של [הגוף המחליט] "[שם ההחלטה]" ([תאריך לועזי מלא])`

## Sub-rules handled in system prompt
- **15.2**: No decision number → omit it
- **15.3**: Government/ministerial committee → include government number (e.g. הממשלה ה-30)
- **15.4**: No full date → use whatever date info is available; no Gregorian → use Hebrew date
- **15.7**: Patent Registrar → special formula with proceedings type, parties, interim description
- **15.8**: Planning appeal committees → cite like case law (Rules 18–20)

## Changes

| File | Change |
|------|--------|
| **`src/data/abbreviations.ts`** | Add `'government_decision'` to `SourceType` union. Add to `REQUIRED_FIELDS`, `FIELD_LABELS`, `SOURCE_TYPE_LABELS`, `RULE_REFERENCES`. Update `detectSourceType` to detect `החלטה`, `רשם הפטנטים`, `ועדת ערר לתכנון`. |
| **`src/data/citationEngine.ts`** | Add `government_decision` rule set with primaryRule `"15.1"`, template, examples, components, and notes covering 15.2–15.4, 15.7, 15.8. |
| **`src/lib/citationValidation.ts`** | Add `government_decision` to `ENGINE_KEY_MAP`. Add field extraction patterns for decision citations. |
| **`src/components/SourceTypeConfirmation.tsx`** | Add `government_decision` entry with label "החלטות גופים שלטוניים" and icon "🏛️". |
| **`supabase/functions/citation-chat/index.ts`** | Add `"החלטות גופים שלטוניים"` to `CITATION_ENGINE_TEMPLATES`. Add full formula with all sub-rules and examples to the system prompt. |

## Detection logic
```typescript
if (/החלטה\s+\d|החלטה\s+של|תמצית\s+החלטה/.test(hebrewText)) return 'government_decision';
if (/רשם\s+הפטנטים|בקשה\s+לביטול|בקשת\s+עיצוב|התנגדות\s+לרישום|בקשות\s+מתחרות/.test(hebrewText)) return 'government_decision';
if (/ועדת\s+ערר\s+לתכנון/.test(hebrewText)) return 'government_decision';
```

## New fields
- `decisionNumber` – optional (per 15.2)
- `decidingBody` – required
- `decisionName` – required (in quotes)
- `fullDate` – required (with 15.4 fallback)
