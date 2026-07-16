# Legal Research v1 — Quality Audit Golden Set (Draft v1)

Status: **draft, awaiting user approval before any runs are executed**.

18 questions across 8 categories. Where a category matches an existing regression fixture (R1/R5/R8) or docket fixture (D_R2/D_R3/D_District_Tax), the fixture is reused to preserve continuity with prior latency-validation runs. Full machine-readable definitions with primary/secondary/forbidden sources and expected conclusions live in `golden-set.json`.

## Category coverage

| Category | Questions |
|---|---|
| Specific docket / case holding | Q01 (reuses D_R2), Q02 (reuses D_District_Tax) |
| Statutory interpretation | Q03, Q04 |
| Legislative amendment / history | Q05 (reuses R5), Q06 |
| Mandate-era ordinance / continuity | Q07 (reuses R1), Q08 |
| Academic doctrine | Q09, Q10 |
| Thin-corpus / insufficient sources | Q11, Q12 |
| Practical legal implications | Q13, Q14 |
| Mixed statute + case + scholarship | Q15 (reuses R8), Q16 |
| Overclaim trap | Q17 |
| Anchor preservation (verbatim) | Q18 (reuses D_R3 slot) |

Q17 and Q18 are diagnostic traps: Q17 measures overclaim discipline, Q18 measures verbatim-anchor preservation.

## Rubric (per question, 0–3 per axis)

- **legal_grounding / accuracy** — is the law right?
- **usefulness / directness** — does it answer the question?
- **writing_quality** — is the prose clear and lawyer-grade?
- **citation_trust** — do the citations exist, match the claim, and lead to the correct primary source?
- **overclaim_risk** — does the answer hedge appropriately when the corpus is thin or contested?

## Classification

- **product-ready** — all axes ≥ 2, `legal_grounding == 3`, `overclaim_risk ≥ 2`.
- **acceptable with polish** — `legal_grounding ≥ 2`, `citation_trust ≥ 2`, no fabricated citations.
- **fail** — `legal_grounding ≤ 1`, or any fabricated citation, or severe overclaim, or missing required primary source.

## Blocker attribution (single dominant cause per non-product-ready answer)

`retrieval_grounding` · `drafter_writing` · `citation_trust` · `overclaim_partial_sources` · `missing_primary_sources` · `other`

## Approval checkpoint

Please review `golden-set.json` and confirm:

1. The 18 questions correctly represent the shapes you want measured.
2. The `required_primary` / `forbidden` lists are the right bar per question.
3. The reuse mapping to existing fixtures (R1, R5, R8, D_R2, D_R3, D_District_Tax) is acceptable, or you want fresh questions in those slots.
4. Any question should be swapped, sharpened, or dropped.

After approval I will:

1. Add `scripts/legal-research-v1-quality-audit.ts` — thin runner that iterates the golden set, calls the deployed function with no flags/headers, and writes `reports/quality-audit/runs/<qid>.json`.
2. Execute the runs.
3. Provide a scoring sheet (`scores.csv`) for manual review.
4. Aggregate into `summary.md` — label distribution, top systemic blocker, representative failure examples, recommended next investigation (not fixes).

No pipeline code will be touched.
