# canonical_judgment_text_acquisition_v1 — validation run (D1–D6 + controls)

Generated: 2026-08-24T05:49:09.672Z  
Mode: export only — no code, prompt, retrieval, verifier, drafter, label, footnote or gate changes. Questions executed sequentially.

## Overview

| ID | Topic | Runtime | Terminal status | Branch | Footnotes | Dangling | Orphan rows | Metadata-only holdings | Interruption |
|---|---|---|---|---|---|---|---|---|---|
| D1 | מידתיות / ביקורת חוקתית | 212s | done | — | 2 | 0 | 0 | — | none |
| D3 | בג״ץ ובית דין רבני / רכוש | 231s | done | — | 0 | 0 | 0 | — | none |
| R02 | control — exact body (בנק המזרחי) | 161s | done | docket_limitation | 0 | 0 | 0 | — | none |
| P02 | control — fake docket | 121s | done | docket_limitation | 0 | 0 | 0 | — | none |
| B8 | control — canonical quote | 81s | done | canonical_quote_registry | 1 | 0 | 0 | — | none |


---

## D1 — מידתיות / ביקורת חוקתית

**Query**

> מהם מבחני המידתיות בביקורת חוקתית בישראל, וכיצד הם מיושמים כאשר חוק פוגע בזכות יסוד?

| Field | Value |
|---|---|
| Runtime | 212s |
| Terminal status | done |
| Branch | — |
| Footnote count | 2 |
| Inline markers | 2 |
| Dangling markers | 0 |
| Orphan source rows | 0 |
| used_sources | 2 |
| Metadata-only holdings | — |
| CSM applied | true |
| CSM source_ref_mismatch_count | 6 |
| CSM unsupported_block_count | 3 |
| CSM commentary_only_claims | [] |
| CSM primary_support_by_main_claim | true |
| Canonical acquisition | {"ms":3,"enabled":true,"version":"canonical_judgment_text_acquisition_v1","attempts":[],"doctrine_id":"proportionality","skip_reason":"docket_cap_zero","attempted_count":0,"body_acquired_count":0,"type4_derived_count":0,"eligible_authorities":["hcj_6821_93_mizrahi","hcj_1715_97_investment_managers"],"skipped_not_derivable":[],"injected_candidate_ids":[],"metadata_only_holdings":0,"blocked_by_origin_count":0,"type4_body_acquired_count":0,"type4_probe_reached_count":0,"bodyless_judgment_citations":0,"skipped_already_body_acquired":[],"citations_without_body_acquired":0} |
| Registry triggered | true |
| Registry doctrine_id | proportionality |
| Registry matched_facet | F1 |
| Registry queries added | 0 — [] |
| Registry skipped (already present) | ["basic_law_dignity_s8"] |
| Statute-title normalisation | {"applied":false,"rewrites":[],"rewritten_count":0} |
| Support distribution | {"direct":2,"partial":4,"unrelated":13,"tangential":4} |
| Candidates (listing / metadata-only) | 0 (0 / 0) |
| Retrieval interruption / CPU / stale worker | none |
| Job error | none |

**Dropped source refs**

| ref | block | reason | block claim | block area | source area |
|---|---|---|---|---|---|
| s2 | 1 | claim_mismatch | C2 | constitutional | constitutional |
| s3 | 1 | claim_mismatch | C2 | constitutional | constitutional |
| s5 | 2 | commentary_in_substantive_block | C1 | constitutional | constitutional |
| s3 | 4 | claim_mismatch | C3 | constitutional | constitutional |
| s4 | 4 | claim_mismatch | C3 | constitutional | constitutional |
| s1 | 5 | claim_mismatch | C4 | constitutional | constitutional |

**Registry authority outcomes**

| authority | role | expected | seeded query | skipped(present) | retrieved | admitted | body | used |
|---|---|---|---|---|---|---|---|---|
| חוק-יסוד: כבוד האדם וחירותו, סעיף 8 (פסקת ההגבלה) | primary_statute | statute | — | true | true | true | false | true |
| בג"ץ 6821/93 בנק המזרחי המאוחד נ' מגדל כפר שיתופי | binding_case_law | case | — | false | false | false | false | false |
| בג"ץ 1715/97 לשכת מנהלי ההשקעות נ' שר האוצר | binding_case_law | case | — | false | false | false | false | false |

