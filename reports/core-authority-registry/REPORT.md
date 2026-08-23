# core_authority_registry_v1 — validation run (D1–D6 + controls)

Generated: 2026-08-23T08:41:56.372Z  
Mode: export only — no code, prompt, retrieval, verifier, drafter, label, footnote or gate changes. Questions executed sequentially.

## Overview

| ID | Topic | Runtime | Terminal status | Branch | Footnotes | Dangling | Orphan rows | Metadata-only holdings | Interruption |
|---|---|---|---|---|---|---|---|---|---|
| D3 | בג״ץ ובית דין רבני / רכוש | 122s | done | — | 1 | 0 | 0 | — | none |


---

## D3 — בג״ץ ובית דין רבני / רכוש

**Query**

> מתי בג״ץ יתערב בהחלטה של בית דין רבני בענייני רכוש בין בני זוג, במיוחד כאשר נטען שבית הדין החיל דין דתי במקום דין אזרחי?

| Field | Value |
|---|---|
| Runtime | 122s |
| Terminal status | done |
| Branch | — |
| Footnote count | 1 |
| Inline markers | 1 |
| Dangling markers | 0 |
| Orphan source rows | 0 |
| used_sources | 1 |
| Metadata-only holdings | — |
| CSM applied | true |
| CSM source_ref_mismatch_count | 5 |
| CSM unsupported_block_count | 3 |
| CSM commentary_only_claims | [] |
| CSM primary_support_by_main_claim | true |
| Registry triggered | true |
| Registry doctrine_id | rabbinical_civil_property |
| Registry matched_facet | — |
| Registry queries added | 2 — ["בג\"ץ 1000/92 בבלי נ' בית הדין הרבני הגדול הלכת השיתוף","בג\"ץ 8638/03 סימה אמיר נ' בית הדין הרבני הגדול בירושלים"] |
| Registry skipped (already present) | ["law_rabbinical_jurisdiction"] |
| Statute-title normalisation | {"applied":false,"rewrites":[],"rewritten_count":0} |
| Support distribution | {"partial":4,"direct":1,"unrelated":6,"tangential":4} |
| Candidates (listing / metadata-only) | 0 (0 / 0) |
| Retrieval interruption / CPU / stale worker | none |
| Job error | none |

**Dropped source refs**

| ref | block | reason | block claim | block area | source area |
|---|---|---|---|---|---|
| s3 | 1 | claim_mismatch | C2 | public_law_hcj | public_law_hcj |
| s3 | 2 | claim_mismatch | C3 | family_property | public_law_hcj |
| s1 | 2 | claim_mismatch | C3 | family_property | public_law_hcj |
| s3 | 3 | claim_mismatch | C4 | public_law_hcj | public_law_hcj |
| s3 | 4 | claim_mismatch | C5 | public_law_hcj | public_law_hcj |

**Registry authority outcomes**

| authority | role | expected | seeded query | skipped(present) | retrieved | admitted | body | used |
|---|---|---|---|---|---|---|---|---|
| בג"ץ 1000/92 בבלי נ' בית הדין הרבני הגדול | binding_case_law | case | yes | false | true | true | false | false |
| בג"ץ 8638/03 סימה אמיר נ' בית הדין הרבני הגדול | binding_case_law | case | yes | false | true | true | false | true |
| חוק יחסי ממון בין בני זוג, תשל"ג-1973 | primary_statute | statute | — | false | false | false | false | false |
| חוק שיפוט בתי דין רבניים (נישואין וגירושין), תשי"ג-1953 | primary_statute | statute | — | true | true | false | false | false |

**Hebrew limitation notices**

> **מגבלת ביסוס:** חלק מהקביעות שלעיל נותרו ללא מקור בר-ציטוט שאומת ישירות לאותה טענה. מקורות שאותרו בנושא סמוך, מקורות רקע או ספרות פרשנית אינם מצוטטים כאן כאסמכתה ישירה. יש לאמת קביעות אלה מול המקור הראשוני (חקיקה או פסק דין) לפני הסתמכות.

**Full final user-facing answer**

