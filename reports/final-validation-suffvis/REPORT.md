# Final validation — acquisition → sufficiency visibility

Run date: 2026-08-04. Deployed function, smoke mode, one run per fixture.
Raw records: `reports/final-validation-suffvis/*.json` (full metadata, source packs, answers).

| # | Query | Branch | Sufficiency reason | Usable judgments | Drafted | Grade |
|---|---|---|---|---|---|---|
| R03 | הלכת השיתוף | — | `case_law_synthesis_supported` | 1 (`s1`) | yes | acceptable |
| R04 | הרמת מסך ההתאגדות | `insufficient_sources_limitation` | `no_usable_judgment_authority` | 0 | no (correct refusal) | limited (safe) |
| R09 | מבחן ההשתלבות | `insufficient_sources_limitation` | `no_topical_source` | 1 (`s11`, verifier `unrelated`) | no (correct refusal) | limited (safe) |
| R01 | קעדאן | — | `shape_not_gated` | 2 | yes | good |
| R02 | בנק המזרחי | — | `shape_not_gated` | 2 | yes | acceptable/limited |
| P02 | fake docket | `docket_limitation` | n/a | 0 | deterministic refusal | correct |
| B8 | §1 כבוד האדם | `canonical_quote_registry` | n/a | 0 | canonical quote | correct |

No stubs (0/7). No verifier errors (`verifier.errors: []` in all runs).

---

## A. Sufficiency detail (R03 / R04 / R09)

### R03 — הלכת השיתוף (run `e83fd20c-6d41-4554-81da-8de83147359e`)
- profile: `case_law_synthesis`; passed: **true**; reason: `case_law_synthesis_supported`
- `usable_judgment_refs`: `["s1"]` — בע"מ 4623/04
- verifier verdict for s1: **direct**
- `morphology_domain_match`: false at the flag level; the family-law domain match is satisfied through the case-law domain predicate (statute-morphology flag is only set on the statute path)
- `phrase_hit` for s1: **false** — "הלכת השיתוף" does not appear inside the 6,000-char acquired body slice
- `topical_refs`: `["s2"]` (scholarship), `topical_authority_refs`: `["s2"]`
- Why it counted as topical: the new rule — a **usable judgment** (`citable_as=judgment`, `text_usability=full_text`, holding text present) with a **direct** verifier verdict counts as topical grounding without an exact phrase hit. Commentary `s2` did not carry the gate; it only added a phrase-level topical ref.
- `thin_source`: true → thin-authority disclosure line fired in the answer.

### R04 — הרמת מסך (run `551f7395-66bf-4451-bded-ea90e90c1571`)
- profile: `case_law_synthesis`; passed: **false**; reason: `no_usable_judgment_authority`
- `usable_judgment_refs`: `[]`
- Acquisition ran (2 attempts, 2 "successes"), but both acquired bodies were **institutional/listing wrappers**, not judgments: `supremedecisions.court.gov.il` root (verifier `unrelated`) and a gov.il spokesperson listing page (verifier `tangential`). Both `usable_for_holding=false`, `can_support_synthesis_holding=false`.
- `topical_refs`: `["s4"]` — statute/commentary only (חוק החברות, חוק חדלות פירעון, psakdin note); phrase_hit true for commentary, but commentary cannot satisfy the judgment requirement.
- Two further judgment candidates (`ע"א 52/80`, `ע"פ 566-77`-class) were excluded as `institutional_page`; budget was not spent on them.
- Outcome: correct fail-closed refusal. No doctrine synthesized from company-law statutes by analogy.

### R09 — מבחן ההשתלבות (run `50f4fe7e-3783-4492-b0d1-2a3aef09e1c2`)
- profile: `case_law_synthesis`; passed: **false**; reason: `no_topical_source`
- `usable_judgment_refs`: `["s11"]` — a court.gov.il download whose body resolved to "מערכת בתי המשפט", `has_holding_text=false`
- verifier verdict for s11: **unrelated**
- domain_match: false; phrase_hit: false
- Why it did **not** count as topical: the direct-verdict substitution applies only to `direct` verdicts on usable judgments. An `unrelated` verdict cannot substitute for a phrase/topic hit — exactly the guardrail requested.
- Outcome: correct fail-closed refusal; the retrieved pack was labour-law statutes (פיצויי פיטורים, זכויות פרישה) with no case law on מבחן ההשתלבות.

---

## B. Acquired judgments used as authority