**Hebrew limitation notices**

> **מגבלת ביסוס:** חלק מהקביעות שלעיל נותרו ללא מקור בר-ציטוט שאומת ישירות לאותה טענה. מקורות שאותרו בנושא סמוך, מקורות רקע או ספרות פרשנית אינם מצוטטים כאן כאסמכתה ישירה. יש לאמת קביעות אלה מול המקור הראשוני (חקיקה או פסק דין) לפני הסתמכות.

**Full final user-facing answer**

```markdown
העיקר: מבחן המידתיות במשפט הישראלי מבוסס על פסקאות ההגבלה שבחוקי היסוד — בעיקר סעיף ההגבלה שבחוק יסוד: כבוד האדם וחירותו — הקובע שניתן להגביל זכות רק לחוק ההולם את ערכיה של המדינה, לתכלית ראויה ובמידה שאינה עולה על הנדרש; חוק יסוד: חופש העיסוק מקביל באופיו וכולל גם מנגנון של פסקת התגברות עבור חקיקה מיוחדת.¹

יסודות מבחן המידתיות: שלושה רכיבים תודעתיים מרכזיים מופיעים בנוסחי חוקי היסוד ומשמשים כבסיס לבחינה חוקתית של הגבלות זכויות — תכלית ראויה (התכלית העומדת בבסיס ההגבלה), התאמה/קשר סיבתי בין האמצעים לתכלית (הגבלה שאינה שרירותית וכי היא מקודמת על ידי האמצעים), ומידתיות בצמצום (העיקרון שההגבלה תהיה פחותה ככל הניתן ותיאוזן מול חירות הפרט). נוסח סעיף ההגבלה מדגיש במיוחד את דרישת "מידה שאינה עולה על הנדרש" כאבן יסוד.

מנגנון ההתגברות בחופש העיסוק: חוק יסוד: חופש העיסוק קובע פסקת התגברות המאפשרת לחקיקה שנקבעה ברוב הכנסת להיות תקפה אף אם אינה עומדת בתנאי פסקת ההגבלה, אך קובע מגבלות טכניות־זמניות (מועד פקיעה ארבע שנים אלא אם נקבע אחרת). הוראה זו יוצרת מסגרת חוקתית של חריג מסודר לכללי המידתיות הרגילים.²

היעדר סקירת פסיקה מובאת כאן: בסיס הסמכות לתשובה זו היה חקיקה ותקנות בלבד — לא אותרו לפאתי חיפוש זה פסקי דין ברי־שימוש המספקים הלכה מחייבת על אופן יישום מבחן המידתיות; משום כך לא מוצגת כאן סקירת פסיקה מחייבת או נוסח הלכה שיפוטית.

יישום וסייגים מעשיים על בסיס החקיקה בלבד: מן הנוסחים בחוקי היסוד ניתן להסיק בזהירות כי מבחן המידתיות מספק מסגרת כללית אך אינו מפרט רמות בדיקה שונות לפי תחום עניין; מסמכי רקע על פסקאות ההגבלה מציינים שניתן לשקול חומרת הפגיעה והאינטרסים הנוגדים בעת בחינת המידתיות, אך התשובה המעשית על אינטנסיביות הבדיקה תלויה בפסיקה שאינה מוצגת כאן.

השלכות וסעד על בסיס החקיקה שסופקה: חוקי היסוד עצמם מספקים מסגרת חומרתית ופשרנות פרוצדוראליות (למשל פסקת ההתגברות והמועד הקבוע בה), אך אינם מפרטים באופן מפורש אילו סעדי בית המשפט יינתנו במקרה של חקיקה שאינה עומדת במבחן; על כך נדרשת התערבות שיפוטית שאינה מתועדת בחומרים שסופקו.

נטל הראיה ופגיעה בליבת הזכות: במקורות החוקתיים שסופקו לא נמצא הקצאה מפורשת של נטל הראיה או נוסח מיוחד למקרים של פגיעה קשה בליבת זכות; לכן, על בסיס החומרים שהוצגו כאן בלבד, לא ניתן לקבוע כללים מחייבים בעניין זה. הערת דלילות מקורות ותיחום: הטקסט התומך שנמצא קצר ואינו כולל נוסח הלכות שיפוטיות מלא — יתכן שקיימת פסיקה או מקורות משלימים שלא אותרו בחיפוש זה ולכן התשובות המתבססות על החקיקה בלבד הן במידה זו מוגבלות.

**מגבלת ביסוס:** חלק מהקביעות שלעיל נותרו ללא מקור בר-ציטוט שאומת ישירות לאותה טענה. מקורות שאותרו בנושא סמוך, מקורות רקע או ספרות פרשנית אינם מצוטטים כאן כאסמכתה ישירה. יש לאמת קביעות אלה מול המקור הראשוני (חקיקה או פסק דין) לפני הסתמכות.

> החיפוש הופסק עקב מגבלת זמן, ולכן ייתכן שלא אותרו כל המקורות הרלוונטיים.
```

