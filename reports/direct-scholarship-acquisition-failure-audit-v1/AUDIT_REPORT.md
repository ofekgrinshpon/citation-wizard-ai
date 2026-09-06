# direct_scholarship_acquisition_failure_audit_v1 — read-only diagnostic audit

Scope: read-only. No code changed, nothing deployed, no prompt/retrieval/admission/
acquisition/CSM/alignment/drafter/pack changes. All evidence comes from the five stored
production traces of `natural_literature_mode_and_topic_guard_v1` plus read-only queries
against `legal_documents`.

Runs audited:

| id | prompt | run_id |
|---|---|---|
| P1 | תעשה לי סקירת ספרות על עילת הסבירות | `18db2b38-20b2-4d9c-adc6-ec270132c58e` |
| P2 | סקירת ספרות לסמינריון — הבטחה מנהלית וציפייה לגיטימית | `d91dd8bc-e59a-4697-bb83-b9ae3b936852` |
| P3 | היחס בין מידתיות לסבירות | `9f84535a-8c89-44ea-871a-2413b79793d5` |
| P4 | רקע תיאורטי לסמינריון — עילת הסבירות והביקורת עליה | `e24c9c15-d7af-438b-b3a3-2ae4cdf0f219` |
| P5 | פרק סקירת ספרות — הסתמכות מול רשות מנהלית | `0d1e48ed-a983-498d-8cf6-2ac25331f970` |

---

## 0. Answer in one paragraph

Direct Israeli scholarship **is discovered, is admitted, and its full body is even
acquired** — and is then destroyed in two deterministic in-process steps that never
touch the network:

1. **Hebrew subject-stem matching is broken by over-eager prefix stripping.** The stemmer
   strips a leading `מ` as a prefix, so the question word `מנהלית` becomes `נהלי` while
   the source word `המנהלי` becomes `מנהלי` — the same concept yields two non-matching
   stems. Same for `הסתמכות` (`סתמכו`) vs `ההסתמכות` (`הסתמכ`), and `מידתיות` (`ידתיו`)
   vs `המידתיות` (`מידתי`). Result: the most on-point article in the corpus is labelled
   `off_topic_no_shared_subject_vocabulary`.
2. **Source role is inherited from the retrieval query slot, not from the document.**
   In P3 the Dagan article carries `role: primary_statute` with `citable_as: scholarship`;
   because `can_satisfy_role: false` it is never verifier-usable, so it cannot enter the
   pack despite `body_acquired: true`, `extracted_chars: 16000`,
   `post_body_topicality: 0.67`, `role_after_body: direct`, `eligible_for_pack: true`.
   In P5 twenty-plus journal articles are labelled `binding_case_law` and several actual
   judgments are labelled `scholarship`.

Against the ten hypotheses: **(6) post-body topicality mislabelling and (7)/(8) role and
verifier-usability mislabelling are the causes.** (1)–(5) are *not* the bottleneck:
discovery, admission and body acquisition all succeed. (9) crowding is a downstream
symptom, (10) telemetry is honest.

---

## 1. Candidate-level audit

Only scholarship-relevant candidates are listed; dead candidates included deliberately.

### P1 — עילת הסבירות

| rank | source | author | host | discovered | class | admitted | body_att | body_acq | chars | post_body | verifier | in_pack | final_loss_stage | final_loss_reason |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | מידתיות חוקתית, סבירות מנהלית | נדב דגן | law.haifa.ac.il | yes | journal_article | yes (`scholarship`) | yes | **yes** | 16,000 | pre 0.17 → post 0.33 → **adjacent** | usable | yes (as adjacent) | topicality_downgrade | `direct` unreachable: question yields only 3 subject stems, body-direct needs ≥4 matches |
| 2 | היסוד החוקתי של עילות הביקורת השיפוטית המינהליות | — | local_db | yes | journal_article | yes but role `primary_statute` | yes | yes | — | adjacent | role mismatch | no | role_slotting | scholarship carried in a statute slot |
| 3 | גלגולי מושג "שלטון החוק" בישראל | — | local_db | yes | journal_article | yes, role `primary_statute` | yes | yes | — | adjacent | — | yes (adjacent) | topicality_downgrade | stem overlap only on `סבירו` |
| 4 | מי קובע את עקרונות היסוד של השיטה המשפטית? | — | local_db | yes | journal_article | role `primary_statute` | no | no | — | — | — | no | role_slotting | — |
| 5 | בכמה קולות מדברת המדינה? | — | local_db | yes | scholarship | yes | yes | yes | — | adjacent | usable | yes | topicality_downgrade | — |
| 6–20 | 73 further candidates | — | mixed | yes | mixed | — | no | no | — | — | — | no | **pool cap** | `backfill_origin_diversity_cap` (73 drops), `dup_document_id` (30), `discovery_listing_suppressed` (3): 114 discovery candidates → 8 pool entries |

