# real_prompt_literature_review_baseline_v1 — Validation Report (read-only)

No code, prompt, deployment or pipeline change was made. Only a validation runner
(`scripts/real-prompt-literature-review-baseline-v1.ts`) and this report directory were created.
The three prompts were sent verbatim to the deployed `legal-research-v1`.

| | P1 | P2 | P3 |
|---|---|---|---|
| prompt | תעשה לי סקירת ספרות על עילת הסבירות | תכתוב לי סקירת ספרות לסמינריון על הבטחה מנהלית וציפייה לגיטימית | תעשה לי סקירת ספרות על היחס בין מידתיות לסבירות במשפט הישראלי |
| run_id | c179b0bd-78da-411d-852c-58456ca6a42b | 6dca00b1-ef20-463c-9b12-b17a31b999c2 | 52218d8d-40fb-4cda-ab8b-bdbe128a7f87 |
| latency | 187,334 ms | 202,252 ms | 166,877 ms |
| answer length | 2,161 chars | 3,267 chars | 2,835 chars |
| footnotes | 3 | 1 | 2 |

## 2. Intent detection

| | P1 | P2 | P3 |
|---|---|---|---|
| user_task_intent | `literature_map` | `academic_writing` (`generic_academic`) | `literature_map` |
| answer_strategy | `map_literature` | `draft_academic_text` | `map_literature` |
| classified academic | yes | yes | yes |
| classified literature review | yes (as a *map*) | as generic academic writing, not a literature review genre | yes (as a *map*) |
| **literature mode activated** | **NO** — `academic_literature_mode: false`, recovery `trigger_reason: not_a_literature_review_request` | **YES** | **NO** — same reason |
| case law / statutes | allowed and required (`source_use_intent` includes `binding_authority`) | allowed as doctrinal context | allowed |
| more than ordinary Q&A | yes — plan asks for mapping of articles, debates and a reading list | yes | yes |

**Key finding #1:** the top-level planner recognises all three as academic, but the
`academic_literature_*` machinery built in the previous track only turns on for P2. The literature-mode
detector does not fire on the plain Hebrew phrasing "תעשה לי סקירת ספרות על X" when the planner routes
to `literature_map` — so gate trace, body topicality, named-synthesis telemetry and thin-pack recovery
are all inert for exactly the prompts this validation targets (`gate_trace: null`, `body_topicality: []`,
`named_synthesis: null` for P1 and P3).

## 3. Retrieval and source funnel

| metric | P1 | P2 | P3 |
|---|---|---|---|
| raw candidates | 28 | 24 | 2 |
| sources in drafter pack | 19 | 4 | 2 |
| body-acquired | 14 | 2 | 2 |
| scholarship in pack | 7 (s7–s11, s15–s17) | 1 (s6, contract-law article) | 1 (s2) |
| direct scholarship bodies | 5 | 0 | 1 (adjacent at best) |
| adjacent scholarship bodies | 2 | 1 | 1 |
| off-topic bodies | 0 | 1 (contract remedies) | 0 |
| representative sources | 6 | 0 | 2 |
| model-emitted refs | 6 | 1 | 2 |
| CSM-kept refs | 9 | 2 | 2 |
| alignment-kept refs | 5 | 1 | 2 |
| final footnotes | 3 | 1 | 2 |
| distinct cited sources | 3 | 1 | 2 |

## 4. Strong direct literature (P1, the richest pool)

| source | role | found | admitted | body | verifier | in_pack | emitted | cited | loss_reason |
|---|---|---|---|---|---|---|---|---|---|
| היסוד החוקתי של עילות הביקורת השיפוטית המינהליות | scholarship | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| גלגולי מושג "שלטון החוק" בישראל | scholarship | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| נדב דגן — מידתיות חוקתית, סבירות מנהלית | scholarship | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | `in_pack_but_not_chosen_by_model` |
| עילת אי-הסבירות במשפט המנהלי: היבטים השוואתיים | scholarship | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | `in_pack_but_not_chosen_by_model` |
| המחלוקת על ההיסטוריה של התפתחות עילת הסבירות | book_or_chapter | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | `in_pack_but_not_chosen_by_model` |
| מי קובע את עקרונות היסוד של השיטה המשפטית? | scholarship | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | `footnote_builder_or_reference_only` |
| מי מפקח על המפקחת? | scholarship | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | `in_pack_but_not_chosen_by_model` |
| ארבעה מיתוסים ביחס לביקורת שיפוטית | scholarship | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | dropped pre-CSM |
| בג"ץ 5658/23 (judgment) | binding_case_law | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| חוק יסוד: כבוד האדם וחירותו | primary_statute | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | `topic_aware_alignment_removed_ref` |

**Key finding #2:** acquisition is no longer the bottleneck for P1. 14 of 19 pack sources have real
bodies and 7 direct scholarship items reach the pack fully usable — but the drafter emits refs for only
6 and cites 3. Five verifier-usable direct scholarship bodies are simply never referenced.

## 5. Pack utilisation

**P1** — 7 scholarship sources in pack, 2 cited. The three most on-topic items (דגן; עילת אי-הסבירות
היבטים השוואתיים; המחלוקת על ההיסטוריה של התפתחות עילת הסבירות) were never emitted, yet the answer
paraphrases exactly their content anonymously: "בספרות ובפסקי דין תוארה התפתחות…", "במחקר הישראלי
מצוינת השפעה של מודלים זרים". This is anonymous paraphrase of packed, body-acquired sources — the
clearest single defect in this validation.

