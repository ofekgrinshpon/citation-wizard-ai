# claim_source_match_rule_de_precision_audit_v1 — read-only

No code changed. Evidence: `qa_logs.metadata.drafter.{claim_source_match, doctrinal_typing,
topic_aware_alignment, used_sources, synthesis_pack}` for the six most recent fixture runs.

| fixture | run_id | sources passed | footnotes | total CSM drops | Rule D/E drops |
|---|---|---|---|---|---|
| Q1 doctrine Q&A | 8b848104 | 16 | 1 | 10 | 8 |
| Q2 statutory Q&A | 01bd9b25 | 5 | 2 | 9 | 1 |
| Q3 case-law doctrine | c9aaf1ff | 8 | 3 | 7 | 5 |
| AW4 theoretical_background | 7e01ab5b | 12 | 4 | 6 | 5 |
| AW7 argument_paragraph | 3dd11d95 | 13 | 1 | 2 | 2 |
| AW9 theoretical_background | 6b61db52 | 0 | 0 | 0 (stage never ran) | 0 |

## 1. Labelled dropped refs (Rule D/E only)

| run | block | claim category | ref | source (type, acquired body) | src area → claim area | drop reason | supports claim? | label | action |
|---|---|---|---|---|---|---|---|---|---|
| Q1 | b1 | doctrinal_synthesis | s4 | caselaw, 394 ch | null → public_law_hcj | insufficient_authority | no (stub) | correct_drop_metadata_or_unsafe | none |
| Q1 | b1 | doctrinal_synthesis | s5 | caselaw, 391 ch | null → public_law_hcj | insufficient_authority | no | correct_drop_metadata_or_unsafe | none |
| Q1 | b2 | doctrinal_synthesis | s1 | caselaw, 395 ch | public_law_hcj | insufficient_authority | no | correct_drop_metadata_or_unsafe | none |
| Q1 | b3 | doctrinal_synthesis | s4 | caselaw, 394 ch | null | insufficient_authority | no | correct_drop_metadata_or_unsafe | none |
| Q1 | b4 | doctrinal_synthesis | s5 | caselaw, 391 ch | null | insufficient_authority | no | correct_drop_metadata_or_unsafe | none |
| Q1 | b2,b5 | doctrinal_synthesis | s15 (×2) | caselaw, 400 ch | contracts → public_law_hcj | unrelated_legal_area | no | correct_drop_off_topic | none |
| Q1 | b5 | doctrinal_synthesis | s16 | caselaw, 400 ch | contracts → public_law_hcj | unrelated_legal_area | no | correct_drop_off_topic | none |
| Q2 | b0 | doctrinal_synthesis | s3 | caselaw, 400 ch | null → public_law_hcj | insufficient_authority | no | correct_drop_metadata_or_unsafe | none |
| Q3 | b2,b3,b5 | doctrinal_synthesis | s6 (×3) | caselaw, 399 ch | constitutional | insufficient_authority | no | correct_drop_metadata_or_unsafe | none |
| Q3 | b3,b5 | doctrinal_synthesis | s5 (×2) | caselaw, 399 ch | null | insufficient_authority | no | correct_drop_metadata_or_unsafe | none |
| AW4 | b1 | critique_or_counterposition | s13 | supreme_court_il בג"ץ 6427/02 התנועה לאיכות השלטון, 6,000 ch | public_law_hcj → constitutional | unrelated_legal_area | **yes** | likely_false_drop_area_mismatch | academic area equivalence |
| AW4 | b3 | critique_or_counterposition | s2 | journal, נדב דגן "מידתיות חוקתית, סבירות מנהלית", 16,000 ch | constitutional → public_law_hcj | unrelated_legal_area | **yes** | likely_false_drop_area_mismatch | academic area equivalence |
| AW4 | b4 | theoretical_explanation | s10 | journal, ייצוג משפטי בדין המשמעתי בצבא, 9,647 ch | public_law_hcj → constitutional | unrelated_legal_area | marginal | unclear_needs_manual_review | keep dropped unless doctrine overlap |
| AW4 | b4 | theoretical_explanation | s7 | journal, ארגוני עובדים ומו"מ קיבוצי, 2,746 ch | contracts → constitutional | unrelated_legal_area | no | correct_drop_off_topic | none |
| AW4 | b3 | critique_or_counterposition | s9 | caselaw, 392 ch | public_law_hcj | insufficient_authority | no | correct_drop_metadata_or_unsafe | none |
| AW7 | b0 | critique_or_counterposition | s1 | חוק יסוד: כבוד האדם וחירותו, 1,633 ch | constitutional → public_law_hcj | unrelated_legal_area | no (statute cannot carry a critique claim; alignment also rejects it) | correct_drop_wrong_authority | none |
| AW7 | b0 | critique_or_counterposition | s2 | journal, נדב דגן, 16,000 ch | constitutional → public_law_hcj | unrelated_legal_area | **yes** | likely_false_drop_area_mismatch | academic area equivalence |

`commentary_in_substantive_block` did not fire in any of the six runs.

## 2. Rule D legal-area precision