`direct_scholarship_sources_in_pack = 0`, 4 footnotes.

### P2 — הבטחה מנהלית וציפייה לגיטימית

| rank | source | author | host | discovered | class | admitted | body_att | body_acq | chars | post_body | verifier | in_pack | final_loss_stage | final_loss_reason |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **הגנת ההסתמכות במשפט המנהלי** | — | local_db (`journal_article`, score 0.468, text lane) | **yes** | scholarship | **yes** (`source_integrity/admitted[10]`) | **rejected** | no | 0 | n/a | n/a | **no** | **body_budget + literature_pack_selection** | `off_topic_no_shared_subject_vocabulary` — stem bug (`נהלי` vs `מנהלי`, `סתמכו` vs `הסתמכ`) |
| 2 | הזוג המוזר: הבטחה מנהלית וחוזה רגולטורי | שרון ידין | web | yes | `class_unknown` | **no** | no | no | — | — | — | no | admission | `class_unknown_not_admitted_for_scholarship` |
| 3 | "כגודל הציפייה" | יונתן ברוורמן | local_db | yes | journal_article | yes | yes | yes | — | adjacent | usable | yes | topicality_downgrade | cited, but counted adjacent |
| 4 | הבטחה מינהלית (כתב עת, האוניברסיטה העברית) | — | perplexity result | yes (result row only) | — | no | no | no | — | — | — | no | discovery_only | never promoted to candidate |
| 5–20 | administrative-promise web pages, IDI items | — | mixed | yes | `class_unknown` | no | no | no | — | — | — | no | admission | `class_unknown_not_admitted_for_scholarship` |

`direct_scholarship_sources_in_pack = 0`, 2 footnotes.

### P3 — מידתיות מול סבירות

| rank | source | author | host | discovered | class | admitted | body_att | body_acq | chars | post_body | verifier | in_pack | final_loss_stage | final_loss_reason |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **מידתיות חוקתית, סבירות מנהלית** | נדב דגן | law.haifa.ac.il | yes | `journal_article`, flagged `strong_direct` (1 of 11) | yes, `citable_as: scholarship`, **`role: primary_statute`**, `can_satisfy_role: false` | yes (`direct_topical_scholarship`, priority 110) | **yes** | **16,000** | **0.67, `direct`, `eligible_for_pack: true`** | **`verifier_usable: false`** | **no** | **verifier_usability** | `body_acquired_but_not_verifier_usable` — role slot, not substance |
| 2 | על חוקתיות ועל סבירות (בקמן) | — | local_db | yes | journal_article | role `primary_statute` | no | no | — | — | — | no | role_slotting | — |
| 3 | ארבעה מיתוסים ביחס לביקורת שיפוטית | — | local_db | yes | journal_article | role `primary_statute` | no | no | — | — | — | no | role_slotting | — |
| 4 | בכמה קולות מדברת המדינה? | — | local_db | yes | journal_article | role `primary_statute` | no | no | — | — | — | no | role_slotting | — |
| 5+ | IDI / Haifa / academic web items | — | web | yes | academic | no | no | no | — | — | — | no | admission | `class_academic_not_admitted_for_persuasive_case_law` |