**Full rendered source list**

1. חוק יסוד: כבוד האדם וחירותו (סעיף 8); חוק יסוד: חופש העיסוק — נוסח מלא (סעיפים 6–8) — https://m.knesset.gov.il/Activity/Legislation/Documents/yesod3.pdf
    - חוק יסוד: כבוד האדם וחירותו (סעיף 8) — https://m.knesset.gov.il/Activity/Legislation/Documents/yesod3.pdf
    - חוק יסוד: חופש העיסוק — נוסח מלא (סעיפים 6–8) — https://fs.knesset.gov.il/13/law/13_ls1_565945.pdf
2. חוק יסוד: חופש העיסוק — נוסח מלא (סעיפים 6–8) — https://fs.knesset.gov.il/13/law/13_ls1_565945.pdf
    - חוק יסוד: חופש העיסוק — נוסח מלא (סעיפים 6–8) — https://fs.knesset.gov.il/13/law/13_ls1_565945.pdf


---

## D3 — בג״ץ ובית דין רבני / רכוש

**Query**

> מתי בג״ץ יתערב בהחלטה של בית דין רבני בענייני רכוש בין בני זוג, במיוחד כאשר נטען שבית הדין החיל דין דתי במקום דין אזרחי?

| Field | Value |
|---|---|
| Runtime | 231s |
| Terminal status | done |
| Branch | — |
| Footnote count | 0 |
| Inline markers | 0 |
| Dangling markers | 0 |
| Orphan source rows | 0 |
| used_sources | 0 |
| Metadata-only holdings | — |
| CSM applied | true |
| CSM source_ref_mismatch_count | 4 |
| CSM unsupported_block_count | 3 |
| CSM commentary_only_claims | [] |
| CSM primary_support_by_main_claim | false |
| Canonical acquisition | {"ms":4,"enabled":true,"version":"canonical_judgment_text_acquisition_v1","attempts":[],"doctrine_id":"rabbinical_civil_property","skip_reason":"docket_cap_zero","attempted_count":0,"body_acquired_count":0,"type4_derived_count":0,"eligible_authorities":["hcj_1000_92_bavli","hcj_8638_03_sima_amir"],"skipped_not_derivable":[],"injected_candidate_ids":[],"metadata_only_holdings":0,"blocked_by_origin_count":0,"type4_body_acquired_count":0,"type4_probe_reached_count":0,"bodyless_judgment_citations":0,"skipped_already_body_acquired":[],"citations_without_body_acquired":0} |
| Registry triggered | true |
| Registry doctrine_id | rabbinical_civil_property |
| Registry matched_facet | — |
| Registry queries added | 0 — [] |
| Registry skipped (already present) | ["law_rabbinical_jurisdiction"] |
| Statute-title normalisation | {"applied":true,"rewrites":[{"after":"חוק שיפוט בתי דין רבניים (נישואין וגירושין), תשי\"ג-1953 (נישואין וגירושין), תשי\"ג-1953 סמכויות בתי דין רבניים לדון בסכסוכי רכוש בין בני זוג סמכות עניינית","before":"חוק בתי הדין הרבניים (נישואין וגירושין), תשי\"ג-1953 סמכויות בתי דין רבניים לדון בסכסוכי רכוש בין בני זוג סמכות עניינית"},{"after":"חוק שיפוט בתי דין רבניים (נישואין וגירושין), תשי\"ג-1953 (נישואין וגירושין), תשי\"ג-1953 הוראות על ערעור, ביטול ופיקוח שיפוטי על פסקי דין רבניים","before":"חוק בתי הדין הרבניים (נישואין וגירושין), תשי\"ג-1953 הוראות על ערעור, ביטול ופיקוח שיפוטי על פסקי דין רבניים"},{"after":"חוק שיפוט בתי דין רבניים (נישואין וגירושין), תשי\"ג-1953 (נישואין וגירושין), תשי\"ג-1953 פרשנות דין דתי במקום דין אזרחי סמכויות וגבולות","before":"חוק בתי הדין הרבניים (נישואין וגירושין), תשי\"ג-1953 פרשנות דין דתי במקום דין אזרחי סמכויות וגבולות"}],"rewritten_count":3} |
| Support distribution | {"unrelated":12,"partial":3,"direct":2,"tangential":4} |
| Candidates (listing / metadata-only) | 0 (0 / 0) |
| Retrieval interruption / CPU / stale worker | none |
| Job error | none |