### R03
| Field | Value |
|---|---|
| Title | בע"מ 4623/04 |
| URL | `supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts\04/230/046/p06...` |
| extracted / acquired text length | 35,771 → 6,000 (slice) |
| method | `direct_file_fetch`, 1,032 ms |
| `body_contains_docket_or_title` | true |
| `has_holding_text` | true |
| `usable_for_holding` | true |
| `citable_as` / tier | `judgment` / `official_primary` |
| verifier | **direct** |
| In answer body | yes — footnote 1, cited in "שורה תחתונה", "המקור הפסיקתי המרכזי", "יישומים", "מגבלות והבחנות" |
| Legal move supported | the qualitative "חיי שיתוף" test, the strengthened presumption for the family residence, and the carve-outs for personal/business assets |

Other acquisitions in R03 (not used as leading authority, correctly demoted): הנחיות הנשיאה 1.1.2020 (`usable_for_holding=false`, tangential), בג"ץ 8202/17 via toledano.co.il and a HUJI article — both classified `secondary_commentary`.

### R04 / R09
No judgment was used as authority — acquisition produced only institutional/listing bodies, both runs refused. Nothing in the answer bodies is attributed to them.

---

## C. Final answer bodies

### R03
```
**שורה תחתונה**

בעמ 4623/04 קובע קו־פסיקה שהופך לחזקה את רעיון ה'שיתוף' בנכסים שנצברו במהלך חיי נישואין או משק בית משותף באמצעות מבחנים איכותיים של חיי שיתוף, כאשר החזקה נוטה להיות מחוזקת ביחס לדירת המגורים המשפחתית.¹

**המקור הפסיקתי המרכזי שנמצא**

בעמ 4623/04 — פסק דין של בית המשפט העליון שבו נדון גבול היישום של חזקה שיתופית ברכוש שנצבר על ידי בני זוג; בפסק הדין נקבעו קריטריונים איכותיים לבחינת קיומם של 'חיי שיתוף' ולשיקול חלוקת הרכוש, כאשר בית המשפט הצביע על עוצמת חזקה מוגברת בכל הנוגע לדירת המגורים המשפחתית.¹

**יישומים בפסיקה שנמצאה**

באותו פסק דין יושם המבחן על נסיבות עובדתיות: בית המשפט שקל משך הקשר, השתתפות במשק הבית, תרומות כלכליות והיקף המעורבות המשותפת וקבע בהתאם את היקף ההכרה בשיתוף בנכסים מסוימים.¹

**מגבלות והבחנות**

בעמ 4623/04 הוצגו סייגים פרקטיים: נכסים בעלי אופי אישי או מקצועי, וכן נכסים הקשורים לעסק עצמאי או למוניטין אישי, עשויים לדרוש הוכחה מפורשת של כוונת שיתוף לפני שיוכר הזכיון השיתופי עליהם.¹

ספרות משנית שמסבירה את ההלכה מצביעה על נושאים שהפסיקה שוקלת בהם היבטים שונים, ובכלל זה שאלות של החלת עקרונות השיתוף ביחסים מחוץ לנישואים והמשקל שיש לתת לעובדות חיים כלכליות — אך אלו מהווים פרשנות ודיון תיאורטי, ולא מקור הלכתי מחייב בפני עצמו.²

**הרקע החקיקתי**

פקודת הראיות מהווה רקע מעשי לדיון על הנטל והסטנדרט בהוכחת חיי שיתוף; היא מספקת מסגרת ראייתית לניתוח הטענות בפסקי הדין, אך אינה קובעת את חזקה השיתוף בעצמה.³

**מה לא ניתן לקבוע מהמקורות**

החומר השיפוטי השמיש שנמצא מצומצם: יש פסק דין עליון אחד שמאפשר ניסוח הלכתי ממוקד, ואין מאגר פסקי דין שמיש ונרחב שמאפשר להסיק מסקנות גורפות לגבי נושאים כגון חלות ההלכה על ידועים בציבור, ההשלכות ביחס לנישואים בתקופות חקיקתיות שונות או נוסחי הסטנדרט הראייתי בכל תרחיש פרטני.⁴

הערת דלילות: הטקסט התומך שברשותי קצר וחלקי, ולכן התיאור כאן נסמך על המידע הזמין בלבד ולא על נוסח מלא של כל ההלכות הרלוונטיות; מסקנות מעמיקות או גורפות ידרשו בדיקה של מאגר פסקי דין רחב יותר וטקסט מלא של ההלכות.
```
Footnotes: 1 = בע"מ 4623/04 · 2 = two journal articles · 3 = פקודת הראיות · 4 = ע"א 52/80 + article.