Final pack: 3 case-law sources, **zero scholarship**. 2 footnotes.

### P4 — רקע תיאורטי, עילת הסבירות

| rank | source | host | class | role assigned | in_pack | final_loss_stage | reason |
|---|---|---|---|---|---|---|---|
| 1 | מידתיות חוקתית, סבירות מנהלית (דגן) | local_db | journal_article | `scholarship` | no | topicality/pack | not selected; adjacent |
| 2 | גלגולי מושג "שלטון החוק" | local_db | journal_article | `scholarship` | **yes** | — | `topical_source_kept`, topicality 0.33 (adjacent) |
| 3 | היסוד החוקתי של עילות הביקורת השיפוטית המינהליות | local_db | journal_article | `scholarship` | no | topicality | below adjacent threshold |
| 4 | דו"ח שנתי 2021 הנהלת בתי המשפט | web | report | `primary_statute` | no | pack | `off_topic_no_shared_subject_vocabulary` (correct rejection) |
| 5 | החלופות להפיכת חברה ציבורית לפרטית | local_db | journal_article | **`binding_case_law`** | no | role_slotting | corporate-law article in a case-law slot |

`direct_scholarship_sources_in_pack = 0`, 2 footnotes.

### P5 — הסתמכות מול רשות מנהלית

31 pool candidates. Role labels are visibly scrambled: 15 journal articles carry
`binding_case_law` or `primary_statute`, while four actual judgments
(`בג"ץ 8948/22`, `רע"א 2237/06`, …) carry `scholarship`.

| rank | source | host | class | role | in_pack | final_loss_stage | reason |
|---|---|---|---|---|---|---|---|
| 1 | הגנת ההסתמכות במשפט המנהלי | perplexity result row (twice) | — | — | no | discovery_only | never promoted to candidate although the same document exists in `legal_documents` |
| 2 | אינטרס ההסתמכות של מתיישבים ישראלים בשטחים | local_db vector hit | journal_article | — | no | pool | not promoted |
| 3 | היסוד החוקתי של עילות הביקורת השיפוטית המינהליות | local_db vector hit | journal_article | — | no | pool | not promoted |
| 4 | The Primacy of Expectancy in Estoppel Remedies | web | foreign scholarship | `persuasive_case_law` | no | pack | `off_topic_no_shared_subject_vocabulary` (correct) |
| 5 | AIAL Forum No. 81 | web | foreign scholarship | `persuasive_case_law` | no | pack | off-topic (correct) |
| 6 | ייחוד עילה בדיני הפגמים בכריתה | local_db | journal_article | `binding_case_law` | **yes** | — | kept as adjacent (0.17) — contract-law filler |
| 7 | תקנת השוק במכר על ידי רשות שנפל בהליכיו פגם | local_db | journal_article | `binding_case_law` | **yes** | — | kept as adjacent (0.17) |
| 8–20 | tax, family, labour, corporate articles and judgments | local_db | mixed | mostly `binding_case_law` | 5 primary in pack | — | primary crowding |

`direct_scholarship_sources_in_pack = 0`, 2 footnotes; 5 case law in pack.

---

## 2. Known-source diagnostic probes

Read-only checks against the corpus and against the stored traces only. **No new
production searches were issued, nothing was injected into any answer.**

| probe | exists in `legal_documents` | found by production query | body obtainable | where it fails |
|---|---|---|---|---|
| נדב דגן — מידתיות חוקתית, סבירות מנהלית | yes (`journal_article`, Haifa PDF) | **yes** (P1, P3, P4) | **yes, 16,000 chars** | P3: role slot `primary_statute` → `verifier_usable:false`. P1: post-body topicality → adjacent |
| הגנת ההסתמכות במשפט המנהלי | yes (`journal_article`, HUJI) | **yes** (P2 local text lane, P5 web) | not attempted | P2: body budget + pack, `off_topic_no_shared_subject_vocabulary` (stem bug). P5: discovery-only |
| הבטחה מינהלית (HUJI journal) | yes | yes (P2 perplexity result row) | not attempted | never promoted from result row to candidate |
| "כגודל הציפייה" (ברוורמן) | yes | yes (P2) | yes | reaches pack but scored adjacent |
| שרון ידין — הזוג המוזר | web only | **yes** (P2) | not attempted | admission: `class_unknown_not_admitted_for_scholarship` |
| היסוד החוקתי של עילות הביקורת השיפוטית המינהליות | yes | yes (P1, P4, P5 vector) | partially | role slotting / not promoted |
| מי קובע את עקרונות היסוד (ביטול עילת הסבירות) | yes | yes (P1) | no | role slotting |
| דותן / ברק-ארז / זמיר on סבירות, הבטחה מנהלית | partially in corpus | some hits, mostly via web `class_unknown` | not attempted | admission classification |

