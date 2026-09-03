# post_local_corpus_unlock_value_audit_v1 — read-only value audit

No code changed. Runs audited (latest after the three accepted local-corpus tracks):

| Fixture | run_id | genre / depth mode | pool found → admitted | local caselaw gate (checked/bypassed) | footnotes |
|---|---|---|---|---|---|
| AW4 | cdb05e22-ae19-4a17-b716-9b1f20624998 | theoretical_background / academic_research | 210 → 12 (13 admitted) | 53 / 53 | 6 |
| AW9 | 834c71fe-feed-4921-a612-0f304761db04 | theoretical_background / narrow_doctrine | 203 → 21 (22 admitted) | 93 / 93 | 6 |
| AW7 | 2d26d269-b073-4634-89ca-d2c16d49cae6 | argument_paragraph / narrow_doctrine | 125 → 8 (9 admitted) | 43 / 43 | 1 |

Full answer text + footnote lists: `ANSWERS.md` in this folder.

## 1. Source-role table

### AW4 (13 admitted)
| Source | integrity tier | usability | citable_as | assigned role | used in answer |
|---|---|---|---|---|---|
| חוק-יסוד: כבוד האדם וחירותו | statute_mirror | full_text | statute | primary_statute | yes (fn 2) |
| בג"ץ 5658/23 (ביטול עילת הסבירות) | primary_mirror | full_text | judgment | scholarship(!) | yes (fn 1) |
| על המידתיות של המידתיות (ברק/מידתיות) | secondary_commentary | full_text | scholarship | scholarship | yes (fn 3,4,5) |
| נדב דגן, מידתיות חוקתית סבירות מנהלית | secondary_commentary | full_text | scholarship | scholarship | yes (fn 3,4,6) |
| עשרים שנה לבנק המזרחי | secondary_commentary | full_text | scholarship | government_report(!) | yes (fn 3,6) |
| פרשנות תכליתית / דברי הסבר | secondary_commentary | full_text | scholarship | primary_statute(!) | yes (fn 4) |
| חופש הביטוי בתקשורת המקוונת | secondary_commentary | full_text | scholarship | primary_statute(!) | yes (fn 5) |
| כיבוד האדם והמשפט החוקתי בישראל | secondary_commentary | full_text | scholarship | primary_statute(!) | yes (fn 6) |
| הזכות החוקתית לגוף (ברק) | secondary_commentary | full_text | scholarship | primary_statute(!) | no |
| ארגוני עובדים ומו"מ קיבוצי | secondary_commentary | full_text | scholarship | primary_statute(!) | no — off topic |
| ייצוג משפטי בהליכי משמעת | secondary_commentary | full_text | scholarship | primary_statute(!) | no — off topic |
| איסור הלבנת הון | secondary_commentary | full_text | scholarship | government_report(!) | no — off topic |
| בימ"ש שלום לתעבורה חדרה, ביטול פסילה מנהלית | official_primary | substantive_excerpt | judgment | primary_statute(!) | no — off topic |

### AW9 (22 admitted, condensed)
| Group | count | example | used |
|---|---|---|---|
| statute mirror | 1 | חוק-יסוד: כבוד האדם וחירותו | yes (fn 2,3) |
| Supreme Court judgments (official_primary, substantive_excerpt) | 8 | בג"ץ 4634/04 רופאים לזכויות אדם; בג"ץ 7146/12 אדם; בג"ץ תיקון חוק-יסוד: הממשלה | only 4634/04 used (fn 1,2) |
| lower-court judgments unlocked by the new gate | 3 | גזר דין שלום ב"ש; הכרעת דין שלום י-ם | none used (correct) |
| scholarship | 10 | פיצוי נאות; הזכות המנהלית והסעד הכספי; דגן | 3 used (fn 4,5,6) |