```markdown
תשובה קצרה ומהותית: בית המשפט גבוה לצדק יכול להפעיל ביקורת שיפוטית על החלטות בתי דין רבניים בענייני רכוש בין בני זוג כאשר עולה שאלה מהותית על סמכות בית הדין או על החוקיות של ההליך — כך נקבע בפסק‑דין סימה אמיר.¹

עילות התערבות עיקריות שנידונו בפסיקה הן חוסר סמכות או חריגה מסמכות, הפרת עקרון החוקיות, פגם בפרוצדורה שייראה כהליך בלתי הוגן, ושגיאת דין מהותית או החלטה בלתי סבירה שניתן לזהותה כחריגה ממתחם השיפוט של בית הדין; בבג״ץ סימה אמיר נדונה באופן מרכזי שאלת הסמכות והחוקיות כבסיס לפיקוח שיפוטי.

הטענה שבית הדין החיל דין דתי במקום דין אזרחי נבחנת במישור הסמכותי: בתי הדין הרבניים רשאים להכריע בעניינים הנמצאים בגבולות סמכותם ובהסכמת הצדדים כאשר יש לכך עיגון משפטי, אך סמכות לדון בסכסוכי רכוש שאינה נובעת מפסק‑דין מוסמך או מעיגון חקיקתי מפורש מעוררת בעיות חוקיות — בפסק‑דין סימה אמיר הודגש הצורך בעיגון חקיקתי לסמכויות שאינן ענייני נישואין/גירושין, ומסמך רשומות הכנסת מתעד הסתייגות דומה.

לגבי הסעדים: בפסיקה הוכרה האפשרות להיעתר לבג״ץ בצווים כגון ביטול החלטת בית הדין או צווי ביניים/שימור כדי למנוע פגיעה בלתי הפיכה בזכויות; בית המשפט העליון אף בחן בהליך את אופני המשך הטיפול בסכסוך בין המתדיינים במקום להורות על הכרעה מהותית בהסתמך על סמכותו. ההיקף המדויק של הסעד תלוי בנסיבות ובחומר הראיות שהוגש.

הקריטריונים הפרקטיים שנבחנים בבג״ץ אינם מוצגים במקורות שאותרו כרשימת תנאים ראייתיים מובנית; עם זאת, מן הפסיקה עולה כי בית המשפט יתמקד במסמכים ובנוסח פסק‑הדין/פרוטוקול הדיון שמראים חריגה בסמכות, בהוכחות להיעדר הסכמת הצדדים לנוכחות דין אחר, ובהבהרת השגיאות המשפטיות המיוחסות לבית הדין — דוגמה חשובה היא הביטוי המכריע של בית המשפט ב‑סימה אמיר ביחס לדרישת החוקיות.

מסקנה תכליתית למתדיינים ולנציגיהם: כשמעלים עתירה לבג״ץ נגד פסק דין של בית דין רבני בענייני רכוש — יש למקד את הבקשה בטענות סמכותיות וקונקרטיות (חוסר עיגון בחוק, חריגה מסמכות, ליקויי הליך מהותיים) ולצרף את פסק‑הדין המלא, פרוטוקולי הדיון וכל מסמך המציג את יישום הדין הדתי שהופעל; במקורות שאותרו הדגש הוא על בחינת סמכות וחוקיות ולא על פורמליזם ראייתי ממוסד.
**מקורות שאותרו אך גופם לא נקרא (לעיון בלבד)**

פסקי הדין הבאים אותרו במהלך החיפוש, אך גוף פסק הדין עצמו לא נקרא ולכן לא נגזרה מהם הלכה, יישום או סייג:
- בג"ץ 7339/15 — https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%5C15%5C390%5C073%5Ct06&fileName=15073390.t06&type=4

**מגבלת ביסוס:** חלק מהקביעות שלעיל נותרו ללא מקור בר-ציטוט שאומת ישירות לאותה טענה. מקורות שאותרו בנושא סמוך, מקורות רקע או ספרות פרשנית אינם מצוטטים כאן כאסמכתה ישירה. יש לאמת קביעות אלה מול המקור הראשוני (חקיקה או פסק דין) לפני הסתמכות.
```

**Full rendered source list**

1. בגץ 8638-03 סימה אמיר נ' בית הדין הרבני הגדול.doc — https://www.cwj.org.il/sites/default/files/%D7%91%D7%92%D7%A5%208638-03%20%D7%A1%D7%99%D7%9E%D7%94%20%D7%90%D7%9E%D7%99%D7%A8%20%D7%A0'%20%D7%91%D7%99%D7%AA%20%D7%94%D7%93%D7%99%D7%9F%20%D7%94%D7%A8%D7%91%D7%A0%D7%99%20%D7%94%D7%92%D7%93%D7%95%D7%9C.doc
    - בגץ 8638-03 סימה אמיר נ' בית הדין הרבני הגדול.doc — https://www.cwj.org.il/sites/default/files/%D7%91%D7%92%D7%A5%208638-03%20%D7%A1%D7%99%D7%9E%D7%94%20%D7%90%D7%9E%D7%99%D7%A8%20%D7%A0'%20%D7%91%D7%99%D7%AA%20%D7%94%D7%93%D7%99%D7%9F%20%D7%94%D7%A8%D7%91%D7%A0%D7%99%20%D7%94%D7%92%D7%93%D7%95%D7%9C.doc


---

## Human readthrough checklist (fill manually)

| ID | Grade (Good/Acceptable/Limited/Fail) | Answered the question? | Sources legally relevant? | Primary source when needed? | Any unrelated source? | Topic contamination? | Broken Hebrew / awkward phrasing? | Over-refusal? | Overclaiming? | Main failure pattern |
|---|---|---|---|---|---|---|---|---|---|---|
| D3 |  |  |  |  |  |  |  |  |  |  |