Conclusion of the probe section: **the retrieval layer can already find the right
literature.** For every named probe except the pure-web ones, the source was discovered
by the production run itself. The problem is not query expansion.

---

## 3. Discovery-query audit

- Queries are generated per **role slot**, and the resulting documents inherit that slot's
  role. P5's scholarship slot issued an unfocused query whose top text hits were
  `פרטי מסמך` / `סקירה משפטית משווה` placeholders, while its `binding_case_law` slot
  returned constitutional-scholarship articles. The slot/result mismatch is systemic.
- P2's scholarship slot **did** return the right corpus (`כגודל הציפייה`,
  `הגנת ההסתמכות במשפט המנהלי`) — retrieval quality there was good.
- Hebrew FTS prefix-variant expansion works on the query side (`tsq_primary` shows the
  full variant fan-out); the mismatch appears only in the **in-process topicality
  stemmer**, which is a different, much cruder implementation.
- Every run hit some Perplexity 429s, but no run failed for lack of web results.

---

## 4. Verdict on the ten hypotheses

| # | hypothesis | verdict |
|---|---|---|
| 1 | not discovered | **no** — discovered in every run |
| 2 | not classified as scholarship | partly — web items land as `class_unknown` (P2 ידין, P5 items) |
| 3 | classified adjacent instead of direct | **yes, primary** — stem bug |
| 4 | admitted but no body attempted | **yes** — P2 top source rejected pre-budget by the same stem bug |
| 5 | body acquisition fails | **no** — succeeds (16,000 chars) whenever attempted |
| 6 | post-body topicality downgrades incorrectly | **yes, primary** — P1 0.33 adjacent for the on-point article |
| 7 | verifier-usable but pack excludes | — pack exclusion happens *before* that |
| 8 | in pack but counted adjacent / role mislabelled | **yes, primary** — P3 `primary_statute` role → `can_satisfy_role:false`; P5 role scramble |
| 9 | primary law crowds it out | secondary symptom (P5) |
| 10 | telemetry wrong | **no** — telemetry is accurate and was what exposed all of this |

Ranked root causes:

1. **Hebrew subject-stem prefix over-stripping** in `stages/academicLiteratureRichness.ts`
   (`subjectStems`, 5-char truncation, `מ`/double-`ה` handling) and the absolute
   `matched.length >= 4` direct threshold in `stages/academicLiteratureGateRepair.ts`,
   which is unreachable for short prompts (P1 has 3 subject stems in total).
2. **Role inherited from query slot rather than from the document**, producing
   `can_satisfy_role: false` and `verifier_usable: false` for full-text scholarship.
3. `class_unknown` web scholarship still not admitted (residual from the earlier gate
   repair — it only covers part of the space).
4. Pool caps (`backfill_origin_diversity_cap`: 73 of 114 in P1) applied before topical
   scoring, so the cap cannot prefer on-topic scholarship.

---

## 5. Recommendation — exactly one next step

`fix_topicality_and_role_labelling_v1`: repair the Hebrew subject-stem matcher
(morphology-aware prefix handling, relative rather than absolute direct threshold) and
derive source role from the document itself (`citable_as` / `source_type`) instead of the
retrieval query slot. No new retrieval, no new model call, no source-count change — this
is expected to convert already-acquired bodies into direct pack sources.
