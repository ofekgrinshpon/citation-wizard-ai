# C2 case-law synthesis diagnostic — read-only

Query: **"מה הפסיקה אומרת על הלכת השיתוף?"**
Run: `e66c52c5-9313-4b38-a700-d8d5a3b2080a` · raw dump: `reports/c2-synthesis-diagnostic/C2-raw.json`
research_mode = `case_law_synthesis` · output_shape = `analysis` · lead_ref = none (`shape_not_eligible`) · deterministic_branch = none
Planner obligations: **6/6 satisfied**, `unsatisfied: []`, caselaw dual-targeted (7 local + 7 perplexity).
Sufficiency: `sufficient: true`, `case_law_synthesis_supported`, `thin_source: false`, topic_phrases `["הלכת השיתוף"]`, topical_refs `s9, s13`, topical_authority_refs `s9, s13`.

## 1–2. used_sources with integrity + role

| # | source | type | tier | citable_as | text_usability | support | planner role | true synthesis role |
|---|---|---|---|---|---|---|---|---|
| 1 | ע"א 52/80 שחר נ' פרידמן (gov.il `sf-21.pdf`) | caselaw | secondary_commentary | commentary | substantive_excerpt | **direct** | binding_case_law | leading-ish (pre-1974 הסכם מכללא) |
| 2 | מינץ, השותפות הנישואית (haifa) | journal_article | secondary_commentary | scholarship | full_text | partial | binding_case_law (mislabeled) | commentary |
| 3 | חזקת השיתוף — נכסי עבר/עתיד (huji) | academic | secondary_commentary | **unknown** | **metadata_only** | partial | scholarship | commentary |
| 4 | psakdin — סתירת חזקת השיתוף | caselaw | secondary_commentary | commentary | **metadata_only** | partial | persuasive_case_law | limiting (rebuttable) |
| 5 | בע"מ 1398/11 פלונית נ' פלוני (gov.il .docx) | caselaw | secondary_commentary | commentary | **metadata_only** | partial | binding_case_law | limiting/applying (שיתוף ספציפי) |
| 6 | חוק יחסי ממון תשל"ג-1973 (nevo) | legislation | official_primary | statute | **metadata_only** | partial | primary_statute | statutory |
| 7 | כהן, הקדמת מועד איזון המשאבים (runi) | journal_article | secondary_commentary | scholarship | substantive_excerpt | partial | primary_statute (mislabeled) | commentary |
| 8 | נייר עמדה — בתי דין דתיים (knesset) | legislation | official_primary | statute | substantive_excerpt | partial | primary_statute | **off-topic** (position paper, not statute) |
| 9 | שלושה צמתים… בתי דין רבניים (huji) | journal_article | secondary_commentary | scholarship | substantive_excerpt | partial | primary_statute (mislabeled) | commentary, off-axis |
| 10 | "ואף-על-פי-כן — שיתוף נכסים" (huji) | journal_article | secondary_commentary | scholarship | substantive_excerpt | partial | binding_case_law (mislabeled) | commentary |

**Zero sources are `citable_as: judgment`.** Both real judgments (ע"א 52/80, בע"מ 1398/11) are typed `secondary_commentary / commentary` because they arrive as gov.il blob PDFs/.docx, not court-domain judgment pages. Compared with the previous audit, דנג"ץ 8537/18 (the one real `supremedecisions.court.gov.il` file) **did not survive this run at all** — recall is unstable between runs.

## 3. Do snippets contain holding language?
Partly, and only for one source. Only #1 carries actual ratio text ("הלכת ה'הסכם מכללא'… חלה גם על רכושם הנפרד…") — 220 chars. #5 has a one-sentence paraphrase of the holding (175 chars). Everything else is either a scholarly paragraph (400-char hard cut, mid-sentence, OCR-mangled Hebrew in #9) or a Perplexity **abstract about** the source (#3, #4, #6 are `metadata_only`, 102–144 chars). The 1200-char snippet raise applies only to anchor/lead candidates; synthesis mode has no anchors and no lead, so every source in the pack was cut at 400.

Net: the drafter received roughly **one** sentence of real judicial holding language for the entire doctrine.

## 4. Does the drafter get metadata to organize by authority role?
No. `buildUserMessage` renders per source: `source_type | role | best_support`, supported_points, snippet. It does **not** render `authority_tier`, `citable_as`, or `text_usability` (those exist on the object and are used only inside `selectLeadRef`). The `role` it does render is the **planner's retrieval role** (`binding_case_law`, `primary_statute`, `scholarship`) and it is demonstrably wrong for 4 of 10 sources — three journal articles are labeled `primary_statute`/`binding_case_law`. There is no leading / applying / limiting label anywhere in the pipeline; those exist only as *planner query obligations*, and the obligation label is never attached to the retrieved candidate.

## 5. Is there enough material for synthesis?
No. Skeleton coverage: statutory anchor present but `metadata_only`; **leading case: none** (no בבלי, no יעקובי/קנוביץ, no ע"א 4623/04 line); applying: one paraphrase; limiting: one metadata-only psakdin page; commentary: over-represented (6 of 10). A genuine line of authority cannot be written from this pack — the drafter did the best available thing and wrote a doctrinal essay.

## Special question — does the drafter know it is in synthesis mode?
**No.** `research_mode` is computed in `researchMode.ts`, consumed by `queryPlanner.ts`, logged at `index.ts:453` — and never passed to `runDrafterV2` (see the call at `index.ts:764`; options are userDocs, useAsSource, missingRequiredAnchors, answerIntent, requiredAnchorCandidateIds, satisfiedStatuteSectionAnchors). The only structural hint the drafter receives is `מבנה מבוקש (רמז פורמט): analysis`, whose system-prompt rule is literally *"analysis / comparison — התנהג כרגיל"*. There is no leading-rule → leading-cases → applications → limits → current-test skeleton anywhere in the drafter prompt. Also, `lead_ref` is disabled for `analysis`, so synthesis answers have no authority centering at all.

## 6. Failure classification

| rank | cause | verdict |
|---|---|---|
| 1 | **retrieval coverage** — no leading case reached the pack; recall unstable across runs | primary |
| 2 | **missing source roles** — no leading/applying/limiting labels; planner `role` is wrong on 40% of the pack; tier/citable/usability never shown to the drafter | primary |
| 3 | **snippet thinness** — 400-char cap for all non-anchor sources; 4 of 10 are `metadata_only` abstracts | strong contributor |
| 4 | **drafter structure** — no mode signal, no synthesis skeleton, lead_ref off for `analysis` | contributor, but not the top blocker |
| 5 | **sufficiency too loose** — 2 topical "authorities", both `secondary_commentary`, zero judgments ⇒ `sufficient: true`, `thin_source: false` | contributor |

**Not** a "good pack written as essay" case. The pack genuinely lacks the authority line; the drafter also lacks the mode signal and the labels it would need even if the pack were good. Ordered fix leverage: authority-role labeling + judgment typing for gov.il-hosted judgments (2) → snippet budget for synthesis packs (3) → mode-aware drafter skeleton (4) → tighten synthesis sufficiency to require ≥1 `citable_as: judgment` (5); pure retrieval coverage (1) is largely downstream of correct judgment typing.
