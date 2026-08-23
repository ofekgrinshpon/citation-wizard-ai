# core_authority_registry_v1 — validation run (D1–D6 + controls)

Generated: 2026-08-23T08:34:31.148Z  
Mode: export only — no code, prompt, retrieval, verifier, drafter, label, footnote or gate changes. Questions executed sequentially.

## Overview

| ID | Topic | Runtime | Terminal status | Branch | Footnotes | Dangling | Orphan rows | Metadata-only holdings | Interruption |
|---|---|---|---|---|---|---|---|---|---|
| P02 | control — fake docket | 91s | done | docket_limitation | 0 | 0 | 0 | — | none |
| B8 | control — canonical quote | 81s | done | canonical_quote_registry | 1 | 0 | 0 | — | none |
| NOISE | control — generic legal query | 151s | done | — | 1 | 0 | 0 | — | none |


---

## P02 — control — fake docket

**Query**

> מה נקבע בע"א 99887-04-22 לוי נ' מדינת ישראל?

| Field | Value |
|---|---|
| Runtime | 91s |
| Terminal status | done |
| Branch | docket_limitation |
| Footnote count | 0 |
| Inline markers | 0 |
| Dangling markers | 0 |
| Orphan source rows | 0 |
| used_sources | 0 |
| Metadata-only holdings | — |
| CSM applied | n/a |
| CSM source_ref_mismatch_count | n/a |
| CSM unsupported_block_count | n/a |
| CSM commentary_only_claims | n/a |
| CSM primary_support_by_main_claim | n/a |
| Registry triggered | false |
| Registry doctrine_id | — |
| Registry matched_facet | — |
| Registry queries added | 0 — [] |
| Registry skipped (already present) | [] |
| Statute-title normalisation | {"applied":false,"rewrites":[],"rewritten_count":0} |
| Support distribution | {"unrelated":23,"tangential":4,"partial":1} |
| Candidates (listing / metadata-only) | 0 (0 / 0) |
| Retrieval interruption / CPU / stale worker | none |
| Job error | none |

**Hebrew limitation notices**

_none_

**Full final user-facing answer**

```markdown
לא אותר במקורות הזמינים פסק הדין בעניין ע"א 99887/04/22 עצמו. לכן לא ניתן לקבוע באופן מוסמך מה נקבע בו, מה היו הנימוקים או מה הייתה תוצאת ההליך. אין להשיב מתיקים דומים, ממקורות רקע או מספרות משנית.

אם יש לך את פסק הדין בקובץ PDF/DOCX או צילום, אפשר להעלות אותו כאן, ואנתח מתוכו את ההחזקה, הנימוקים המרכזיים, העובדות הרלוונטיות והמשמעות המשפטית.
```

**Full rendered source list**

_(אין מקורות מצוטטים)_


---

## B8 — control — canonical quote

**Query**

> צטטו את סעיף 1 לחוק יסוד: כבוד האדם וחירותו.

| Field | Value |
|---|---|
| Runtime | 81s |
| Terminal status | done |
| Branch | canonical_quote_registry |
| Footnote count | 1 |
| Inline markers | 2 |
| Dangling markers | 0 |
| Orphan source rows | 0 |
| used_sources | 1 |
| Metadata-only holdings | — |
| CSM applied | n/a |
| CSM source_ref_mismatch_count | n/a |
| CSM unsupported_block_count | n/a |
| CSM commentary_only_claims | n/a |
| CSM primary_support_by_main_claim | n/a |
| Registry triggered | false |
| Registry doctrine_id | — |
| Registry matched_facet | — |
| Registry queries added | 0 — [] |
| Registry skipped (already present) | [] |
| Statute-title normalisation | {"applied":false,"rewrites":[],"rewritten_count":0} |
| Support distribution | {"direct":1,"partial":11,"unrelated":4,"tangential":2} |
| Candidates (listing / metadata-only) | 0 (0 / 0) |
| Retrieval interruption / CPU / stale worker | none |
| Job error | none |

**Hebrew limitation notices**

_none_

**Full final user-facing answer**