### R04
```
לא נמצאה במקורות פסיקה ישירה על הנושא. ניתן להעלות מקור/לחדד שאלה/לבקש חיפוש נוסף.

אין לגזור את הדוקטרינה שנשאלה ממקורות מתחום משפטי אחר בדרך של היקש; לכן לא מוצגת כאן קביעה משפטית לגבי השאלה שנשאלה.

מה כן נמצא במקורות (לידיעה בלבד, ללא גזירת כללים לשאלה שנשאלה): חוק החברות, 1999 - תוכן ענינים; חוק חדלות פירעון ושיקום כלכלי, תשע"ח-2018; חוק חדלות פירעון ושיקום כלכלי – דברי הסבר/רקע חקיקתי; נדחתה בקשה להרמת המסך בשלב שלאחר מתן פסק הדין - פסקדין.
```

### R09
```
לא נמצאה במקורות פסיקה ישירה על הנושא. ניתן להעלות מקור/לחדד שאלה/לבקש חיפוש נוסף.

אין לגזור את הדוקטרינה שנשאלה ממקורות מתחום משפטי אחר בדרך של היקש; לכן לא מוצגת כאן קביעה משפטית לגבי השאלה שנשאלה.

מה כן נמצא במקורות (לידיעה בלבד, ללא גזירת כללים לשאלה שנשאלה): חוק פיצויי פיטורים, תשכ"ג-1963; חלק 8 פרישה מן השירות ו זכויות פרישה; ספר החוקים; העסקת עובדי קבלן ונותני שירותים מן החוץ במשרדי הממשלה.
```

---

## D. Manual quality check

| Check | R03 | R04 | R09 |
|---|---|---|---|
| No metadata-only holdings | PASS (only the full-text בע"מ 4623/04 carries holdings; metadata-only ע"א 52/80 appears only in the "what cannot be determined" footnote) | PASS | PASS |
| No commentary as primary authority | PASS (scholarship explicitly marked as non-binding interpretation) | PASS | PASS |
| No off-topic judgment as leading authority | PASS | PASS (off-topic wrappers never promoted) | PASS (unrelated judgment blocked by the gate) |
| No generic essay unsupported by acquired judgments | PASS — every doctrinal statement in §1–§4 is anchored to footnote 1 | PASS | PASS |
| Citations match legal moves | PASS | n/a | n/a |
| Research-grade register (not layperson advice) | PASS | PASS | PASS |
| **Grade** | **acceptable** | **limited (correct refusal)** | **limited (correct refusal)** |

R03 is "acceptable" rather than "good": the answer rests on a single acquired judgment, the case name is rendered without punctuation ("בעמ 4623/04"), and it is a family-law application case rather than the canonical השיתוף line (בג"ץ 1000/92 בבלי / ע"א 630/79 ליברמן). It states this limitation explicitly rather than papering over it.

## Controls

| Control | Expected | Result |
|---|---|---|
| R01 Ka'adan | remains good from acquired body | **PASS** — 2 usable judgments, acquired בג"ץ body with holding text (verifier `direct`), 5 footnotes, structured holding/reasoning/scope/remedy answer |
| R02 Bank Mizrahi | improves or stays clearly limited | **PASS / improved** — now 2 usable judgment refs and a drafted answer anchored to בנק המזרחי (fn 1) with normative-supremacy + dual-capacity holding; secondary literature explicitly flagged as such in fn 2 |
| P02 fake docket | deterministic refusal | **PASS** — `docket_limitation`, no footnotes, invites file upload |
| B8 §1 quote | unchanged | **PASS** — `canonical_quote_registry`, verbatim statutory text, single official footnote |

## Acceptance

| Criterion | Result |
|---|---|
| R03/R04/R09 pass only if the acquired direct judgment supports the legal move | PASS — only R03 passed, and its move is drawn from the acquired בע"מ 4623/04 body |
| Direct verifier + domain match substitutes for phrase hit only for usable judgments | PASS — R03 (direct, usable) admitted; R09 (unrelated, usable) rejected; commentary never triggered the substitution |
| Partial/tangential sources still require phrase/topic support | PASS — R03's partial/tangential judgments did not enter `usable_judgment_refs`; R04's tangential wrapper did not carry the gate |
| No stubs / verifier failures | PASS — 7/7 completed, 0 stubs, 0 verifier errors |

## Residual observations (no action taken)

1. **Discovery, not sufficiency, is now the binding constraint for R04/R09.** Both refusals are correct given the pack, but the pack contained zero real judgments on the asked doctrine. `supremedecisions.court.gov.il` root and gov.il spokesperson listing pages are still becoming *acquisition* candidates and consuming budget before real judgments (R03 hit `budget_exhausted` on two genuine gov.il judgment PDFs).
2. **R03 leading-authority selection** picked an application case over the canonical line — again a discovery/ranking issue.
3. Run-to-run variance persists on R04/R09: they drafted in the previous verification pass and refused here. The variance originates in web retrieval, not in the sufficiency gate.