**Dropped source refs**

| ref | block | reason | block claim | block area | source area |
|---|---|---|---|---|---|
| s4 | 0 | claim_mismatch | C2 | public_law_hcj | public_law_hcj |
| s4 | 1 | unrelated_legal_area | C1 | family_property | public_law_hcj |
| s3 | 1 | unrelated_legal_area | C1 | family_property | public_law_hcj |
| s3 | 2 | claim_mismatch | C3 | public_law_hcj | public_law_hcj |

**Registry authority outcomes**

| authority | role | expected | seeded query | skipped(present) | retrieved | admitted | body | used |
|---|---|---|---|---|---|---|---|---|
| בג"ץ 1000/92 בבלי נ' בית הדין הרבני הגדול | binding_case_law | case | — | false | true | false | false | false |
| בג"ץ 8638/03 סימה אמיר נ' בית הדין הרבני הגדול | binding_case_law | case | — | false | false | false | false | false |
| חוק יחסי ממון בין בני זוג, תשל"ג-1973 | primary_statute | statute | — | false | false | false | false | false |
| חוק שיפוט בתי דין רבניים (נישואין וגירושין), תשי"ג-1953 | primary_statute | statute | — | true | true | false | false | false |

**Hebrew limitation notices**

> **מגבלת ביסוס:** חלק מהקביעות שלעיל נותרו ללא מקור בר-ציטוט שאומת ישירות לאותה טענה. מקורות שאותרו בנושא סמוך, מקורות רקע או ספרות פרשנית אינם מצוטטים כאן כאסמכתה ישירה. יש לאמת קביעות אלה מול המקור הראשוני (חקיקה או פסק דין) לפני הסתמכות.

**Full final user-facing answer**

