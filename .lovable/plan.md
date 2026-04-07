

# Add Rules 17.1 & 17.2 – Planning Committee Plans & Collective Agreements

## Overview
Add two new source types:
1. **`planning_plan`** (Rule 17.1) – Planning committee plans, cited like governmental body decisions (Rule 15)
2. **`collective_agreement`** (Rule 17.2) – Collective labor agreements with a unique formula

## Formulas

**Planning plans (17.1):** Cited like Rule 15 (governmental body decisions):
`תכנית מפורטת [מספר] של [שם הוועדה] "[שם התכנית]" ([שנה/תאריך])`

**Collective agreements (17.2):**
`הסכם קיבוצי מס' [מספר] בין [צד א'] ל[צד ב'] בעניין [נושא] ([תאריך])`
- If a party has multiple entities, cite the first + "ואח'" if the rest aren't important.

## Changes

| File | Change |
|------|--------|
| **`src/data/abbreviations.ts`** | Add `planning_plan` and `collective_agreement` to `SourceType`. Add to `REQUIRED_FIELDS`, `FIELD_LABELS`, `SOURCE_TYPE_LABELS`, `RULE_REFERENCES`. Add detection regexes before the `תקנון` check. |
| **`src/data/citationEngine.ts`** | Add two new `CITATION_RULES` entries with templates, examples, components, and notes. |
| **`src/lib/citationValidation.ts`** | Add both types to `ENGINE_KEY_MAP` with field extraction patterns. |
| **`src/components/SourceTypeConfirmation.tsx`** | Add two entries: "🏗️ תכנית תכנון ובנייה" and "🤝 הסכם קיבוצי". |
| **`supabase/functions/citation-chat/index.ts`** | Add both source types to `CITATION_ENGINE_TEMPLATES` and system prompt with formulas, sub-rules, and examples. |

## Detection logic
```typescript
// Rule 17.1 – Planning committee plans
if (/תכנית\s+מפורטת|תכנית\s+(?:בניין|בנין)\s+עיר|תב"ע|תכנית\s+מתאר/.test(hebrewText)) return 'planning_plan';

// Rule 17.2 – Collective agreements
if (/הסכם\s+קיבוצי/.test(hebrewText)) return 'collective_agreement';
```
Placed after `expert_opinion` and `government_decision` checks, before legislation checks.

## New fields
**Planning plan:**
- `planNumber` – required (e.g. "2549א'")
- `decidingBody` – required (reuse existing field; the committee name)
- `decisionName` – required (reuse; the plan's descriptive name, in quotes)
- `fullDate` – required (year or full date)

**Collective agreement:**
- `agreementNumber` – required (e.g. "2008/7033")
- `party1` – required (first party)
- `party2` – required (second party)
- `agreementSubject` – required (the topic after "בעניין")
- `fullDate` – required (agreement date)

## Technical details

### abbreviations.ts
- Add to `SourceType` union: `| 'planning_plan'` and `| 'collective_agreement'` after `expert_opinion`
- `REQUIRED_FIELDS.planning_plan = ['planNumber', 'decidingBody', 'decisionName', 'fullDate']`
- `REQUIRED_FIELDS.collective_agreement = ['agreementNumber', 'party1', 'party2', 'agreementSubject', 'fullDate']`
- New `FIELD_LABELS` entries: `planNumber: 'מספר תכנית'`, `agreementNumber: 'מספר הסכם'`, `agreementSubject: 'נושא ההסכם'`

### citationEngine.ts
- `planning_plan`: primaryRule `"17.1"`, note that formatting follows Rule 15 pattern
- `collective_agreement`: primaryRule `"17.2"`, note about "ואח'" for multi-entity parties

### Edge function system prompt
- Add both templates with full formulas and examples
- For 17.1, reference Rule 15 format
- For 17.2, include the "ואח'" multi-party rule