### AW7 (9 admitted)
| Source | tier | role | used |
|---|---|---|---|
| בג"ץ 2075/23 סילביה חדד | primary_mirror / full_text / judgment | binding_case_law | **no** |
| הערות על ביקורת הסבירות במשפט המינהלי | secondary_commentary | binding_case_law | **no** |
| בג"ץ 5658/23 | primary_mirror | scholarship | no |
| נדב דגן | secondary_commentary | scholarship | no |
| חוק-יסוד: כבוד האדם וחירותו | statute_mirror | primary_statute | no |
| בכמה קולות מדברת המדינה / להיות כמו דלוור / הסכמה מהדת | secondary_commentary | scholarship | yes (fn 1, compound) |
| ביהמ"ש המחוזי — עיון בתיק | official_primary | binding_case_law | no |

## 2. Claim-to-source support table

| Fixture | block claim | cited source | verdict |
|---|---|---|---|
| AW4 | three/four-part proportionality structure | scholarship (המידתיות של המידתיות, דגן) | supported, correct role |
| AW4 | "פסקת ההגבלה בחוקי היסוד יוצרת מסגרת" | Basic Law mirror (fn 2) | primary anchor correct in kind, but only whole-statute framing — §8 text not located, so the anchor is nominal |
| AW4 | comparative roots (Wednesbury / strict scrutiny) | Israeli scholarship (fn 3) | weakly supported; no comparative source |
| AW4 | methodological distinction between constitutional authority and literature (fn 1) | בג"ץ 5658/23 (reasonableness-ground case) | **mismatch** — case is not a proportionality authority and does not support that claim |
| AW9 | definition/function of reliance & legitimate expectation | דגן (proportionality/reasonableness article) | tangential; not a legitimate-expectation source |
| AW9 | reliance embedded in judicial review of administrative action (fn 1) | בג"ץ 4634/04 רופאים לזכויות אדם (prison conditions) | **mismatch** — no reliance holding |
| AW9 | policy change may weaken reliance (fn 2) | 4634/04 + חוק-יסוד: כבוד האדם וחירותו | **mismatch** — Basic Law is not the anchor for administrative reliance |
| AW9 | remedies for frustrated reliance (fn 5,6) | פיצוי נאות; הזכות המנהלית והסעד הכספי | genuinely on point — best-supported claim in the run |
| AW7 | intervention permitted only in exceptional legal defects | 3 tangential journal articles (compound fn 1) | **weak** — the on-point "הערות על ביקורת הסבירות במשפט המינהלי" and בג"ץ 2075/23 were admitted but unused |

## 3. Questionable citation table

| # | Fixture | Citation | Problem | Severity |
|---|---|---|---|---|
| Q1 | AW4 | בג"ץ 5658/23 attached to a methodology sentence | judgment used decoratively; no holding drawn, wrong doctrinal subject | high |
| Q2 | AW4 | Basic Law cited from wikisource mirror | local corpus resolved the law but the rendered citation is a mirror URL, not an official source | medium |
| Q3 | AW4 | fn 3/4/5/6 repeat the same 2–3 articles in compound bundles | low informational diversity; compound footnotes mask duplication | medium |
| Q4 | AW9 | בג"ץ 4634/04 as the reliance anchor | topical mismatch; binding case law used off-doctrine | high |
| Q5 | AW9 | חוק-יסוד: כבוד האדם וחירותו in an administrative-reliance chapter | false primary anchor (wrong legal area) | high |
| Q6 | AW9 | 8 substantive Supreme Court judgments admitted, 1 used | selection/utilization loss, not retrieval loss | medium |
| Q7 | AW7 | compound footnote of three unrelated articles; on-point reasonableness scholarship unused | wrong source picked despite a better one in pack | high |
| Q8 | AW4 | role labels: journal articles slotted as `primary_statute`, judgment slotted as `scholarship` | role assignment is not topic-aware; explains Q1/Q5 | high (root cause) |

## 4. Limitation notes

