# nomination_identifier_bearing_rate_v1 — read-only diagnosis

No code changed. Evidence: the 7 accepted runs in `reports/nomination-toolcall-reliability/*.json` plus the actual nomination-produced queries recovered from `qa_logs.metadata->'queries'` (reason `source_nomination_v1:N#`), read against `stages/sourceNomination.ts`, `stages/officialSourceDiscovery.ts` and `stages/queryMergeAndBudget.ts`.

## 1. Per-run picture

| Run | Cand. | Category mix | Ident-bearing | Nomination queries reaching merge | Discovery |
|---|---|---|---|---|---|
| D1 מידתיות | 5 | statute 1, judgment 2, scholarship 1, knesset 1 | 0 | 4/4 | skipped — no_identifier_bearing |
| D3 רבני/רכוש | 5 | statute 2, judgment 1, knesset 1, gov 1 | 0 | 4/4 | skipped |
| R02 מזרחי | 5 | statute 2, judgment 1, knesset 1, regulator 1 | 1 | 4/4 | **ran** → body acquired, injected, 1 footnote |
| P02 fake docket | 4 | other 2, statute 1, judgment 1 | 0 | 4/4 | skipped (correct) |
| B8 canonical quote | 0 | — | 0 | 0 | skipped (`router_or_mode_skip`, correct) |
| MAYA | 5 | statute 2, judgment 1, scholarship 1, knesset 1 | 0 | 4/4 | skipped |
| MAYA-AMIR | 5 | statute 2, judgment 2, knesset 1 | 0 | 4/4 | skipped |

What the nominations actually were (verbatim highlights):

- D1: N1 `חוק יסוד: כבוד האדם וחירותו` conf 0.95 — **no section 8**; N2 "פסקי-דין מנחים של הנשיא אהרן ברק על מבחן המידתיות" conf 0.8 — a description, no case; N3 "בג״ץ בדבר פסקת ההגבלה" conf 0.6 — a description; N5 scholarship "אהרן ברק ... מאמר" conf 0.7 — authors/year stripped. **בנק המזרחי and לשכת מנהלי ההשקעות were never nominated.**
- D3: N1 `חוק בתי דין רבניים (נישואין וגירושין), תשי״ג-1953` conf 0.98; N2 חוק-יסוד כבוד האדם; N5 ממ״מ report (institution present, **year null**); N4 "פסקי דין ... על ביקורת שיפוטית של החלטות בתי דין רבניים" conf 0.6. **בבלי and סימה אמיר absent; חוק יחסי ממון absent.**
- MAYA: N1 is a hallucinated-adjacent title `חוק בתי הדין הרבניים (מסירת פסקי דין), התש״ח-1948` conf 0.7; scholarship N8 is a vague author bundle conf 0.6. No בבלי, no אמיר, no יחסי ממון.
- MAYA-AMIR: N4 **`סימה אמיר` named correctly, conf 0.6, docket null**; N5 a generic "שיקול זר" description conf 0.6.
- R02: the only run where the user's own question carried the docket, so the nomination inherited it.

## 2. Root causes (ranked)

1. **`isIdentifierBearing()` is too narrow.** It requires a docket for judgments, `statute_title` **and** `statute_section` for statutes, `institution` **and** `year` for reports, `authors` **and** `year` for scholarship. A canonically named case (`סימה אמיר`) and a canonically named statute (`חוק בתי דין רבניים`, conf 0.98) both score 0. This alone explains most of the 6/7 skips.
2. **One `confidence` field is doing two jobs.** `harden()` strips the docket whenever `confidence < 0.8`, and models rate judgments 0.6 precisely because they are unsure of the *number*, not of the *case*. Relevance confidence and identifier confidence are conflated, so identifiers are destroyed before hardening even looks at them.
3. **The prompt is over-cautious in one direction only.** It says "if unsure of the docket — leave null and put the party names in `label_he`", with no counter-instruction to *always* name the canonical authorities a competent researcher would reach for. The result is descriptive placeholders ("פסקי דין מנחים של הנשיא ברק") instead of named cases.
4. **Sorting + caps punish named judgments.** `applyCategoryCaps` sorts by confidence and caps total at 5, statutes at 2, judgments at 2; low-confidence judgments therefore lose to high-confidence generic statutes (MAYA-AMIR dropped 3 by `total_cap`). `MAX_QUERIES: 4` then drops the 5th candidate entirely.
5. **Query text quality.** `buildQueries` concatenates `label_he + docket + statute + institution + topic_query` into one 220-char string, producing noisy hybrid queries that are neither a clean identifier lookup nor a clean topic search.
6. **Not a cause: `query_merge`.** All 4 nomination queries survived merge in all 6 eligible runs (priority 1). What merge *does* drop at `total_cap` is exploratory material — facets and judgment_discovery lanes (5–10 dropped per run). There is no balance rule by question type today.

