# Legal Research v1 — Quality Audit Golden Set (Draft v2)

Status: **draft v2, awaiting user approval before any runs are executed**.

## Changelog vs v1

1. **`reuse_of` renamed to `category_continuity_with`** and only set where the *shape* is continuous with a prior fixture; misleading matches removed. No question claims to be the same query as a prior fixture anymore.
   - Q01: removed continuity with D_R2 (different docket/topic).
   - Q02: continuity with D_District_Tax kept (both are district-docket missing-source shapes).
   - Q05: continuity with R5 kept (amendment-history shape).
   - Q07: continuity with R1 kept (mandate-ordinance shape).
   - Q15: continuity with R8 kept (fintech mixed-sources shape).
   - Q18: removed continuity with D_R3 (different question).

2. **Q01 corrected.** Switched to **בג"ץ 6298/07 רסלר** — the 2012 ruling that led to the חוק טל invalidation. בג"ץ 6427/02 is retained only as historical background, and asserting that it invalidated the law is now on the **forbidden** list.

3. **Q02 reframed as an explicit missing-primary-source test.** `test_intent: missing_primary_source`. The correct behavior is that the system says the judgment was not found and refuses to infer the holding. Inventing a holding or swapping in a different case = fail.

4. **Overly broad questions narrowed:**
   - Q06: from "detention powers 1996–2020" → a single specific amendment to §21 of the Arrests Law.
   - Q10: from the full purposive-vs-formalist debate → a specific pair (Apropim + Friedmann's critique).
   - Q14: from "a corporation" → **currency service providers (נותן שירותי מטבע)** with the sector-specific 2014 order named. If sector is ambiguous, the system must ask or disclose the sector-dependency.
   - Q16: from tri-domain (income tax + VAT + labor law) → labor-law employee-classification tests and their effect on pension contributions.

5. **Q18 source standard fixed.** Required source is now official: Knesset (`main.knesset.gov.il`) / Sefer HaChukim / Reshumot. Wikisource is downgraded to *acceptable secondary as a helper only*. Presenting Wikisource as the official source is now explicitly forbidden and fails the question.

## Category coverage (18 questions)

| Category | Questions |
|---|---|
| Docket / case holding | Q01 (בג"ץ 6298/07 רסלר) |
| Docket / case holding — missing-source test | Q02 (district tax docket) |
| Statutory interpretation | Q03, Q04 |
| Legislative amendment / history | Q05 (continuity with R5), Q06 (narrowed) |
| Mandate-era ordinance / continuity | Q07 (continuity with R1), Q08 |
| Academic doctrine | Q09, Q10 (narrowed) |
| Thin-corpus / insufficient sources | Q11, Q12 |
| Practical legal implications | Q13, Q14 (narrowed to CSP sector) |
| Mixed statute + case + scholarship | Q15 (continuity with R8), Q16 (narrowed) |
| Overclaim trap | Q17 |
| Anchor preservation (verbatim, official source) | Q18 |

## Rubric

Unchanged from v1. 0–3 per axis on legal_grounding, usefulness, writing_quality, citation_trust, overclaim_risk. Classification: **product-ready / acceptable-with-polish / fail**. Blocker attribution per non-product-ready answer.

## Approval checkpoint

Please review `golden-set.json` and confirm the v2 revisions. On approval I will:

1. Add `scripts/legal-research-v1-quality-audit.ts` — thin runner, no flags, no headers.
2. Execute the 18 runs.
3. Emit `scores.csv` template for manual scoring and `summary.md` with label distribution, top blocker, and representative failure examples.

No pipeline code will be touched.
