# non_academic_source_binding_and_csm_v1 — acceptance report

Code: `stages/nonAcademicBinding.ts` (new), `stages/claimSourceMatch.ts`,
`stages/footnoteBuilder.ts`, `stages/drafterV2.ts`, `index.ts`,
tests `src/test/nonAcademicBinding.test.ts` (13/13; suite 235 passed).
Answers: `reports/non-academic-regression-smoke-v1/ANSWERS_V2.md`.

## 1. Routing

| id | run_id | intent | academic_writing | correct route |
|----|--------|--------|------------------|----------------|
| Q1 | 67d38b2a | doctrine_explanation | no | yes |
| Q2 | 6b118398 | statutory / Basic Law | no | yes |
| Q3 | 3d131f0d | case-law doctrine | no | yes |

No `הערת עבודה`, no academic chapter framing, no academic notices in any answer.

## 2. Primary anchor binding

| id | detected_statutory_target | bound_to_blocks | statute in pack | statute footnote |
|----|---------------------------|-----------------|-----------------|------------------|
| Q1 | none (pure doctrine) | 0 | 0 | — |
| Q2 | חוק-יסוד: כבוד האדם וחירותו | 1 (`nominated-source:N1`) | 1 | yes (fn 1) |
| Q3 | none nominated | 0 | 0 | — |

Before: Q2 `local_primary_anchor = null`, statutory claims uncited. After: the Basic Law
is bound and carries the statutory claims.

## 3. Local judgment pack flow

| id | protected local judgments | admitted to pack | final judgment_count | before |
|----|---------------------------|------------------|----------------------|--------|
| Q1 | 7 | 0 | 0 | 0 |
| Q2 | 20–45 (run-dependent) | 0–1 | 0–1 | 0 |
| Q3 | 21 | 1 | 1 | run died |

Admission is now non-zero on the case-law path (Q3 cites עע"מ 4614-05 with holding text).
Q1's judgments remain out — the surviving drops are genuine claim mismatches, not area bugs.

## 4. CSM legal-area equivalence

| id | block_area | source_area | doctrine overlap | equivalence applied |
|----|-----------|-------------|------------------|---------------------|
| Q1 | constitutional | public_law_hcj | reasonableness, basic_rights | yes |
| Q2 | — | — | — | not needed |
| Q3 | — | — | — | not needed |

`unrelated_legal_area` no longer appears in any drop reason. Cross-family pairs stay blocked
(unit-tested).

## 5. Claim-category calibration

| id | block | old | new | reason |
|----|-------|-----|-----|--------|
| Q1 | b2,b4,b5 | court_holding | doctrinal_synthesis | generic doctrine paragraph, no holding assertion |
| Q2 | b0,b2 | statutory | doctrinal_synthesis | practical explanation without statutory text |
| Q3 | b2,b3 | court_holding | doctrinal_synthesis | generic doctrine paragraph |

Blocks that name a docket or assert a holding keep the strict primary requirement.

## 6. Compound footnotes

Before: Q2 rendered one marker concatenating two unrelated articles (`source_type: compound`).
After: unrelated companions are pruned before label construction — Q2 now shows two separate,
correctly labelled footnotes; no `compound` type in any run.

## 7. Limitation notes

| id | notes_before | notes_after | type | accurate |
|----|--------------|-------------|------|----------|
| Q1 | 1 | 1 | no_direct_caselaw | yes |
| Q2 | 1 | 1 | partial_support | yes |
| Q3 | 1 | 1 | partial_support | yes |

Stacked double notices are gone; one merged `מגבלת ביסוס` per answer.

## 8. Runtime

| id | total | discovery | verifier | drafter | before |
|----|-------|-----------|----------|---------|--------|
| Q1 | 161s | 0.3s | 44.6s | 44.8s | 214s |
| Q2 | 181–205s | 0.3–0.9s | 43–108s | 23–25s | 177s |
| Q3 | 130s | 0.4s | 32.1s | 21.4s | 819s, reaped |

No reap, no refund in any run. Q3 — previously the total failure — is now the fastest.

## 9. Answer quality (1–10)

| id | directness | usefulness | citation precision | over-academic | caution | verdict |
|----|-----------|------------|--------------------|---------------|---------|---------|
| Q1 | 8 | 7 | 5 (1 fn, secondary only) | 3 | 6 | pass, thin sourcing |
| Q2 | 8 | 8 | 8 (statute + doctrine) | 3 | 5 | pass |
| Q3 | 8 | 8 | 8 (judgment + doctrine) | 3 | 5 | pass |

## 10. Safety

No secondary source supports statutory text, a holding, a docket outcome or a quote.
Identity, metadata-only, found-only, source-integrity, topic-aware and footnote invariants
unchanged. No citation padding. Academic mode untouched.

## 11. Remaining defects

1. Q1 still ends with only one secondary footnote; its local judgments drop on genuine
   claim mismatch — a ranking/facet issue, not a gate bug.
2. Court-PDF display titles can be garbled (a Q2 rerun rendered
   "חוק כי סבור אני אף…" from a supremedecisions PDF) — display-title hygiene track.
3. Verifier is the dominant cost (up to 108s).

Recommendation: the non-academic regression is resolved; Hebrew naturalness can proceed,
with court-PDF title hygiene handled in parallel.