**P2** — 4 pack sources, only one scholarship item, and it is a *contract-law* article on
expectation/reliance damages. It is cited three times and explicitly used as an analogy
("מאמרים בתחום דיני החוזים… מספקים מודל פרשני מועיל"). No administrative-promise scholarship
(ידין, זמיר, ברק-ארז) reached the pack at all; retrieval returned 24 candidates but nothing direct.

**P3** — 2 pack sources only, both cited. The scholarship item ("בכמה קולות מדברת המדינה?") is adjacent,
not a proportionality/reasonableness study.

## 6. Named synthesis

- Named sources appearing in prose: **zero in all three answers.** No author name (דגן, ברק, זמיר,
  ידין, מדינה) appears in the body text; sources exist only as superscript numbers.
- Generic phrases present in all three: "בספרות ובפסקי דין תוארה", "במחקר הישראלי מצוינת",
  "הספרות המוצגת מדגישה", "כפי שמתפתח… בכתיבה האקדמית".
- Most generic claims do carry a footnote, so they are formally supported, but the support is
  positional, not attributed.
- No source is compared with another. No disagreement is mapped. The answers list ideas.

## 7. Product-quality scores (1–10)

| criterion | P1 | P2 | P3 |
|---|---|---|---|
| academic intent detection | 7 | 7 | 6 |
| source relevance | 7 | 3 | 4 |
| source quality | 8 | 4 | 6 |
| source diversity | 3 | 2 | 3 |
| named synthesis | 2 | 2 | 2 |
| citation precision | 6 | 4 | 4 |
| usefulness to a seminar student | 4 | 3 | 3 |
| Hebrew naturalness | 5 | 5 | 4 |
| overall product readiness | 4 | 3 | 3 |

Hebrew quality notes: P1 "חוקת היסוד על כבוד האדם וחירותו", "רקע חוקה מסגרתיים", "במשטר החוק הישראלית";
P2 "נתח העבודה", "יש להסוות מערך מחקר" (should be להתוות); P3 "ההתפתחות התיאטרלית" (theatrical instead of
theoretical). These are grammatical/lexical slips a Hebrew-reading law student will notice.

## 8. Qualitative answers

- **Respectable review or preliminary note?** All three are preliminary notes. P1 is the closest to a
  usable skeleton; P2 and P3 are notes.
- **Meaningful research value?** Partially for P1 (three real authorities, one of them the 2024 reasonableness
  judgment). No for P2 and P3.
- **Artificially limited?** Yes for P1 — five usable direct sources sat unused in the pack.
- **Overuse of disclaimers?** Yes. P1 ends with a "מגבלת ביסוס" block, P2 with a draft caveat plus repeated
  "במאגר שסופק" hedging, P3 with a processing-limit notice. For a natural user prompt this reads defensive.
- **Enough sources for the scope, without padding?** No — not because of padding rules but because packed
  sources went uncited.
- **Real scarcity or pipeline loss?** P1: pipeline loss (drafter-side). P2: real acquisition scarcity plus
  off-topic substitution. P3: retrieval scarcity (2 candidates only) plus facet contamination.
- **Main blocker:** pack utilisation / drafter citation behaviour, with literature-mode detection for
  natural prompts as the enabling second cause.

### Additional defect found (P3)

Facet expansion produced a facet titled **"עילת ההתערבות של בג\"ץ בבית דין דתי"** with the query
"התערבות בג\"ץ בפסיקת בית הדין הרבני חריגה מסמכות" — content from an unrelated earlier question. Two
paragraphs of the P3 answer discuss rabbinical courts and civil-law application, which the user never
asked about. This is topical contamination in claim/facet construction and should be treated as a bug.

## 9. Comparison to prior lab-style literature-only validation

| | lab prompts (L1/L2) | natural prompts (P1/P2/P3) |
|---|---|---|
| literature mode | on for both | on for 1 of 3 |
| scholarship bodies acquired | 2 / 6 | 5 / 0 / 1 |
| distinct cited sources | 1 / 3 | 3 / 1 / 2 |
| off-topic body spend | 0 / 0 | 0 / 1 / 0 |

- P1 performed **better** than lab L1 (3 cited vs 1, and a far richer pack).
- P2 performed **worse** than lab L2 (1 cited vs 3, and the one source is contract law).
- Dropping the strict "literature only / no case law" wording **helped** P1: the 2024 בג"ץ 5658/23
  judgment is genuinely useful context for a reasonableness review and did not crowd out scholarship.
  It **hurt** P2: without the explicit literature-only instruction, the pack filled with a statute, an
  AG-guidelines page and a case, leaving one scholarship slot that was then filled off-topic.
- Net: natural prompts are viable, and case law as context is an asset, not a threat — but only when the
  scholarship pack is actually used.

## 10. Recommendation

**One primary next step: `literature_pack_utilisation_v1`.**

The gates are now delivering usable direct scholarship (P1: 7 in pack, 5 verifier-usable and unused).
The loss has moved decisively to the drafter: it paraphrases packed sources anonymously instead of
attributing them. Fixing utilisation — attribution of paraphrased positions to the named packed source,
and naming authors in prose — converts P1 from a 4 to a plausible 7 without any new retrieval, padding or
fixed source count. Literature-mode detection for natural prompts and the P3 facet contamination should be
folded in as sub-items of that track, since they gate the same telemetry.