| claim | claim_area | source_area | doctrine overlap | supports claim | drop reason | verdict | suggested fix |
|---|---|---|---|---|---|---|---|
| AW4 b1 critique | constitutional | public_law_hcj | proportionality, judicial_review | yes | unrelated_legal_area | false drop | academic-mode area equivalence |
| AW4 b3 critique | public_law_hcj | constitutional | proportionality, reasonableness | yes | unrelated_legal_area | false drop | same |
| AW4 b4 theory | constitutional | public_law_hcj | thin (military discipline) | marginal | unrelated_legal_area | acceptable | require doctrine-term overlap |
| AW4 b4 theory | constitutional | contracts | none | no | unrelated_legal_area | correct | keep |
| AW7 b0 critique | public_law_hcj | constitutional | proportionality, reasonableness | yes | unrelated_legal_area | false drop | academic-mode area equivalence |
| Q1 b2/b5 | public_law_hcj | contracts | none | no | unrelated_legal_area | correct | keep |

Root cause: the controlled `constitutional ↔ public_law_hcj` equivalence built in
`non_academic_source_binding_and_csm_v1` is computed **only when `!academicMode`**
(`claimSourceMatch.ts:565`). In academic mode the only escape is the role override, which
additionally requires `hasRole(ref, category)` and a `direct` verdict. All three false drops
show `topical_fit_passed: true` and `overridden: false` — the fit test passed, the role/verdict
gate did not. Non-academic Rule D is behaving correctly: every drop was an off-doctrine
`contracts` source.

## 3. Rule E authority/category precision

| claim | claim_category | source_type | role | acceptable? | drop reason | verdict | fix |
|---|---|---|---|---|---|---|---|
| Q1 b1–b4 | doctrinal_synthesis | caselaw 390–400 ch, no acquired body | judgment (nominal) | no | insufficient_authority | correct | none — acquisition problem |
| Q2 b0 | doctrinal_synthesis | caselaw 400 ch | judgment | no | insufficient_authority | correct | none |
| Q3 b2,b3,b5 | doctrinal_synthesis | caselaw 399 ch | judgment | no | insufficient_authority | correct | none |
| AW4 b3 | critique_or_counterposition | caselaw 392 ch | judgment | no | insufficient_authority | correct | none |

Answers to the audit questions:

- General doctrine summaries are **not** over-classified as `court_holding` any more: every
  non-academic block in Q1–Q3 came through as `doctrinal_synthesis` (post-calibration).
- Academic/doctrinal sources are **not** barred from doctrine explanations. Every eligible
  16k-body journal article passed Rule E; not one full-body scholarship item was dropped by E.
- Statutory claims stay statute-only and holdings stay judgment-only — unchanged.
- `commentary_in_substantive_block` never fired; it is not currently too broad.
- Every Rule E drop in all six runs was a caselaw candidate with a 390–400-character body,
  i.e. a metadata-only judgment stub. Rule E is doing exactly its job.

## 4. Safe recovery potential

| run_id | fixture | rule D/E drops | correct | likely false | unclear | safe footnote gain | risk |
|---|---|---|---|---|---|---|---|
| 8b848104 | Q1 | 8 | 8 | 0 | 0 | 0 | — |
| 01bd9b25 | Q2 | 1 | 1 | 0 | 0 | 0 | — |
| c9aaf1ff | Q3 | 5 | 5 | 0 | 0 | 0 | — |
| 7e01ab5b | AW4 | 5 | 3 | 2 | 1 | +1–2 | low |
| 3dd11d95 | AW7 | 2 | 1 | 1 | 0 | +1 | low |
| 6b61db52 | AW9 | 0 | — | — | — | 0 (retrieval failure, CSM never ran) | — |
| **total** | | **21** | **18** | **3** | **1** | **+2–3 (academic only)** | low |

False-drop rate: 3/21 = 14%, entirely inside academic mode, entirely
`constitutional ↔ public_law_hcj`.

## 5. Recommendation

Rule D/E is **not** the non-academic footnote bottleneck. Zero false drops in Q1–Q3. The
real non-academic loss is upstream: 8 of Q1's 16 pack sources are 390–400-char caselaw stubs
with no acquired body, and the one that did get a body has a garbled court-PDF display title.
Q1's 16→1 funnel is an acquisition-and-identity problem, not a gating problem.

Minimal implementation worth doing (small, academic-only):

**`csm_academic_area_equivalence_v1`** — reuse the existing
`evaluateAreaEquivalence` from `nonAcademicBinding.ts` as a *second* escape in academic mode,
after the role override fails, gated on:
`academicCategory && !primary-required category && topical_fit_passed && verdict ∈ {direct, strongPartial} && doctrine-term overlap ≥ 1`.
Expected gain +2–3 footnotes on AW4/AW7; no change to Q1–Q3.

Do **not** implement: claim-category recalibration (already correct), commentary allowance
(rule never fires), per-claim class widening (topic-aware alignment already owns that).

Higher-leverage next track instead: `judgment_body_acquisition_stability_v1` — the 390–400-char
caselaw stubs, which account for 18 of the 21 Rule D/E drops and for Q1's single footnote.
Also worth noting outside this audit's scope: `claim_mismatch` produced 13 of the 34 total drops
(Q2 alone: 8), a larger loss channel than Rule D/E.

## Safety risks of the recommendation

- Area equivalence in academic mode could let an adjacent-but-misleading public-law source
  carry a constitutional claim. Mitigated by requiring doctrine-term overlap and the existing
  topical-fit pass; family crossing (contracts ↔ public law) stays blocked by
  `evaluateAreaEquivalence`'s adjacency table.
- Categories that require primary authority (`court_holding`, `statutory`, and any block
  escalated by docket identity or binding-law wording) must be excluded from the new escape,
  or a judgment/statute claim could be carried by an adjacent-area secondary.
- No change to admission, retrieval, integrity, metadata-only rules or footnoteBuilder;
  the escape can only *retain* refs already admitted and already topic-fitted.
