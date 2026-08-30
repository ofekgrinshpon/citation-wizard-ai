# academic_draft_presentation_hygiene_v1 — acceptance

## What shipped
- `stages/academicPresentationHygiene.ts`: bullets→prose, heading strip, URL scrub,
  single-paragraph contract for `argument_paragraph` (150–300 words), deterministic
  topic-drift paragraph drop, and exactly one trailing "הערת עבודה" note
  (+ optional compact "להמשך בדיקה" line).
- `stages/drafterV2.ts`: for `user_task_intent = academic_writing` all legacy limitation
  blocks (academic_limited, reference-only, limited-doctrinal, claim-match limitation)
  are suppressed and replaced by the single note; telemetry in
  `academic_presentation_hygiene`.
- `index.ts`: partial-retrieval / extraction-cut notes suppressed for academic drafts.
- Prompt: prose-only rules per genre, one-paragraph rule for argument_paragraph,
  topic-focus rule, no-URLs-in-body rule.

## Live re-run (AW1, AW4, AW5, AW7, AW8)
| id | genre | len | bullets | raw URLs | "הערת עבודה" | other caveats |
|----|-------|-----|---------|----------|--------------|---------------|
| AW1 | introduction | 5111 | 0 | 0 | 1 | 0 |
| AW4 | theoretical_background | 3047 | 0 | 0 | 1 | 0 |
| AW5 | research_question | 1802 (re-run) | 0 | 0 | 1 | 0 |
| AW7 | argument_paragraph | 1135 / ~155 words body, single paragraph | 0 | 0 | 1 | 0 |
| AW8 | generic_academic | 3099 | 0 | 0 | 1 | 0 |

All five: no gap-opener, prose only, no stacked caveats, no URLs in body.
Topic drift: AW5's first run pivoted to religious courts; after the deterministic
drift guard the re-run stays on political appointments only.

## Tests
`src/test/academicPresentationHygiene.test.ts` — 12/12 (prose enforcement, outline/list
exemptions, URL scrub, paragraph contract, single caveat, drift guard both directions).

## Verdict
ACCEPTED. Monitor `academic_presentation_hygiene.drift_paragraphs_dropped` and
`paragraph_trimmed` for over-trimming.
