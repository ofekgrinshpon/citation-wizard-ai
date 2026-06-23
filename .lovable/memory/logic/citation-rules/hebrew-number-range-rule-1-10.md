---
name: Hebrew number-range Rule 1.10
description: Rule 1.10 of כללי האזכור האחיד — Hebrew number ranges (years, pages, sections) must be written high→low in source order so they render visually as low-on-right, high-on-left in RTL.
type: feature
---

# Rule 1.10 — Hebrew number ranges

Source: כללי האזכור האחיד, סעיף 1.10. In Hebrew, a range separated by a dash must visually have the **low** number on the **right** and the **high** number on the **left** of the dash.

Because numeric runs render LTR inside an RTL paragraph, achieving that visual layout requires writing the **higher number FIRST** in logical/source order. Example: `1904-1882` (logical) renders as visual `1904-1882` with 1904 on the left, 1882 on the right.

## Implementation

- `supabase/functions/_shared/hebrewNumberRange.ts` — `normalizeHebrewNumberRanges(text)` (Deno).
- `src/lib/hebrewNumberRange.ts` — client-side mirror (must stay in sync).
- Applied in `supabase/functions/legal-research-v1/stages/drafterV2.ts` to `answer_markdown` and every footnote `text` after `buildFootnotedAnswer`.
- Applied client-side in `src/lib/legalQa/renderAnswerMarkdown.tsx` and on footnote titles in `src/components/LegalResearchV1Panel.tsx`, so legacy cached answers also display correctly.

## Scope and safety

- Only paragraphs containing Hebrew letters are touched (`[\u05D0-\u05EA]` test per paragraph split by `\n\n+`).
- Only ascending ranges `num1 < num2` are swapped; descending or equal ranges are left alone.
- Dates like `15-03-2024` are not touched (the third `-2024` triggers the negative look-around).
- Decimals like `1.5-2.5` are not touched (the `\d\.` look-behind / `\.\d` look-ahead exclude them).
- English/Latin-only paragraphs are untouched.

## Tests
`supabase/functions/_shared/hebrewNumberRange.test.ts` covers years, pages, en-dash, dates, decimals, equal numbers, multi-range, and mixed Hebrew/English.