Identifier-bearing rate today: **1/29 candidates (3%)**, 1/6 eligible runs.

## 3. Recommendation — split the output into two buckets

Target shape for `source_nomination_v2` (still one tool call, still one mini model call):

- **`actionable_sources`** — pursued by discovery/cache. Judgment with docket **or** a strong party/case name; statute with an official/normalizable title (section optional); named report with institution + title (year optional); article/book only when title+author+year are high confidence.
- **`exploratory_topic_searches`** — never sent to discovery, always sent to normal local/perplexity retrieval. Scholarship, books, chapters, ממ״מ/institutional and comparative literature. These are a first-class research product, not a failure signal.

Field changes:
- Replace one `confidence` with `relevance_confidence` + `identifier_confidence`.
- Add `actionability`: `known_identifier` | `known_name_no_docket` | `topic_only`.
- Keep all anti-hallucination rules: an invented docket is still stripped when `identifier_confidence < 0.8`; stripping demotes to `known_name_no_docket`, it does not delete the nomination.
- Prompt: for legal-rule/doctrinal questions, ask for 1–2 named primary-law authorities when they are genuinely well known, *and* 1–2 exploratory searches; state explicitly that a topic-only nomination is a legitimate answer for scholarship/reports.

Widen `isIdentifierBearing` to accept `known_identifier` **and** `known_name_no_docket` (name-based targets go to search-first discovery, never to deterministic docket derivation).

Budget / merge changes (minimal):
- Nomination lanes: reserve up to 2 for actionable, up to 2 for exploratory; raise `MAX_QUERIES` to 5 so a 5th kept candidate is not silently query-less.
- Sort actionable primary law ahead of secondary within the cap instead of sorting purely by confidence.
- `queryMergeAndBudget`: add a soft mix floor — for doctrinal/legal-rule questions keep at least one exploratory scholarship/institutional query before `total_cap` bites; for academic/policy questions keep at least two.
- `buildQueries`: emit a clean identifier query for actionable items and a clean topic query for exploratory ones, no concatenation.

Nothing here changes citation rules. A nomination is still only a search candidate; verifier, source-integrity, claim-source-match, sufficiency and footnote gates are untouched.

## 4. Minimal implementation plan (when approved)

1. `stages/sourceNomination.ts` — two-bucket tool schema, dual confidence, `actionability`, revised system prompt, hardening that demotes rather than deletes, actionable-first cap ordering, `MAX_QUERIES` 5, split query builder.
2. `stages/officialSourceDiscovery.ts` — accept name-based actionable targets (search-first path only), keep `MAX_TARGETS: 2` and all existing safeguards.
3. `stages/queryMergeAndBudget.ts` — mix floor by question type; report `actionable_queries` / `exploratory_queries` counts.
4. `index.ts` — telemetry: `actionable_count`, `exploratory_count`, `actionability_mix`, `identifier_confidence` histogram, `stripped_identifiers`, merge mix counts.

No changes to drafter, verifier, claim-source-match, source-integrity, footnotes, PDF preemption or the router.

## 5. Validation plan

Sequential: D1, D3, R02, P02, B8, MAYA, MAYA-AMIR, plus an identity/nation-state question (חוק-יסוד הלאום / בג״ץ 5555/18) as an 8th.

Acceptance:
- nomination stays reliable — 0 parse errors, 0 truncated tool calls, no unnecessary gpt-5 escalation;
- P02 stays `docket_limitation`, B8 stays `canonical_quote_registry` and nomination-skipped;
- more actionable primary-law nominations where expected (D1: פסקה 8 / מזרחי / לשכת מנהלי ההשקעות; D3+MAYA: בבלי / סימה אמיר / יחסי ממון);
- official discovery or cache runs in **at least 3** runs, not only R02;
- exploratory scholarship/institutional queries still present in every doctrinal run — a run with zero exploratory queries fails acceptance;
- no invented docket or invented bibliographic detail anywhere in the final answers;
- no nominated source cited unless retrieved, acquired and validated;
- no CPU kills, stale jobs, stubs, dangling markers or orphan rows.
