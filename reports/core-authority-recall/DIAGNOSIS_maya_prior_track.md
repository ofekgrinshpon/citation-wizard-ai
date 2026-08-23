# core_authority_recall_for_legal_research_v1 — read-only diagnosis

Runs analysed (post class_unknown_primary_shape_rescue_v1):

| id | run_id | job |
|---|---|---|
| MAYA | 5177c067-9a93-41e1-b292-e08265b1127c | done |
| MAYA-BAVLI | cf3552f6-226d-4456-a66e-ae1d04ddd7be | done |
| MAYA-AMIR | 987ecea2-ba5b-48bd-b743-7596b8f0847e | done |

## 1. Planner / query generation

| signal | MAYA (15 q) | MAYA-BAVLI (16 q) | MAYA-AMIR (14 q) |
|---|---|---|---|
| "בבלי" | 0 | 7 | 0 |
| "סימה אמיר" | 0 | 0 | 1 |
| docket 1000/92 | 0 | 0 | 0 |
| docket 8638/03 | 0 | 0 | 0 |
| "חוק יחסי ממון" | 0 | 0 | 0 |
| "בית הדין הרבני" + "הדין האזרחי" | yes (C2 queries, paraphrased) | yes | yes |
| "חלוקת רכוש" + "בית הדין הרבני" | 1 | 1 | 2 |
| "שיתוף נכסים" | 0 | 0 | 0 |
| "חוק שיפוט בתי דין רבניים" (exact title) | 0 (only "חוק בתי הדין הרבניים") | 0 | 0 |

Planner behaviour: mode = doctrine_explanation, obligations = doctrinal_anchor + bounded_scholarship, both reported satisfied. Landmark authorities are never named unless the *user* names them; there is no doctrine→landmark-docket expansion, and no statute-name normalisation ("חוק בתי הדין הרבניים" is emitted instead of the real title "חוק שיפוט בתי דין רבניים (נישואין וגירושין), תשי"ג-1953"). "חוק יחסי ממון" is never searched in any of the three runs — it appears in MAYA-BAVLI's used sources only as a by-catch of a generic statute query.

## 2. Retrieval coverage

### בג"ץ 8638/03 סימה אמיר
- In local corpus: **yes** — `legal_documents.cd9c5775…`, title `בג"ץ 8638-03 - סימה אמיר נ. בית הדין הרבני הגדול בירושלים`, source_type `supreme_court_il`, 65 chunks, all embedded.
- MAYA: searched yes (vector) → **found yes** (top_vector_titles, claims C2 and C5) → **admitted NO**. Pool drop rows: `drop_reason: dup_url`, `drop_key: url:supremedecisions.court.gov.il/home/download`, rank_before_drop 48 and 57. Body not acquired, not used.
- MAYA-BAVLI: found twice — (a) web PDF `rotenberglaw.co.il/.../SA1_6_8638-03.pdf` dropped at perplexity admission with `drop_reason: discovery_only` (domain regex `/law|mishpat|din|advocate|lawyer/`), (b) `gov.il/.../SimaAmirHighCourt.docx` admitted but under role `primary_statute`, classified `government_report`, `text_usability: metadata_only`, `is_judgment_document: false` → excluded from judgment acquisition ranking and blocked from carrying holdings by the metadata-only gate. Not used.
- MAYA-AMIR: named in the planner query, but not surfaced in the pool; no drop row. Not used.

### בג"ץ 1000/92 בבלי
- In local corpus: **no** (the only "בבלי" document is רע"א 7357/22, an unrelated party name).
- Searched: only in MAYA-BAVLI (7 queries mention "בבלי", never with the docket). Found: only the Wikipedia entry → dropped `bad_source`, plus commentary (dropped `class_academic_not_admitted_for_binding_case_law`). Never admitted, never acquired, never used. The BAVLI answer attributes the Bavli doctrine to בג"ץ 4796/20 — a rescued substitute.

### בג"ץ 5416/09 פלוני
- Not searched, not found, not admitted, not used in any run. No planner query touches it.

### חוק יחסי ממון בין בני זוג
- Not searched. Found incidentally in MAYA-BAVLI (nevo law01/500_045) and used — but `metadata_only`, so it carries no operative text.

### חוק שיפוט בתי דין רבניים (נישואין וגירושין)
- Not searched by exact title; found and used in all three runs (nevo 73178), always `metadata_only` — cited, never quoted.

### Collateral finding (magnitude)
`normUrl()` in `candidatePool.ts` keeps only `hostname + pathname`, so **every** Supreme Court PDF shares the key `supremedecisions.court.gov.il/home/download` (the docket lives in the query string). Distinct judgments dropped as `dup_url` under that single key: MAYA 3, MAYA-BAVLI 14, MAYA-AMIR 2. The same collapse hits `gov.il/he/departments/dynamiccollectors/spokmanship_court` (47/57/42 drops per run).

## 3. Query gap classification

| authority | classification |
|---|---|
| בג"ץ 8638/03 סימה אמיר | **retrieved but pool-dedup dropped** (`dup_url` on a query-string-bearing URL); secondarily source-integrity mistyping of the gov.il .docx copy and `discovery_only` over-drop of the law-firm-hosted official PDF |
| בג"ץ 1000/92 בבלי | **local corpus missing** + **planner did not generate a landmark/doctrine query** (no docket, no "בבלי" at all unless the user says it) |
| בג"ץ 5416/09 פלוני | planner did not generate landmark/doctrine query |
| חוק יחסי ממון | planner did not generate the statute query (statute-name normalisation gap) |
| חוק שיפוט בתי דין רבניים | retrieved, but metadata-only — no text acquisition |

Not implicated: verifier (no rejections), sufficiency (no refusal fired), drafter (cited what it had), CPU budget (no kills).

## 4. Minimal future fix (recommended, not implemented)

**`docket_aware_url_dedup_v1`** — make the candidate-pool dedupe key docket-aware instead of path-only:

- In `normUrl()`, retain identity-bearing query parameters (`fileName`, `path`, `id`, `docId`, `caseId`) when the host is a known court/gov document endpoint, or fall back to `hostname + pathname + docket-from-title` when a docket is present.
- Scope: `stages/candidatePool.ts` only. No change to classification, verifier, sufficiency or the drafter.
- Expected effect: Sima Amir (and 14 other Supreme Court PDFs in the BAVLI run) stop collapsing into one candidate; recall of official-primary judgments rises without loosening any quality gate.
- Validation: MAYA / MAYA-BAVLI / MAYA-AMIR + P02, R02, B8; assert `amir_8638_03_in_pool = true` for MAYA and no growth in `used_sources_count` beyond +1..2.

Deferred (do not bundle): landmark-docket planner expansion, statute-title normalisation, `discovery_only` primary-shape rescue for law-firm-hosted official judgment PDFs.
