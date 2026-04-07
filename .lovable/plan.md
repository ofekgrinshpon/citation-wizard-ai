
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
| **`src/data/abbreviations.ts`** | Add `'government_decision'` to `SourceType` union. Add to `REQUIRED_FIELDS` (fields: `decisionNumber`, `decidingBody`, `decisionName`, `fullDate`; decisionNumber optional per 15.2). Add field labels for new fields. Add to `SOURCE_TYPE_LABELS`, `RULE_REFERENCES`. Update `detectSourceType` to detect keywords like `החלטה`, `רשם הפטנטים`, `ועדת ערר לתכנון` before generic legislation checks. |
| **`src/data/citationEngine.ts`** | Add `government_decision` rule set with primaryRule `"15.1"`, template, examples, components (`decisionNumber`, `decidingBody`, `decisionName`, `fullDate`), and notes covering 15.2–15.4, 15.7, 15.8. |
| **`src/lib/citationValidation.ts`** | Add `government_decision` to `ENGINE_KEY_MAP` (mapped to `"החלטות גופים שלטוניים"`). Add field extraction patterns for decision citations. |
| **`src/components/SourceTypeConfirmation.tsx`** | Add `government_decision` entry with label "החלטות גופים שלטוניים" and icon "🏛️". |
| **`supabase/functions/citation-chat/index.ts`** | Add `"החלטות גופים שלטוניים"` to `CITATION_ENGINE_TEMPLATES` with rule 15.1, template, required fields, and comprehensive notes covering all sub-rules (15.2–15.4, 15.7, 15.8). Add the full formula and examples to the system prompt's source type list and required fields section. |

## Detection logic
In `detectSourceType`, add before the generic legislation check:
```typescript
if (/החלטה\s+\d|החלטה\s+של|החלטה\s+חכ|תמצית\s+החלטה/.test(hebrewText)) return 'government_decision';
if (/רשם\s+הפטנטים|בקשה\s+לביטול\s+תיקון|בקשת\s+עיצוב|התנגדות\s+לרישום\s+סימן|בקשות\s+מתחרות/.test(hebrewText)) return 'government_decision';
if (/ועדת\s+ערר\s+לתכנון/.test(hebrewText)) return 'government_decision';
```

## New fields
- `decisionNumber` – decision number (optional per 15.2)
- `decidingBody` – the deciding body name (required)
- `decisionName` – decision title in quotes (required)
- `fullDate` – full Gregorian date (required, with 15.4 fallback)

## System prompt additions
The edge function system prompt will include the full formula with all sub-rules and examples, ensuring the AI knows:
- When to omit decision number (15.2)
- When to add government number (15.3)  
- Date fallback rules (15.4)
- Patent Registrar special format (15.7)
- Planning appeal committee = cite like case law (15.8)