```markdown
הנוסח המחייב של סעיף 1 לחוק-יסוד: כבוד האדם וחירותו (נוסח מילולי): "זכויות היסוד של האדם בישראל מושתתות על ההכרה בערך האדם, בקדושת חייו ובהיותו בן-חורין, והן יכובדו ברוח העקרונות שבהכרזה על הקמת מדינת ישראל.".¹

הציטוט מובא כלשונו מהמקור הרשמי המצוין למעלה; לא בוצע שינוי, תמצות או ניסוח מחדש.¹

> לא אותרה פסיקה ברת-שימוש במסגרת החיפוש; התשובה מתמקדת בלשון הסעיף.
```

**Full rendered source list**

1. חוק-יסוד: כבוד האדם וחירותו – נוסח רשמי (PDF) — https://m.knesset.gov.il/Activity/Legislation/Documents/yesod3.pdf
    - חוק-יסוד: כבוד האדם וחירותו – נוסח רשמי (PDF) — https://m.knesset.gov.il/Activity/Legislation/Documents/yesod3.pdf


---

## NOISE — control — generic legal query

**Query**

> מהם השלבים העיקריים בהגשת תביעה אזרחית בבית משפט השלום בישראל?

| Field | Value |
|---|---|
| Runtime | 151s |
| Terminal status | done |
| Branch | — |
| Footnote count | 1 |
| Inline markers | 1 |
| Dangling markers | 0 |
| Orphan source rows | 0 |
| used_sources | 2 |
| Metadata-only holdings | — |
| CSM applied | true |
| CSM source_ref_mismatch_count | 7 |
| CSM unsupported_block_count | 3 |
| CSM commentary_only_claims | [] |
| CSM primary_support_by_main_claim | true |
| Registry triggered | false |
| Registry doctrine_id | — |
| Registry matched_facet | — |
| Registry queries added | 0 — [] |
| Registry skipped (already present) | [] |
| Statute-title normalisation | {"applied":false,"rewrites":[],"rewritten_count":0} |
| Support distribution | {"direct":5,"unrelated":9,"partial":9,"tangential":7} |
| Candidates (listing / metadata-only) | 0 (0 / 0) |
| Retrieval interruption / CPU / stale worker | none |
| Job error | none |

**Dropped source refs**

| ref | block | reason | block claim | block area | source area |
|---|---|---|---|---|---|
| s3 | 1 | commentary_in_substantive_block | C2 | — | — |
| s3 | 2 | claim_mismatch | C3 | — | — |
| s1 | 2 | claim_mismatch | C3 | — | — |
| s4 | 3 | claim_mismatch | C4 | — | — |
| s2 | 4 | claim_mismatch | C5 | — | — |
| s4 | 4 | claim_mismatch | C5 | — | — |
| s3 | 4 | claim_mismatch | C5 | — | — |

**Hebrew limitation notices**

> **מגבלת ביסוס:** חלק מהקביעות שלעיל נותרו ללא מקור בר-ציטוט שאומת ישירות לאותה טענה. מקורות שאותרו בנושא סמוך, מקורות רקע או ספרות פרשנית אינם מצוטטים כאן כאסמכתה ישירה. יש לאמת קביעות אלה מול המקור הראשוני (חקיקה או פסק דין) לפני הסתמכות.

**Full final user-facing answer**

