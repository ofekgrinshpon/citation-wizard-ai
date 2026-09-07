# rabbinical_court_answer_authority_relevance_audit_v1 (read-only)

Run: `8be5d95a-defc-4c27-9531-ca87890176c0` (2026-09-07 01:16 UTC), status `done`,
4 claims (C1–C4), 12 planned queries, 18 candidates, 39 dropped sources, 3 footnotes.
No code, prompt, retrieval, ranking, CSM, alignment, pack or drafter change was made.

## 1. Relevant-authority trace

| source | found | admitted | body | topicality | verifier | in_pack | cited | loss_stage | loss_reason |
|---|---|---|---|---|---|---|---|---|---|
| בג"צ 1000/92 בבלי (judgments.org.il full text) | yes (perplexity, query `בג"ץ 1000/92 בבלי`) | **no** | – | not reached | not reached | no | no | web admission | `class_unknown_not_admitted_for_binding_case_law` |
| בג"צ 1000/92 בבלי (daat.ac.il) | yes | **no** | – | – | – | no | no | web admission | `class_academic_not_admitted_for_binding_case_law` (+ `..._persuasive_case_law`) |
| בג"ץ בבלי (Wikipedia) | yes | no | – | – | – | no | no | admission | `bad_source` (correct) |
| ארכיון הלכת בבלי | yes | no | – | – | – | no | no | web admission | `class_unknown_not_admitted_for_binding_case_law` |
| בג"ץ 6641/11 פלונית נ' ביה"ד הרבני הגדול (×4 URLs) | yes | no | – | – | – | no | no | discovery | `discovery_only` (never promoted to retrieval) |
| בג"ץ 2598/02, בג"ץ 1908/21, בג"ץ 14/14, בג"ץ 7828/15, בג"צ 71717-11-24, בג"צ 6591/11 | yes | no | – | – | – | no | no | discovery | `discovery_only` |
| בג"צ 5387/13 פלונית נ' ביה"ד הרבני האזורי | yes | no | – | – | – | no | no | web admission | `class_unknown_not_admitted_for_binding_case_law` |
| "מתי יתערב בג"ץ בהחלטות בתי הדין הרבניים?" / "התערבות בג"ץ בפסקי דין של בתי הדין הרבניים" | yes | no | – | – | – | no | no | web admission | `class_unknown_not_admitted_for_binding_case_law` |
| IDI: בתי הדין הרבניים: שירות דת או ערכאה שיפוטית | yes | no | – | – | – | no | no | web admission | `class_unknown_not_admitted_for_scholarship` |
| פסקי דין רבניים בנושאי משפחה (גיליונות 35, 49 – Rackman/CWJ) | yes | no | – | – | – | no | no | web admission | `class_unknown_not_admitted_for_scholarship` |
| כריכת ענייני רכוש לאחר פס"ד גירושין | yes | no | – | – | – | no | no | web admission | `class_unknown_not_admitted_for_scholarship` |
| חוק שיפוט בתי דין רבניים (נישואין וגירושין) — local_db row | yes | candidate only | no | – | – | no | no | pack selection | not selected (בג"ץ-generic `חוק בתי המשפט` took the statute slot as s1, then CSM dropped it) |
| חוק שיפוט בתי דין רבניים — web copy | yes | no | – | – | – | no | no | admission | `bad_source` |
| **סימה אמיר (בג"ץ 8638/03)** | **not found at all** — no query, no candidate, no drop row | – | – | – | – | – | – | – | never nominated |

So: the בבלי line, the modern rabbinical-court בג"ץ line and on-point scholarship **were all discovered and then lost**. סימה אמיר was never even nominated in this run.

Aggregate drop reasons: `discovery_only` 19, `class_unknown_not_admitted_for_binding_case_law` 8,
`class_unknown_not_admitted_for_scholarship` 4, `bad_source` 4,
`class_academic_not_admitted_for_binding_case_law` 2, `class_academic_not_admitted_for_persuasive_case_law` 1,
`class_government_report_not_admitted_for_persuasive_case_law` 1.

## 2. The three cited sources

All three came from `origin: local_db` (local corpus vector/FTS), not from the topical web results.

| source | retrieval_query | assigned_role | topicality | claim_supported | actually supports? | CSM | alignment | why it survived |
|---|---|---|---|---|---|---|---|---|
| בג"ץ 474/21 (זכות ערר של מתלונן) — s4 | local_db leg of the generic query "בג"ץ ... ביקורת שיפוטית על החלטות בית הדין הרבני ..." | `binding_case_law`, `leading_candidate`, `official_primary` | no numeric topicality recorded; passed because `local_caselaw_content_verified` + `judgment_identity_confirmed_in_body` | block 0 — "בג"ץ may intervene when the tribunal acted שלא כדין" | **no** — it is about a complainant's right of appeal against closing a file | pass (`claim_id_match`, exact) | pass | admitted as a verified local judgment with a confirmed identity; nothing tested subject-matter fit (`topic_aware_alignment.judgment_fit` is **null** for this run) |
| דנ"פ 5387/20 רפי רותם — s3 | same generic local_db leg | `binding_case_law`, `leading_candidate` | none; `holding_text_present` | block 3 — remedies / judicial restraint | **no** — it is review of prosecution discretion, not rabbinical courts | pass, but only by `shared_meaningful_terms` score 7 on generic stems (`סמכ`, `ביקורת`, `שיפוטית`, `ריסונ`, `תערב`) | pass | CSM's topical rebinding accepted abstract administrative-law vocabulary as support |
| TAU article on חוות דעת / אחריות הורית — s2 | local_db scholarship leg | `scholarship` / `secondary_commentary` | body acquired, no doctrinal fit test | block 2 — evidence needed to prove an external consideration | **no** — family-law expert-opinion literature, unrelated to civil-law constraints on rabbinical courts | pass (`proposition_type_application`) | pass, `representative_selected: true` | it was the only scholarship in the pack, so the representative-source layer promoted it |

Funnel confirms: s2/s3/s4 `loss_stage: none`, `survived_csm: true`, `survived_alignment: true`.
s1 (`חוק בתי המשפט`) was dropped by CSM (`claim_source_match_removed_ref`).

## 3. Claim-level relevance

| claim | source attached | direct / adjacent / unrelated | supports in this context? | should have been omitted? |
|---|---|---|---|---|
| בג"ץ intervenes when the rabbinical court acts "שלא כדין" | s4 (בג"ץ 474/21) | unrelated | no | yes — this is exactly the בבלי/סימה אמיר holding and needed that authority |
| external / non-relevant consideration justifies intervention | none (block 1, `kept_refs: []`) | – | – | correctly left uncited, but the claim was still asserted |
| mistake of law / failure to weigh | folded into blocks 0–1 | unrelated / none | no | yes |
| evidence needed to prove an external consideration | s2 (TAU expert-opinion article) | unrelated | no | yes |
| remedies: annulment / remand / direction | s3 (דנ"פ 5387/20) | adjacent (general administrative remedies) at best | not for rabbinical-court review | yes |
| judicial restraint toward rabbinical courts | s3 | unrelated (restraint toward prosecution) | no | yes |

## 4. Facet / query audit

12 queries, all on C1–C4. Direct and on-point:
- `בג"ץ 1000/92 בבלי` (N2)
- `חוק שיפוט בתי דין רבניים (נישואין וגירושין) ... ביקורת שיפוטית בג"ץ ... חלוקת רכוש`
- `ביקורת שיפוטית על בתי דין רבניים חלוקת רכוש לאחר גירושין מאמר` (E1)
- `בג"ץ ... שיקול חיצוני / שיקול זר בית הדין הרבני חריגה מסמכות`
- facet F1 `התערבות בג"ץ בפסיקת בית הדין הרבני חריגה מסמכות` (area lock `public_law_hcj`)
- remedies query against rabbinical-court decisions