- AW4/AW9 closing note ("הטיוטה מבוססת על המקורות שאותרו…") is generic and now **under-cautious**: it does not warn that a cited judgment is off-doctrine.
- AW9's in-text admissions ("במקורות שסופקו הדיון… לא הולבש בתוך נוסח חקיקה אחד או במבחן פסיקתי מקובל יחיד") are **accurate** — the pack genuinely lacked a legitimate-expectation authority, even though it contained 8 judgments.
- AW7's note ("יש להשלים הפניות מדויקות לפסיקה ולספרות") is accurate and appropriately restrained.
- No over-caution / no stale insufficiency refusals were observed. Limitation notes are no longer the bottleneck.

## 5. Before → after value assessment

| Dimension | Before the three tracks | Now |
|---|---|---|
| Local statutes reach pack | no (external failures, statute_count 0) | yes — Basic Law resolved locally, no external attempt |
| Local caselaw reaches pack | suppressed by collector URLs | 53/93/43 candidates unlocked, 0 false listings |
| Judgments in pack | ~0 substantive | AW9 8, AW7 2–3, AW4 1 + 1 lower court |
| Footnote count | AW4 2–5, AW9 0–4, AW7 1 | AW4 6, AW9 6, AW7 1 |
| Topical precision of selected sources | poor | still poor — unchanged by these tracks |
| Role assignment correctness | poor | still poor |

Recall is fixed. Precision-of-use is not.

## 6. Scores (0–10)

| Dimension | AW4 | AW9 | AW7 |
|---|---|---|---|
| Legal correctness (statements as written) | 8 | 7 | 8 |
| Source relevance | 5 | 4 | 3 |
| Source-role coverage | 6 | 6 | 3 |
| Primary-anchor quality | 5 (statute framing only, judgment off-topic) | 3 (wrong statute, wrong judgment) | 2 (no primary used) |
| Citation precision | 4 | 3 | 3 |
| Academic usefulness | 6 | 5 | 4 |
| Hebrew naturalness | 6 | 6 | 5 |

## 7. Answers to the audit questions

1. **Correct use of local sources?** Partly. Local statute and local caselaw now arrive, but the drafter picks by lexical/rank proximity, not doctrinal fit.
2. **Primary-law claims on primary sources?** Formally yes (statute mirror carries the framing claims), substantively weak — AW9 anchors an administrative doctrine on a constitutional Basic Law.
3. **Judgment citations relevant?** No. 5658/23 (AW4) and 4634/04 (AW9) do not support the propositions they footnote.
4. **AW4 meaningful case-law support?** No — one decorative judgment; the substantive load is carried by scholarship.
5. **AW9 binding case law used appropriately?** No — 8 substantive judgments in pack, 1 used, and that one is off-doctrine.
6. **Role-diverse, non-duplicative footnotes?** AW9 yes-ish (statute + judgment + 2 distinct remedy articles); AW4 no (compound bundles repeat 3 articles); AW7 no (single compound of 3 unrelated articles).
7. **Limitation notes accurate?** Yes, and no longer over-cautious — but they do not flag off-topic authority.
8. **Remaining weakness?** **Source/content selection quality**, not Hebrew prose. Prose is already at ~6/10 and is not what makes these drafts unusable; a wrongly-anchored footnote is.

## 8. Recommendation

Do **not** move to Hebrew naturalness yet. One more precision track is justified, focused on use rather than retrieval:

1. **Topic-aware role assignment** — a journal article must not be slotted `primary_statute`; a judgment must not be slotted `scholarship` (AW4 root cause Q8).
2. **Legal-area anchor guard** — reject a statute/judgment as a claim's primary anchor when its legal area does not match the claim's area (kills Q4/Q5).
3. **Relevance-ranked drafter pack ordering** — surface the most doctrinally on-point admitted source per block; AW7 shows the right source was already in the pack and simply not chosen.
4. Optional: split compound footnotes when the bundled items serve different claims (Q3).

After that, Hebrew naturalness becomes the top remaining gap.