```markdown
בשורה התחתונה: בג"ץ יתערב בהחלטת בית דין רבני בענייני רכוש בין בני זוג כאשר קיימת חריגה מסמכות של בית הדין — ובפרט כאשר החלטת בית הדין סותרת פסק דין של בית משפט, או כאשר סדרי סמכויות משתבשים באופן המעניק החלטה על סמכות שלא הייתה לו.

מתי יש לבית הדין הרבני סמכות לדון בסכסוכי רכוש של בני זוג: על פי פסיקה, כאשר ענייני ממון הם חלק מהבקשה לגירושין או כרוכים בה, הדבר מעניק לבית הדין הרבני סמכות עניינית לדון בהם; יחד עם זאת קיימים כללי "מרוץ סמכויות" הקובעים מתי בית המשפט לענייני משפחה יקדימו לדון בעניינים אלה או יפנה לבית הדין הדתי לפי הנסיבות והדין הראוי.

כיצד לפרש את הטענה שבית הדין "חיל דין דתי במקום דין אזרחי": טענה זו עלולה להצדיק התערבות רק אם היא מממשת אחת העילות המקובלות לביקורת שיפוטית — למשל כאשר היישום ההלכתי מביא לתוצאה הסותרת פסק דין אזרחי מחייב או כאשר בכך חורגת הערכאה מדפקה סמכותה; הקביעה היא עניין עובדתי־משפטי שמחייב בחינה של ההכרעה, הקונטקסט וסמכות ההכרעה.

עילות בהתערבות — דגשים דוקטרינריים: מה שנמצא בבסיס ההתערבות בפסיקה המפורטת הוא חריגה מסמכות, ובפרט סתירה כלפי הכרעה של בית משפט; לגבי טענות נוספות שנזכרות בדיונים אזרחיים־מנהליים (ליקויי הליכים מהותיים, משקל ראיות שגוי, טעות משפטית מהותית) — במקורות שאותרו הדגש הורד על חריגה מסמכות כעילה ברורה להתערבות.

סעדים שבג"ץ עשוי להורות אם ימצא התערבות מוצדקת: לפי הפסיקה שניתן להיעזר בה כנקודת ייחוס, בג"ץ יכול לחייב ביטול פסק־דין של בית הדין הרבני או להשיב את העניין להכרעה חוזרת על פי הנחיות שיפוטיות; לגבי צווים ספציפיים אחרים (צו מניעה, פיצוי כספי וכדומה) לא נמצא בתמצית החומר שסופק עיגון מפורש, ולכן יש להציג בקשה מפורטת בהתאם לנסיבות המקרה.

הוכחות ומסמכים פרקטיים שכדאי לצרף בעת הגשת עתירה או בקשה להתערבות: במקורות שאותרו לא נמצא פירוט פורמלי של "מארז" ראיות סטנדרטי, אך בהנחיה מעשית ראוי לכלול: העתק מלא של פסק־דין בית הדין הרבני (והעתקות של פסקי דין אזרחיים רלוונטיים), פרוטוקול הדיון בבית הדין, כתבי טענות שהוגשו, הסכמות או וידויים בעניין סמכות פורום, וכל מסמך המצביע על סתירה בין ההכרעות או על חריגה בסמכות — כדי לאפשר לבג"ץ בחינה עובדתית־משפטית של הטענות.
**מקורות שאותרו אך גופם לא נקרא (לעיון בלבד)**

פסקי הדין הבאים אותרו במהלך החיפוש, אך גוף פסק הדין עצמו לא נקרא ולכן לא נגזרה מהם הלכה, יישום או סייג:
- בג"ץ 5042/13 פלונית נגד בית הדין הרבני הגדול ואח' — https://www.toledano.co.il/%D7%91%D7%92%D7%A5-5042-13-%D7%A4%D7%9C%D7%95%D7%A0%D7%99%D7%AA-%D7%A0%D7%92%D7%93-%D7%91%D7%99%D7%AA-%D7%94%D7%93%D7%99%D7%9F-%D7%94%D7%A8%D7%91%D7%A0%D7%99-%D7%94%D7%92%D7%93%D7%95%D7%9C-%D7%95/

**מגבלת ביסוס:** חלק מהקביעות שלעיל נותרו ללא מקור בר-ציטוט שאומת ישירות לאותה טענה. מקורות שאותרו בנושא סמוך, מקורות רקע או ספרות פרשנית אינם מצוטטים כאן כאסמכתה ישירה. יש לאמת קביעות אלה מול המקור הראשוני (חקיקה או פסק דין) לפני הסתמכות.
```

**Full rendered source list**

_(אין מקורות מצוטטים)_


---

## R02 — control — exact body (בנק המזרחי)

**Query**

> מה נקבע בע"א 6821/93 בנק המזרחי המאוחד נ' מגדל כפר שיתופי?

| Field | Value |
|---|---|
| Runtime | 161s |
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
| Canonical acquisition | {"ms":3,"enabled":true,"version":"canonical_judgment_text_acquisition_v1","attempts":[],"doctrine_id":"proportionality","skip_reason":"docket_cap_zero","attempted_count":0,"body_acquired_count":0,"type4_derived_count":0,"eligible_authorities":["hcj_6821_93_mizrahi","hcj_1715_97_investment_managers"],"skipped_not_derivable":[],"injected_candidate_ids":[],"metadata_only_holdings":0,"blocked_by_origin_count":0,"type4_body_acquired_count":0,"type4_probe_reached_count":0,"bodyless_judgment_citations":0,"skipped_already_body_acquired":[],"citations_without_body_acquired":0} |
| Registry triggered | true |
| Registry doctrine_id | proportionality |
| Registry matched_facet | — |
| Registry queries added | 0 — [] |
| Registry skipped (already present) | ["basic_law_dignity_s8","hcj_6821_93_mizrahi"] |
| Statute-title normalisation | {"applied":false,"rewrites":[],"rewritten_count":0} |
| Support distribution | {"partial":12,"unrelated":9,"tangential":3} |
| Candidates (listing / metadata-only) | 0 (0 / 0) |
| Retrieval interruption / CPU / stale worker | none |
| Job error | none |

