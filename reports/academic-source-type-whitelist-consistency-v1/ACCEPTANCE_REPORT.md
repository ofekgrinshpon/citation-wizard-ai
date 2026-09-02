# academic_source_type_whitelist_consistency_v1 — Acceptance Report

Date: 2026-09-02. Patch implemented per approval of the AW4 post-draft ref-loss audit
(`reports/academic-post-draft-ref-loss-audit-v1/REPORT.md`).

## Change (three-line whitelist class, no new logic)

1. `stages/doctrinalSourceTyping.ts` — added `"academic"`, `"working_paper"`,
   `"faculty_pdf"` to `EXISTING_DOCTRINAL_TYPES`.
2. `stages/sourceSufficiency.ts` — same three types added to `DOCTRINAL_TYPES`.
3. `stages/doctrinalCandidateStabilization.ts` — same three types added to
   `DOCTRINAL_TYPES`.

Telemetry: `doctrinal_sufficiency_trace.typing_ineligible_reason_counts` now
logged per run (verified live: `{"not_doctrinal_type": 8}` on AW4).

Tests: `src/test/academicSourceTypeWhitelist.test.ts` — 9 tests covering
academic-type eligibility (16k body + direct ⇒ eligible), sub-floor body ⇒
ineligible, metadata-only ⇒ ineligible, tangential verdict ⇒ ineligible, and
primary-law guards (`court_holding`/`statutory` reject an academic source;
academic categories accept it). Full doctrinal suite: 36/36 pass.

## Safety gates — all preserved

- 400-char citability floor: AW8 dropped 4 journal articles with 283–395-char
  bodies (`no_acquired_body_text`). Correct.
- Metadata-only caselaw stubs (25–394 chars) still ineligible. Correct.
- `categoryAccepts` untouched: `court_holding` requires `judgment_authority`,
  `statutory` requires statutory/judgment — an academic-typed source can only
  ever hold `doctrinal_authority` (regression-tested).
- Verifier + topical-fit requirements unchanged (`verifier_not_direct_or_partial`
  still fires).

## Validation (deployed 2026-09-02, AW4 first, then AW1/AW7/AW8 smoke)

| run | genre | doctrinal eligible in pack | footnotes | before patch |
|-----|-------|---------------------------|-----------|--------------|
| AW4 | theoretical_background | 4 (s4, s5, s10, s12) | **4** | 1 |
| AW1 | introduction | 3 | 4 | 4 |
| AW7 | argument_paragraph | 6 | 1 (1 substantive block — correct for short genre) | 1 |
| AW8 | generic_academic | 4 | 4 | 1 |

### AW4 detail (run `975d1154-6ef7-475f-a239-75f335aa808c`)

The Haifa faculty PDF class of source (`law.haifa.ac.il` — the exact class that
was falsely dropped pre-patch) now reaches the drafter as eligible doctrinal
secondary and is cited: footnotes include `הפרדת רשויות ומידתיות` (Cohen/Elia,
Haifa) and `מידתיות חוקתית, סבירות מנהלית` (Nadav Dagan, Haifa) plus a TAU Law
Review article. Zero `commentary_in_substantive_block` drops of eligible
doctrinal sources in AW4. Remaining drops (6) are correct: metadata-only
caselaw stubs and one sub-floor body.

### AW8 detail (run `afe25ea0-...`)

5/6 substantive blocks covered, 12 model-emitted refs, 4 rendered footnotes —
all from acquired, topical, role-fit sources. The one uncovered block is
`methodological_framing` where the drafter emitted no ref despite s1/s6/s7
being role-fit — a drafter-emission nuance, not post-draft loss. The single
`commentary_in_substantive_block` drop hit a short-body ineligible source —
correct.

### AW7 note

6 doctrinal sources eligible (incl. a 7k-char `scholarship` item); the genre is
a single argument paragraph, so 1 block / 1 footnote is the intended shape.
No regression.

## Acceptance criteria

- ✅ AW4 academic/university-domain sources no longer dropped as
  `commentary_in_substantive_block`.
- ✅ Footnotes increased only from acquired, topical, role-fit sources.
- ✅ No safety regression (primary-law rules, floors, identity checks intact;
  36/36 tests pass).

## Follow-ups (not blockers)

- Footnote dedupe: AW4 rendered two rows for the same `cohen-elia.pdf` URL
  (one grouped, one single). Worth a look in `footnoteBuilder` grouping.
- AW8 `methodological_framing` block emitted no ref despite role-fit sources —
  drafter steering for that category could be tightened.
- Proceed to Hebrew naturalness track — the mechanical under-citation cause is
  now closed.