Generic administrative-law leakage:
- `בג"ץ 1715/97 לשכת מנהלי ההשקעות` (N1, "מבחני מידתיות וביקורת שיפוטית כללית")
- `חוק-יסוד: כבוד האדם וחירותו סעיף 8` (N4)

No prosecution-discretion query was ever generated — the רפי רותם contamination did **not** come from a query.
It came from the **local_db leg** of the on-topic Hebrew queries: local vector/FTS matched abstract
"ביקורת שיפוטית / שיקול דעת / סמכות" language and returned high-profile unrelated judgments,
which then bypassed the doctrine-fit check. Same for the TAU family-law article (matched "חלוקת" / "גירושין").

The facet lock `public_law_hcj` was applied to F1, but the cited judgments were not tested against it —
`topic_aware_alignment.judgment_fit` is null for this run, i.e. no doctrine lexicon match was produced
for the rabbinical-court / property-division doctrine, so the judgment legal-area filter never fired.

## 5. Root cause

**mixed_failure**, dominant cause: **relevant_authorities_found_but_lost** at web-source admission.

- Dominant: every on-point authority (בבלי ×3 URLs, בג"ץ 6641/11, 2598/02, 1908/21, 5387/13, IDI report, Rackman/CWJ volumes) was discovered and then killed by `class_unknown/class_academic_not_admitted_for_<role>` or left as `discovery_only`. The web legal-source classifier could not type `judgments.org.il`, `law-mate.com`, `cwj.org.il`, `idi.org.il`, so nothing on-topic reached the pack.
- Secondary, and the reason the answer looked authoritative anyway: the empty pack was backfilled from the local corpus, and the doctrine-fit guard produced no doctrines for this topic (`judgment_fit: null`), so CSM/alignment let generic-vocabulary judgments through (`shared_meaningful_terms` on stems like `ביקורת`, `סמכ`, `ריסונ`).

## 6. Product safety question

Yes. Citing בג"ץ 474/21 and דנ"פ 5387/20 for propositions about rabbinical-court review is worse than
silence: a reader who checks the citations finds nothing about rabbinical courts, and the boilerplate
"מגבלת ביסוס" note at the end does not warn that the *cited* sources are off-topic. Returning
"לא אותרו מקורות ישירים מספיק לביסוס התשובה" — or the same prose with zero footnotes — would have been
both safer and more useful here.

## 7. Recommended next implementation track

`web_judgment_source_classification_and_role_admission_v1`

Narrow scope: fix the classifier/admission path that emits
`class_unknown_not_admitted_for_binding_case_law` / `..._for_scholarship` for Israeli judgment and
legal-scholarship hosts (judgments.org.il, law-mate.com, daat.ac.il, cwj.org.il, rackmancenter.com,
idi.org.il), so a discovered docket-bearing page can be typed as a judgment and admitted for a
case-law role. This is the single stage where every on-point authority in this run died.
