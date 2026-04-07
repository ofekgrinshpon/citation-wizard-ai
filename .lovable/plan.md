

# Add Rule 16 – חוות דעת (Expert Opinions)

## Overview
Add a new source type `expert_opinion` covering Rules 16.1–16.4 for citing expert opinions, including a special sub-formula for the Public Complaints Commissioner on Judges (נציבות תלונות הציבור על שופטים).

## Formulas

**Standard (16.1):**
`"[שם חוות הדעת]" (חוות דעת של [זהות נותן חוות הדעת] [תאריך לועזי מלא])`

**Commissioner variant (16.4):**
`חוות דעת [מספר] של נציבות תלונות הציבור על שופטים "[שם]" [פרטי פרסום] ([תאריך])`

## Sub-rules (handled in system prompt)
- **16.2**: Official capacity → title only. Private → name + relevant title. Name in opinion title → omit from parentheses.
- **16.3**: Use full Gregorian date. If unavailable, partial date or Hebrew date.
- **16.4**: Commissioner opinions use a distinct formula with opinion number and optional publication details.

## Changes

| File | Change |
|------|--------|
| `src/data/abbreviations.ts` | Add `'expert_opinion'` to `SourceType` union. Add to `REQUIRED_FIELDS`, `FIELD_LABELS`, `SOURCE_TYPE_LABELS`, `RULE_REFERENCES`. Add detection: `/חוות\s+דעת/`. Add fields: `opinionName`, `opinionAuthor`, `opinionNumber`. |
| `src/data/citationEngine.ts` | Add `expert_opinion` rule set with primaryRule `"16.1"`, template, examples, components, and notes covering 16.2–16.4. |
| `src/lib/citationValidation.ts` | Add `expert_opinion` to `ENGINE_KEY_MAP`. Add field extraction patterns (quoted name, author after "חוות דעת של", date). |
| `src/components/SourceTypeConfirmation.tsx` | Add `expert_opinion` entry with label "חוות דעת" and icon "📝". |
| `supabase/functions/citation-chat/index.ts` | Add `"חוות דעת"` to `CITATION_ENGINE_TEMPLATES` with full formula, sub-rules, and examples. Add to source type list in system prompt. |

## Detection logic
```text
if (/חוות\s+דעת/.test(hebrewText)) return 'expert_opinion';
```
Placed before generic legislation checks in `detectSourceType`.

## New fields
- `opinionName` – required (in quotes)
- `opinionAuthor` – required (title or name per 16.2)
- `fullDate` – required (with 16.3 fallback)
- `opinionNumber` – optional (for 16.4 commissioner opinions)

## Technical details

### abbreviations.ts
- Add `'expert_opinion'` to the `SourceType` union after `'government_decision'`
- `REQUIRED_FIELDS.expert_opinion = ['opinionName', 'opinionAuthor', 'fullDate']`
- `FIELD_LABELS`: add `opinionName: 'שם חוות הדעת'`, `opinionAuthor: 'נותן חוות הדעת'`, `opinionNumber: 'מספר חוות הדעת'`
- `SOURCE_TYPE_LABELS.expert_opinion = 'חוות דעת'`
- `RULE_REFERENCES.expert_opinion = 'כלל 16 – חוות דעת'`
- Detection regex in `detectSourceType` before the government_decision block

### citationEngine.ts
- New `expert_opinion` entry in `CITATION_RULES` between `government_decision` and `foreign`
- Template: `"[שם חוות הדעת]" (חוות דעת של [זהות נותן חוות הדעת] [תאריך לועזי מלא]).`
- Notes covering 16.2 (capacity vs. private), 16.3 (date fallback), 16.4 (commissioner formula + example)

### citationValidation.ts
- Add `expert_opinion: "expert_opinion"` to `ENGINE_KEY_MAP`
- Extract: `opinionName` from quoted text, `opinionAuthor` from "חוות דעת של [X]", `fullDate` from date pattern, `opinionNumber` from "חוות דעת [number]"

### Edge function system prompt
- Add `"חוות דעת"` template entry with all sub-rules
- Add to the source type listing and formula reference sections