```markdown
- בדיקת סמכות — לפני הגשת התביעה יש לוודא שבית משפט השלום הוא הדיוני המתאים מבחינת סמכות עניינית ומקומית (מקום מגוריו או מקום עסקו של הנתבע, מקום המעשה/המחדל או מקרקעין), ולשקול האם קיים הסכם שיפוט או סמכות של בית משפט אחר שיש להכיר בו.¹
- ניסוח כתב תביעה — להכין כתב תביעה שמכיל זהות הצדדים, טענות עובדתיות וחוקיות ברורות, הסבר על עילת התביעה, הסעד המבוקש ונספחים מתויגים וממוספרים; יש להקפיד על הדרישות הפורמליות וההנחיות המפורשות לגבי ניסוח ונספחים.
- הגשה פורמלית ותשלום אגרה — להגיש את כתב התביעה בלשכת בית המשפט או באמצעים הממוחשבים המקובלים, לשלם את האגרה הנדרשת ולהקפיד על צירוף עותקים ופרוטוקול ההגשה בהתאם להוראות הרלוונטיות.
- מסירת כתב התביעה לנתבע — מסירה של כתב התביעה לנתבע היא שלב מרכזי שמניע את מועדי ההגנה; עם זאת, במקורות שאותרו לא נמצא עיגון מפורש וכולל לטקסט המפרט את דרכי המסירה וההשלכות הספציפיות של כל אמצעי מסירה, ויש לבדוק את נוסח הדין המלא והכללים המעוגנים בתקנות ובפסיקה הרלוונטית.
- הליכים מקדמיים, ראיות ופסק דין — לאחר מענה של הנתבע מתקיימים שלבים מקדמיים (דיון מקדמי, גילוי מסמכים וטפסי דיווח), לשופט נתונות סמכויות קדם-משפטיות, ואחריהם נערכת הלכה של הוכחות ודיונים שיכולים להוביל לפסק דין; על פסק הדין חלות אפשרויות ערעור וההוצאה לפועל הרגילות.

הערת דלילות מקורות: הטקסט החוקי והתמיכה שנמצאו כאן קצרים וחלקיים, וטקסט ההוראה המלא של תקנות, סעיפים או פסיקה לא היה בידינו במלואו; יתכן שיש נוסחים או פסקי דין נוספים שלא אותרו בחיפוש זה.

**מגבלת ביסוס:** חלק מהקביעות שלעיל נותרו ללא מקור בר-ציטוט שאומת ישירות לאותה טענה. מקורות שאותרו בנושא סמוך, מקורות רקע או ספרות פרשנית אינם מצוטטים כאן כאסמכתה ישירה. יש לאמת קביעות אלה מול המקור הראשוני (חקיקה או פסק דין) לפני הסתמכות.
```

**Full rendered source list**

1. ע"א 7791/19 שלה אמין נ׳ מדינת ישראל- משרד המסחר והתעשייה פסק דין (03.06.2020); תקנות סדר הדין האזרחי, תשע"ט-2018 - נבו — https://www.toledano.co.il/%d7%a9%d7%9c%d7%94-%d7%90%d7%9e%d7%99%d7%9f-%d7%a0-%d7%9e%d7%93%d7%99%d7%a0%d7%aa-%d7%99%d7%a9%d7%a8%d7%90%d7%9c-%d7%9e%d7%a9%d7%a8%d7%93-%d7%94%d7%9e%d7%a1%d7%97%d7%a8-%d7%95%d7%94%d7%aa%d7%a2/%d7%a4%d7%a1%d7%99%d7%a7%d7%94-%d7%97%d7%99%d7%a0%d7%9d/
    - ע"א 7791/19 שלה אמין נ׳ מדינת ישראל- משרד המסחר והתעשייה פסק דין (03.06.2020) — https://www.toledano.co.il/%d7%a9%d7%9c%d7%94-%d7%90%d7%9e%d7%99%d7%9f-%d7%a0-%d7%9e%d7%93%d7%99%d7%a0%d7%aa-%d7%99%d7%a9%d7%a8%d7%90%d7%9c-%d7%9e%d7%a9%d7%a8%d7%93-%d7%94%d7%9e%d7%a1%d7%97%d7%a8-%d7%95%d7%94%d7%aa%d7%a2/%d7%a4%d7%a1%d7%99%d7%a7%d7%94-%d7%97%d7%99%d7%a0%d7%9d/
    - תקנות סדר הדין האזרחי, תשע"ט-2018 - נבו — https://www.nevo.co.il/law_html/law00/157751.htm


---

## Human readthrough checklist (fill manually)

| ID | Grade (Good/Acceptable/Limited/Fail) | Answered the question? | Sources legally relevant? | Primary source when needed? | Any unrelated source? | Topic contamination? | Broken Hebrew / awkward phrasing? | Over-refusal? | Overclaiming? | Main failure pattern |
|---|---|---|---|---|---|---|---|---|---|---|
| P02 |  |  |  |  |  |  |  |  |  |  |
| B8 |  |  |  |  |  |  |  |  |  |  |
| NOISE |  |  |  |  |  |  |  |  |  |  |