**Registry authority outcomes**

| authority | role | expected | seeded query | skipped(present) | retrieved | admitted | body | used |
|---|---|---|---|---|---|---|---|---|
| חוק-יסוד: כבוד האדם וחירותו, סעיף 8 (פסקת ההגבלה) | primary_statute | statute | — | true | true | true | false | false |
| בג"ץ 6821/93 בנק המזרחי המאוחד נ' מגדל כפר שיתופי | binding_case_law | case | — | true | true | true | false | false |
| בג"ץ 1715/97 לשכת מנהלי ההשקעות נ' שר האוצר | binding_case_law | case | — | false | false | false | false | false |

**Hebrew limitation notices**

_none_

**Full final user-facing answer**

```markdown
לא אותר במקורות הזמינים ע"א 6821/93. לכן לא ניתן לקבוע באופן מוסמך מה נקבע בו, מה היו הנימוקים או מה הייתה תוצאת ההליך. אין להשיב מתיקים דומים, ממקורות רקע או מספרות משנית.

אם יש לך את פסק הדין בקובץ PDF/DOCX או צילום, אפשר להעלות אותו כאן, ואנתח מתוכו את ההחזקה, הנימוקים המרכזיים, העובדות הרלוונטיות והמשמעות המשפטית.
```

**Full rendered source list**

_(אין מקורות מצוטטים)_


---

## P02 — control — fake docket

**Query**

> מה נקבע בע"א 99887-04-22 לוי נ' מדינת ישראל?

| Field | Value |
|---|---|
| Runtime | 121s |
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
| Canonical acquisition | {"ms":0,"enabled":false,"version":"canonical_judgment_text_acquisition_v1","attempts":[],"doctrine_id":null,"skip_reason":"registry_not_triggered","attempted_count":0,"body_acquired_count":0,"type4_derived_count":0,"eligible_authorities":[],"skipped_not_derivable":[],"injected_candidate_ids":[],"metadata_only_holdings":0,"blocked_by_origin_count":0,"type4_body_acquired_count":0,"type4_probe_reached_count":0,"bodyless_judgment_citations":0,"skipped_already_body_acquired":[],"citations_without_body_acquired":0} |
| Registry triggered | false |
| Registry doctrine_id | — |
| Registry matched_facet | — |
| Registry queries added | 0 — [] |
| Registry skipped (already present) | [] |
| Statute-title normalisation | {"applied":false,"rewrites":[],"rewritten_count":0} |
| Support distribution | {"unrelated":22,"tangential":3} |
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
| Canonical acquisition | {"ms":0,"enabled":false,"version":"canonical_judgment_text_acquisition_v1","attempts":[],"doctrine_id":null,"skip_reason":"registry_not_triggered","attempted_count":0,"body_acquired_count":0,"type4_derived_count":0,"eligible_authorities":[],"skipped_not_derivable":[],"injected_candidate_ids":[],"metadata_only_holdings":0,"blocked_by_origin_count":0,"type4_body_acquired_count":0,"type4_probe_reached_count":0,"bodyless_judgment_citations":0,"skipped_already_body_acquired":[],"citations_without_body_acquired":1} |
| Registry triggered | false |
| Registry doctrine_id | — |
| Registry matched_facet | — |
| Registry queries added | 0 — [] |
| Registry skipped (already present) | [] |
| Statute-title normalisation | {"applied":false,"rewrites":[],"rewritten_count":0} |
| Support distribution | {"direct":1,"partial":7,"unrelated":7} |
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

## Human readthrough checklist (fill manually)

| ID | Grade (Good/Acceptable/Limited/Fail) | Answered the question? | Sources legally relevant? | Primary source when needed? | Any unrelated source? | Topic contamination? | Broken Hebrew / awkward phrasing? | Over-refusal? | Overclaiming? | Main failure pattern |
|---|---|---|---|---|---|---|---|---|---|---|
| D1 |  |  |  |  |  |  |  |  |  |  |
| D3 |  |  |  |  |  |  |  |  |  |  |
| R02 |  |  |  |  |  |  |  |  |  |  |
| P02 |  |  |  |  |  |  |  |  |  |  |
| B8 |  |  |  |  |  |  |  |  |  |  |
