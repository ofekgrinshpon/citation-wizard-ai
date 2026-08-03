# Judgment-body acquisition (first-class stage) — acceptance table

Status: `judgment_body_acquisition_first_class = deployed / validated (monitor)`
Run set: 10 research diagnostic queries, all completed, no stubs, no verifier failures.

## A. Basic result

| # | Query | Branch | Drafted | used_sources | Grade | Stubs/verifier fails |
|---|---|---|---|---|---|---|
| R01 | Ka'adan | — (normal draft) | yes | 4 | good | no |
| R02 | Bank Mizrahi | — | yes | 11 | limited (no judgment body) | no |
| R03 | הלכת השיתוף | insufficient_sources_limitation | no | 0 | limited (correct refusal) | no |
| R04 | הרמת מסך | insufficient_sources_limitation | no | 0 | limited (correct refusal) | no |
| R05 | בטלות יחסית | — | yes | 9 | acceptable | no |
| R06 | צוואות הדדיות §8א | — | yes | 4 | good | no |
| R07 | תום לב §12 | — | yes | 13 | acceptable (source-soup) | no |
| R08 | מידתיות | — | yes | 11 | acceptable | no |
| R09 | מבחן ההשתלבות | — | yes | 8 | acceptable | no |
| R10 | הרמת מסך משפחתי | — | yes | 9 | acceptable | no |

## B. Acquisition summary

| # | Acq mode | Judgment cands | Excluded (reason) | Attempts | Successes | Method | Text len | docket/title in body | holding_text | usable_for_holding |
|---|---|---|---|---|---|---|---|---|---|---|
| R01 | specific_case | 7 | 0 | 1 | 1 | direct_file_fetch | 6000 | yes | yes | 1 |
| R02 | specific_case | 5 | 0 | 0 (eligible=0) | 0 | — | — | — | no | 0 |
| R03 | case_law_synthesis | 9 | 0 | 3 | 1 | direct_file_fetch | 6000 | yes | yes | 1 |
| R04 | case_law_synthesis | 5 | 1 (no_docket_or_title_signal) | 1 | 0 (no_local_document_match) | — | — | — | no | 0 |
| R05 | doctrine_explanation | 4 | 0 | 0 | 0 | — | — | — | no | 0 |
| R06 | doctrine_explanation | 2 | 0 | 0 | 0 | — | — | — | no | 0 |
| R07 | statute_section_definition | 0 | 0 | 0 (stage not applicable) | 0 | — | — | — | no | 0 |
| R08 | doctrine_explanation | 2 | 0 | 0 | 0 | — | — | — | no | 0 |
| R09 | doctrine_explanation | 6 | 2 (institutional_page, no_docket_or_title_signal) | 0 | 0 | — | — | — | no | 0 |
| R10 | doctrine_explanation | 4 | 0 | 0 | 0 | — | — | — | no | 0 |

R03 failure detail: attempt 1 `local_db_docket_lookup_timeout`, attempt 2 `no_local_document_match`, attempt 3 succeeded via `direct_file_fetch`.

## C. Before/after vs earlier diagnostic

| # | Acquisition | Draftability | Authority hierarchy | Commentary reliance |
|---|---|---|---|---|
| R01 | improved (0→1 body, holding text) | improved (real holding answer) | improved (official_primary leads) | reduced |
| R02 | unchanged (0 bodies; eligibility=0) | unchanged | unchanged (14/19 commentary) | unchanged |
| R03 | improved (1 body acquired) | unchanged (still limitation) | slightly improved | unchanged |
| R04 | unchanged (1 attempt, 0 success) | unchanged (limitation) | unchanged | unchanged |
| R05–R08, R10 | unchanged (no judgment candidates eligible) | unchanged | unchanged | unchanged (high) |
| R09 | changed: stage now *runs* outside synthesis (doctrine_explanation) and correctly excluded an institutional page before spending budget; 0 attempts | unchanged | unchanged | unchanged |

## D. Remaining bottleneck per query

| # | Bottleneck |
|---|---|
| R01 | no major bottleneck |
| R02 | acquisition (exact Mizrahi judgment never becomes an eligible candidate → also discovery) |
| R03 | sufficiency (1 body acquired but not admitted as usable judgment authority) |
| R04 | acquisition |
| R05 | authority hierarchy (0 judgments; scholarship-heavy) |
| R06 | authority hierarchy |
| R07 | authority hierarchy (13 used sources, source-soup) |
| R08 | discovery (3 listing pages, 0 judgments) |
| R09 | acquisition (6 judgment candidates, 0 attempts — eligibility filter too strict) |
| R10 | discovery / authority hierarchy |

## Acceptance criteria

| Criterion | Result |
|---|---|
| R01 answers from acquired Ka'adan body | PASS |
| R02 answers from exact judgment text or marked missing body | PASS (marked missing: 0 judgment documents) |
| R03/R04 improve only if leading bodies acquired, else limitation | PASS (both limitation) |
| R09 shows acquisition runs outside case_law_synthesis | PASS (stage active in doctrine_explanation) |
| Institutional pages excluded before budget spend | PASS (R09 `institutional_page`) |
| Nevo/psakdin not treated as judgment body | PASS (0 attempts against them; psakdin stays `metadata_only` / commentary) |
| No metadata-only holdings | PASS |
| No commentary as primary authority | PASS (no leading authority sourced from commentary in drafted answers) |
| No stubs / verifier failures | PASS (10/10) |
| No model-routing or drafter changes | PASS |

## Next candidate track (not opened)

Acquisition *eligibility* is now the binding constraint, not acquisition itself: R02 (5 candidates) and R09 (6 candidates) produced 0 attempts. Widening the eligibility predicate — and revisiting R03's sufficiency gate, which rejected an acquired body — is the highest-value next step.
