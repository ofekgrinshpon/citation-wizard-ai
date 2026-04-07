

# Add Rule 22.2 – כתבי טענות (Court Pleadings)

## Overview
Add a new source type `court_pleading` for citing court pleadings (כתבי טענות) per Rule 22.2. This is a specialized reference type that combines a pleading description with case-law-style case identifiers.

## Formula (Rule 22.2)
`[הפניה ספציפית] ל[כותרת כתב הטענות] ב[סוג ההליך] ([פרטי הערכאה]) [מספר התיק] [צד א'] [מפריד] [צד ב'] ([תאריך כתב הטענות])`

## Examples
- `כתב ערעור בע"א 751/10 דיין נ' ר' (15.2.2010).`
- `ס' 38 לטיעונים משלימים מטעם העותרים בבג"ץ 2974/06 ישראלי נ' הועדה להרחבת סל הבריאות (נבו 16.5.2006).`

## Changes

| File | Change |
|------|--------|
| `src/data/abbreviations.ts` | Add `'court_pleading'` to `SourceType`. Add to `REQUIRED_FIELDS`, `FIELD_LABELS`, `SOURCE_TYPE_LABELS`, `RULE_REFERENCES`. Add detection regex for pleading keywords. |
| `src/data/citationEngine.ts` | Add `court_pleading` rule set with primaryRule `"22.2"`, template, examples, and components. |
| `src/lib/citationValidation.ts` | Add `court_pleading` to `ENGINE_KEY_MAP` with field extraction patterns. |
| `src/components/SourceTypeConfirmation.tsx` | Add `court_pleading` entry with label "כתב טענות" and icon "📋". |
| `supabase/functions/citation-chat/index.ts` | Add `"כתב טענות"` to `CITATION_ENGINE_TEMPLATES` and system prompt with formula and examples. |

## Detection logic
```typescript
if (/כתב\s+(?:ערעור|תביעה|הגנה|טענות)|טיעונים\s+(?:משלימים|מטעם)|סיכומים\s+(?:מטעם|של)|בקשה\s+(?:מטעם|של)/.test(hebrewText)) return 'court_pleading';
```
Placed before case law checks in `detectSourceType`, since pleadings contain case-type abbreviations but should be classified differently.

## Fields
- `pleadingTitle` – required (e.g. "כתב ערעור", "טיעונים משלימים מטעם העותרים")
- `caseType` – required (e.g. ע"א, בג"ץ)
- `caseNumber` – required (e.g. 751/10)
- `party1` – required
- `party2` – required
- `fullDate` – required (date of the pleading)
- `specificReference` – optional (e.g. "ס' 38")
- `court` – optional (court details in parentheses)
- `database` – optional (e.g. "נבו")

## Technical details

### abbreviations.ts
- Add `| 'court_pleading'` to `SourceType` union
- `REQUIRED_FIELDS.court_pleading = ['pleadingTitle', 'caseType', 'caseNumber', 'party1', 'party2', 'fullDate']`
- New `FIELD_LABELS`: `pleadingTitle: 'כותרת כתב הטענות'`, `specificReference: 'הפניה ספציפית'`
- `SOURCE_TYPE_LABELS.court_pleading = 'כתב טענות'`
- `RULE_REFERENCES.court_pleading = 'כלל 22.2 – כתבי טענות'`

### citationEngine.ts
- Template: `[הפניה ספציפית] ל[כותרת כתב הטענות] ב[סוג ההליך] ([פרטי הערכאה]) [מספר התיק] [צד א'] נ' [צד ב'] ([תאריך כתב הטענות]).`
- Notes: specific reference (section/paragraph) is optional and prefixed; court details optional; database name before date when citing from a database

### Edge function system prompt
- Add full formula with both examples
- Note that the pleading title should describe the document type and optionally whose it is ("מטעם העותרים")

