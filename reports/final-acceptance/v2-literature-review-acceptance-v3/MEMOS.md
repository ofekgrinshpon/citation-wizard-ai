<!-- Export of existing Acceptance #3 run artifacts. No product code changed; no run re-executed. Fields absent from the stored artifact are marked `NOT PERSISTED IN RUN ARTIFACT`. -->

# Acceptance #3 — Research Memos (as accepted, pre-verification)

Reconstructed deterministically from the stored per-memo-claim verification
forensics rows (`telemetry.verification_forensics`), which record every memo
claim and every evidence pair submitted by the Research Agent before
verification. `research_complete` and the memo-level `research_synthesis`
object are not stored verbatim in the run row (NOT PERSISTED IN RUN ARTIFACT); only their shapes
(section / source-role / relationship counts) were persisted. No private model
reasoning is included.

---

# L1 — `eafb395e-dfbc-4910-ba0d-087b9eba9d95`

## issue_summary

סקירת ספרות על עילת הסבירות במשפט הישראלי מחייבת מיפוי היסטורי ודוקטרינרי, הצגה מיוחסת של גישות בספרות, והבחנה בין הוויכוח המינהלי לבין הוויכוח החוקתי שהתחדד סביב פסק הדין בעניין תיקון מס' 3. על סמך הקטעים המילוליים המאומתים שנותרו, ניתן לבסס רק את מיפוי מוקדי השיח העכשווי ואת ההקשר של השירות הציבורי; אין תשתית ציטוטית מספקת לסקירת הגישות המרכזיות או להתפתחותן לאורך השנים.

## memo claims (4)

### C1 — importance: supporting — outcome: verified

**proposition:** בחומר העיוני העכשווי על פסק דין הסבירות מובחנים לפחות שני מוקדי דיון: עצם עילת חוסר הסבירות הקיצונית והשירות הציבורי ועילת אי-הסבירות.

- evidence 1: source `S7` · locator: — · body_read: ok · identity: ok · span: ok · support: supports
  - reason: accepted by support verifier
  - quoted span:

```
שער ראשון: על עילת הסבירות
האם שלום לעילת חוסר הסבירות הקיצוני?
31 מרדכי קרמניצר
השירות הציבורי ועילת אי־הסבירות
39 עדנה הראל פישר
```

### C2 — importance: supporting — outcome: verified

**proposition:** הדיון העכשווי בעילה כרוך גם בוויכוח חוקתי-מוסדי על התערבות שיפוטית בחוקי יסוד ועל רף ההתערבות בסמכות המכוננת, ולא רק בהפעלת העילה במשפט המינהלי השוטף.

- evidence 1: source `S7` · locator: — · body_read: ok · identity: ok · span: ok · support: supports
  - reason: accepted by support verifier
  - quoted span:

```
מבחנים ומאפיינים - שער שני: התערבות בג"ץ בחוקי יסוד
על רף ההתערבות בסמכות המכוננת
65 סוזי נבות
הנמכת רף הביקורת השיפוטית על חוקי יסוד בפסק דין הסבירות
71 גיל גן־מור
```

### C3 — importance: supporting — outcome: verified

**proposition:** ביישום של סבירות בהקשר של מינויים ציבוריים, המקור המשני שנקרא מציג את חובת הנאמנות הציבורית כמקור לחובה להפעיל שיקול דעת בהגינות, ביושר, בסבירות וללא הפליה.

- evidence 1: source `S3` · locator: — · body_read: ok · identity: ok · span: ok · support: supports
  - reason: accepted by support verifier
  - quoted span:

```
מחובת הנאמנות נגזרת החובה להפעיל את שיקול הדעת השלטונית בהגינות, ביושר, בסבירות וללא הפליה, נכתב בפסק הדין.
```

### C4 — importance: supporting — outcome: verified

**proposition:** אותו מקור מתאר שימוש ברף של "בלתי סבירה באופן קיצוני" לבחינת מינוי למשרה בכירה בשירות הציבורי, כאשר לעבירות המועמד השלכה על עשיית משפט צדק.

- evidence 1: source `S3` · locator: — · body_read: ok · identity: ok · span: ok · support: supports
  - reason: accepted by support verifier
  - quoted span:

```
מי שבעבירותיו פגע באושיות המבנה החברתי וביכולתן של ערכאות שיפוטיות או מעין שיפוטיות לעשות משפט צדק, מינויו למשרה בכירה בשירות הציבור הינו פעולה בלתי סבירה באופן קיצוני.
```

## repaired memo claims (3)

- C1 (core, verified) · source `S7`
  - proposition: בקובץ העיונים העכשווי בעקבות פסק הדין בעניין ביטול עילת הסבירות, שער נפרד מוקדש לעילה ובו מאמרים נפרדים מאת מרדכי קרמניצר על חוסר הסבירות הקיצוני ומאת עדנה הראל פישר על השירות הציבורי ועילת אי-הסבירות.
  - quoted span:

```
שער ראשון: על עילת הסבירות
האם שלום לעילת חוסר הסבירות הקיצוני?
31 מרדכי קרמניצר
השירות הציבורי ועילת אי־הסבירות
39 עדנה הראל פישר
```

- C2 (supporting, verified) · source `S7`
  - proposition: הדיון העכשווי בעילת הסבירות כרוך גם בעיון בעמדות השופטים בפסק הדין בעניין ביטול העילה, כפי שמשתקף במבנה קובץ העיונים.
  - quoted span:

```
ניתוח עמדות שופטי ושופטות בג"ץ בפסק הדין בעניין ביטול עילת הסבירות —
טבלה מסכמת
14 מורן קנדלשטיין־היינה, נדב דגן, ספיר פז, דפני בנבניסטי
```

- C3 (supporting, verified) · source `S3`
  - proposition: במקור המשני שנקרא המתאר את פרשת אייזנברג, מתוארת הפעלת סבירות בהקשר של מינוי למשרה בכירה בשירות הציבור, באמצעות הרף של פעולה בלתי סבירה באופן קיצוני.
  - quoted span:

```
מי שבעבירותיו פגע באושיות המבנה החברתי וביכולתן של ערכאות שיפוטיות או מעין שיפוטיות לעשות משפט צדק, מינויו למשרה בכירה בשירות הציבור הינו פעולה בלתי סבירה באופן קיצוני.
```

## unresolved_questions

- לא עלה בידי להשיג במסגרת הסבב קטעים מילוליים מאומתים המאפשרים להציג, בשם מחבריהם, את הגישות המרכזיות בספרות בעד העילה, נגד העילה, או גישות ביניים המצמצמות את הפעלתה.
- לא ניתן לבסס מן הקטעים שנותרו ציר היסטורי מלא: דפי זהב, התפתחויות מאוחרות יותר, והאופן המדויק שבו הספרות תיארה הרחבה, צמצום או שינוי של העילה.
- לצורך תשובה מלאה נדרשת קריאה ממוקדת נוספת של המאמרים עצמם ושל פסקי הדין דפי זהב ובג"ץ 5658/23, תוך הפקת ציטוטים מדויקים בדבר המבחן, הביקורת וההכרעות. אין להסיק מן הכותרות שבקובץ את תוכן עמדות המחברים.
- S3 הוא מקור משני של משרד עורכי דין ולא גוף פסק הדין; לכן C3 מתאים רק להמחשת ההקשר המתואר במקור, ולא כבסיס בלעדי לקביעה דוקטרינרית על הלכת אייזנברג.

## research_complete

NOT PERSISTED IN RUN ARTIFACT

## research_synthesis (memo)

- sections: 2
- source_roles: 2
- relationships: 0
- section headings / role assignments / relationship bodies: NOT PERSISTED IN RUN ARTIFACT

---

# L2 — `ac4b43d6-d531-4303-9000-f4b236791071`

## issue_summary

השלמת הפער שנותר: יש ראיה מילולית לכך שדפנה ברק־ארז מתארת את הדוקטרינות המנהליות כרכיבים שהתפתחו מצידוקים מגוונים, וקובעת שלא תמיד ברור הקשר הפנימי ביניהן. הדבר מבסס את הטענה שהספרות אינה מניחה בסיס עיוני אחיד להבטחה מינהלית, הסתמכות וציפייה לגיטימית.

## memo claims (6)

### C1 — importance: core — outcome: partially_supported

**proposition:** דפנה ברק־ארז מציגה את הגנת ההסתמכות במשפט המנהלי כשאלה נורמטיבית, ומזהה צידוקים מסוג צדק, יעילות והגנה על זכויות האזרח מפני עוצמת השלטון. מכאן שממד מרכזי של הוויכוח המחקרי הוא מהו הבסיס הנורמטיבי הראוי להגנה על ציפייה או הסתמכות שנולדה מפעולת המינהל.

- evidence 1: source `S3` · locator: — · body_read: ok · identity: ok · span: ok · support: supports_partially
  - reason: accepted by support verifier
  - quoted span:

```
ע ל והן צ ד ק שיקולי ע ל הן יעילות, שיקולי ע ל הן מ ב ו ס ס י ם א ל ה צידוקים ה מ נ ה ל י .
היעילות, מ ה י ב ט ה ש ל ט ו נ י ת . ה ע ו צ מ ה מ פ נ י ה א ז ר ח זכויות ה ג נ ת
```

### C2 — importance: core — outcome: rejected

**proposition:** הספרות עצמה מצביעה על קושי שיטתי: דוקטרינות מנהליות התפתחו מצידוקים מגוונים ולא תמיד ברור אם יש ביניהן קשר פנימי; לכן אין להניח מראש שהבטחה מינהלית, הסתמכות וציפייה לגיטימית נשענות כולן על צידוק אחיד.

- evidence 1: source `S3` · locator: — · body_read: ok · identity: ok · span: failed · support: not_reached · rejection: span_not_found
  - reason: span not present in the fetched body
  - quoted span:

```
הן נובעות
ד ב ר ה ן ה ת פ ת ח ו ב פ ס י ק ה כ מ ע נה ל מ צ י א ו ת ה מ נ ה ל י ת ש ל ה מ ד י נ ה ה מ ו ד ר נ י ת
שונים ו מ צידוקים מגוונים, ו ל א ת מ י ד ברור ה א ם קיים ק ש ר פ נ י מ י ביניהן
```

### C3 — importance: supporting — outcome: partially_supported

**proposition:** גישה אחת בספרות עוסקת בהגנת ההסתמכות כמסגרת רחבה במשפט המנהלי, תוך בחינת יישומיה ביחס לענפי המשפט הפרטי; היא אינה מצטמצמת אפוא לשאלת תוקפה של הבטחה פורמלית בלבד.

- evidence 1: source `S3` · locator: — · body_read: ok · identity: ok · span: ok · support: supports_partially
  - reason: accepted by support verifier
  - quoted span:

```
הטענה, ע ו מ דת ה מ א מ ר ש ל ב מ ר כ ז ו
ע ל ל ה נ נ ה ה נורמטיביים הצידוקים נבחנים הדברים בפתח מוגנת. להיות צריכה
דיני־הנזיקין הפרטי ) דיני־החוזים, המשפט כענפים השונים של ויישומיהם
```

### C4 — importance: core — outcome: verified

**proposition:** שרון ידין מציגה במפורש שאלה סיווגית: הבטחה מינהלית וחוזה רגולטורי כ'דוקטרינות חלופיות ולא משלימות'; בהתאם, מחלוקת אפשרית ומרכזית היא אם להסדיר ציפיות שנוצרו ביחסי מינהל-פרט באמצעות דוקטרינת ההבטחה או באמצעות מסגרת חוזית-רגולטורית.

- evidence 1: source `S5` · locator: — · body_read: ok · identity: ok · span: ok · support: supports
  - reason: accepted by support verifier
  - quoted span:

```
כריש, תין ולווייתן: על הבטחות מהליות, חוזים
רגולטוריים וחיות אחרות במתווה הגז הטבעי
שרון ידין *
תקציר ♦ מבוא ♦ א . חוזה רגולטורי והבטחה מהלית כדוקטריות חלופיות ולא
משלימות
```

### C5 — importance: core — outcome: verified

**proposition:** ביחס להבטחה מינהלית עצמה קיימת בספרות עמדה מגוננת המבקשת לשמר את הלכת סאי־טקס: מאמר המוקדש ל'אחריתה' של ההבטחה מתאר את 'ניסיון לסיכול' המוסד ומצהיר כמסקנה על אימוץ ההלכה 'ככתבה וכלשונה'.

- evidence 1: source `S4` · locator: — · body_read: ok · identity: ok · span: ok · support: supports
  - reason: accepted by support verifier
  - quoted span:

```
התגלית: ניסיון לסיכול מוסד ההבטחה המנהלית. א.
השאלה המנחה: ה״צידוק״ הוא זה או ״התנקשות״ בהלכה ? ב.
המסקנה: אימוץ הלכת סאי־טקם ככתבה וכלשונה!
```

### C6 — importance: supporting — outcome: verified

**proposition:** יונתן ברוורמן מציב מדיניות עקבית והבטחה כמכשירים נפרדים היוצרים ציפיות אצל אזרחים. מכאן שגישה מחקרית נוספת מחייבת להבחין בין מקור הציפייה—מדיניות כללית לעומת הבטחה—לפני קביעת היקף הביקורת וההגנה.

- evidence 1: source `S6` · locator: — · body_read: ok · identity: ok · span: ok · support: supports
  - reason: accepted by support verifier
  - quoted span:

```
במשפט המנהלי מקובל להבחין בין שני מכשירים עיקריים הנוגעים בציפיות שנוצרות לאזרחים מפעולות המִנהל – האחד הוא המדיניות, והאחר הוא ההבטחה ה
```

## repaired memo claims (6)

- C1 (core, verified) · source `S3`
  - proposition: דפנה ברק־ארז מציגה את הגנת ההסתמכות במשפט המנהלי כשאלה נורמטיבית, ומזהה צידוקים מסוג צדק, יעילות והגנה על זכויות האזרח מפני עוצמת השלטון. מכאן שממד מרכזי של הוויכוח המחקרי הוא מהו הבסיס הנורמטיבי הראוי להגנה על ציפייה או הסתמכות שנולדה מפעולת המינהל.
  - quoted span:

```
ע ל והן צ ד ק שיקולי ע ל הן יעילות, שיקולי ע ל הן מ ב ו ס ס י ם א ל ה צידוקים ה מ נ ה ל י .
היעילות, מ ה י ב ט ה ש ל ט ו נ י ת . ה ע ו צ מ ה מ פ נ י ה א ז ר ח זכויות ה ג נ ת
```

- C2 (core, verified) · source `S3`
  - proposition: ברק־ארז כותבת שהדוקטרינות המנהליות הנדונות התפתחו בפסיקה מצידוקים מגוונים, ושלא תמיד ברור אם יש ביניהן קשר פנימי. לכן, מחלוקת או בירור בסיסי במחקר הוא אם וכיצד לאחד בין הבטחה מינהלית, ציפייה לגיטימית והסתמכות תחת תשתית עיונית אחת.
  - quoted span:

```
הן נובעות 4
ד ב ר ה ן ה ת פ ת ח ו ב פ ס י ק ה כ מ ע נה ל מ צ י א ו ת ה מ נ ה ל י ת ש ל ה מ ד י נ ה ה מ ו ד ר נ י ת
שונים ו מ צ י ד ו ק י ם מגוונים, ו ל א ת מ י ד ברור ה א ם קיים ק ש ר פ נ י מ י ביניהן
```

- C3 (supporting, verified) · source `S3`
  - proposition: גישה אחת בספרות עוסקת בהגנת ההסתמכות כמסגרת רחבה במשפט המנהלי, תוך בחינת יישומיה ביחס לענפי המשפט הפרטי; היא אינה מצטמצמת אפוא לשאלת תוקפה של הבטחה פורמלית בלבד.
  - quoted span:

```
הטענה, ע ו מ דת ה מ א מ ר ש ל ב מ ר כ ז ו
ע ל ל ה נ נ ה ה נורמטיביים הצידוקים נבחנים הדברים בפתח מוגנת. להיות צריכה
דיני־הנזיקין הפרטי ) דיני־החוזים, המשפט כענפים השונים של ויישומיהם
```

- C4 (core, verified) · source `S5`
  - proposition: שרון ידין מציגה במפורש שאלה סיווגית: הבטחה מינהלית וחוזה רגולטורי כ'דוקטרינות חלופיות ולא משלימות'; בהתאם, מחלוקת אפשרית ומרכזית היא אם להסדיר ציפיות שנוצרו ביחסי מינהל-פרט באמצעות דוקטרינת ההבטחה או באמצעות מסגרת חוזית-רגולטורית.
  - quoted span:

```
כריש, תין ולווייתן: על הבטחות מהליות, חוזים
רגולטוריים וחיות אחרות במתווה הגז הטבעי
שרון ידין *
תקציר ♦ מבוא ♦ א . חוזה רגולטורי והבטחה מהלית כדוקטריות חלופיות ולא
משלימות
```

- C5 (core, verified) · source `S4`
  - proposition: ביחס להבטחה מינהלית עצמה קיימת בספרות עמדה מגוננת המבקשת לשמר את הלכת סאי־טקס: מאמר המוקדש ל'אחריתה' של ההבטחה מתאר 'ניסיון לסיכול' המוסד ומצהיר כמסקנה על אימוץ ההלכה 'ככתבה וכלשונה'.
  - quoted span:

```
התגלית: ניסיון לסיכול מוסד ההבטחה המנהלית. א.
השאלה המנחה: ה״צידוק״ הוא זה או ״התנקשות״ בהלכה ? ב.
המסקנה: אימוץ הלכת סאי־טקם ככתבה וכלשונה!
```

- C6 (supporting, verified) · source `S6`
  - proposition: יונתן ברוורמן מציב מדיניות עקבית והבטחה כמכשירים נפרדים היוצרים ציפיות אצל אזרחים. מכאן שגישה מחקרית נוספת מחייבת להבחין בין מקור הציפייה—מדיניות כללית לעומת הבטחה—לפני קביעת היקף הביקורת וההגנה.
  - quoted span:

```
במשפט המנהלי מקובל להבחין בין שני מכשירים עיקריים הנוגעים בציפיות שנוצרות לאזרחים מפעולות המִנהל – האחד הוא המדיניות, והאחר הוא ההבטחה ה
```

## unresolved_questions

- אין בתשתית הנקראת די ראיות כדי למפות באופן ממצה את כל העמדות בספרות הישראלית בנוגע לעצמאותה הדוקטרינרית של הציפייה הלגיטימית.
- המקורות הזמינים כאן אינם מאפשרים לקבוע באופן אמין אם נדרשת הסתמכות בפועל בכל מסלול הגנה, או להכריע במחלוקת על הסעד המתאים (אכיפה, ביטול, פיצוי או סעד אחר).
- הקטעים שנקראו אינם מאפשרים לשחזר במלואם את תנאי הדוקטרינה הפסיקתיים של הבטחה מינהלית או את מבחני שינוי המדיניות העקבית.

## research_complete

NOT PERSISTED IN RUN ARTIFACT

## research_synthesis (memo)

- sections: 2
- source_roles: 4
- relationships: 2
- section headings / role assignments / relationship bodies: NOT PERSISTED IN RUN ARTIFACT

---

# L3 — `91723310-908b-4cae-9293-c543852c0ce7`

## issue_summary

תזכיר מתוקן בעקבות בדיקת תוקף עדכני: לא נקבעה עוד טענה על מצב הדין כיום לעניין סעיף 8 לחוק־יסוד: כבוד האדם וחירותו. המקור הרשמי שנקרא בפועל הוא קובץ הכנסת המסומן "מעודכן ליום ... 5 במאי 2025", אך הקריאה הממוקדת לא החזירה קטע מילולי של סעיף 8 עצמו; לכן הטענה על תוכן הסעיף נשמרת כתיאור של נוסח חוק־היסוד שנקרא בריצה, בלי סימון כמצב הדין הנוכחי.

## memo claims (5)

### C1 — importance: core — outcome: verified

**proposition:** בחוק־יסוד: כבוד האדם וחירותו, מידתיות היא תנאי חוקתי מפורש לפגיעה בזכויות המוגנות: הפגיעה צריכה להיות בחוק ההולם את ערכי המדינה, לתכלית ראויה, ובמידה שאינה עולה על הנדרש (או מכוח הסמכה מפורשת בחוק כאמור).

- evidence 1: source `S8` · locator: — · body_read: ok · identity: ok · span: ok · support: supports
  - reason: accepted by support verifier
  - quoted span:

```
אין פוגעים בזכויות שלפי חוק־יסוד זה אלא בחוק ההולם את ערכיה של מדינת ישראל, שנועד לתכלית ראויה, ובמידה שאינה עולה על הנדרש או לפי חוק כאמור מכוח הסמכה מפורשת בו.
```

### C2 — importance: core — outcome: partially_supported

**proposition:** לפי נדב דגן, הסבירות היא נורמה ותיקה של המשפט המנהלי ששימשה לבחינת שיקול הדעת השלטוני, בעוד שהמידתיות תפסה מקום מרכזי במשפט המנהלי החל בשנות התשעים; לכן הדיון בשתיהן משקף גם שכבות היסטוריות שונות של המשפט הציבורי.

- evidence 1: source `S2` · locator: עמ' 461 · body_read: ok · identity: ok · span: ok · support: supports_partially
  - reason: accepted by support verifier
  - quoted span:

```
החל משנות התשעים של המאה העשרים תפס המושג "מידתיות" מקום מרכזי
במשפט המנהלי הישראלי.
```

- evidence 2: source `S2` · locator: עמ' 462 בקירוב, כותרת המשנה "זליגת המידתיות מהמשפט החוקתי אל המשפט המנהלי" · body_read: ok · identity: ok · span: ok · support: supports_partially
  - reason: accepted by support verifier
  - quoted span:

```
החל משנות התשעים של המאה העשרים תפס המושג "מידתיות" מקום מרכזי
במשפט המנהלי הישראלי.
```

### C3 — importance: core — outcome: verified

**proposition:** היחסים בין המושגים אינם מוצגים בספרות כמוסדרים או חד־משמעיים: דגן מצביע על אי־בהירות באשר לתפקיד המובחן של כל אחד מהם ולשאלה אם יש מקום לשניהם בדיני שיקול הדעת המנהלי.

- evidence 1: source `S2` · locator: עמ' 461 · body_read: ok · identity: ok · span: ok · support: does_not_support · rejection: support_does_not_support
  - reason: הציטוט עוסק בתוצאה (היעדר עקיבות ופוטנציאל להחלטות שגויות) ולא מציין ישירות את פרטי הטענה על אי-הבהירות בתפקיד המובחן ובמקום של שניהם.
  - quoted span:

```
מהם היחסים בין הרעיון החדש של מידתיות לבין דרישת הסבירות הוותיקה
והמבוססת במשפט המנהלי, מה התפקיד המובחן שממלאת כל אחת והאם יש
מקום לשתיהן בדיני שיקול הדעת של המשפט המנהלי בישראל.
```

- evidence 2: source `S2` · locator: עמ' 461 · body_read: ok · identity: ok · span: ok · support: does_not_support · rejection: support_does_not_support
  - reason: הציטוט עוסק בתוצאה (היעדר עקיבות ופוטנציאל להחלטות שגויות) ולא מציין ישירות את פרטי הטענה על אי-הבהירות בתפקיד המובחן ובמקום של שניהם.
  - quoted span:

```
מהם היחסים בין הרעיון החדש של מידתיות לבין דרישת הסבירות הוותיקה
והמבוססת במשפט המנהלי, מה התפקיד המובחן שממלאת כל אחת והאם יש
מקום לשתיהן בדיני שיקול הדעת של המשפט המנהלי בישראל.
```

### C4 — importance: core — outcome: partially_supported

**proposition:** עמדתו הנורמטיבית של דגן היא שיש להבחין לפי סוג המעשה השלטוני: מידתיות שייכת לבחינת חוקתיות של חקיקה ראשית, וסבירות לבחינת חוקיותם של מעשים שלטוניים שאינם חקיקה ראשית; לשיטתו אין לייבא את המידתיות החוקתית לבחינת שיקול דעת מנהלי.

- evidence 1: source `S2` · locator: עמ' 461 · body_read: ok · identity: ok · span: ok · support: supports_partially
  - reason: accepted by support verifier
  - quoted span:

```
במאמר מוצעת הבחנה ברורה בין המשפט החוקתי, קרי בחינת חוקתיותה
של חקיקה ראשית, למשפט המנהלי, דהיינו בחינת חוקיותם של מעשים
שלטוניים שאינם חקיקה ראשית.
```

- evidence 2: source `S2` · locator: עמ' 461 · body_read: ok · identity: ok · span: ok · support: supports_partially
  - reason: accepted by support verifier
  - quoted span:

```
במאמר מוצעת הבחנה ברורה בין המשפט החוקתי, קרי בחינת חוקתיותה
של חקיקה ראשית, למשפט המנהלי, דהיינו בחינת חוקיותם של מעשים
שלטוניים שאינם חקיקה ראשית.
```

- evidence 3: source `S2` · locator: עמ' 461 · body_read: ok · identity: ok · span: ok · support: supports_partially
  - reason: accepted by support verifier
  - quoted span:

```
במאמר מוצעת הבחנה ברורה בין המשפט החוקתי, קרי בחינת חוקתיותה
של חקיקה ראשית, למשפט המנהלי, דהיינו בחינת חוקיותם של מעשים
שלטוניים שאינם חקיקה ראשית.
```

### C5 — importance: supporting — outcome: verified

**proposition:** לפי דגן, ההבדל המהותי שהוא מציע הוא נקודת המוצא: הסבירות מכוונת להגשמת תכליתה המיוחדת של הסמכות ולאינטרס ציבורי, ואילו מידתיות חוקתית מאורגנת סביב הנחת קיומה של זכות מוגנת. זה מסביר מדוע, לפי עמדה זו, אין לראות בשני המונחים רק שמות חלופיים לאותו מבחן.

- evidence 1: source `S2` · locator: עמ' 461 · body_read: ok · identity: ok · span: ok · support: supports
  - reason: accepted by support verifier
  - quoted span:

```
דרישת הסבירות מבוססת על הגשמת תכליתה
המיוחדת של ה סמכות – אינטרס ציבורי מסוים, ואילו המידתיות מבוססת על
הנחה של זכות מוגנת, המארגנת את הבחינה המשפטית.
```

## unresolved_questions

- אף שנקרא קובץ רשמי של הכנסת המסומן "מעודכן ליום ... 5 במאי 2025", הקריאה הממוקדת לא הפיקה קטע מילולי של סעיף 8 לחוק־יסוד: כבוד האדם וחירותו מתוך אותו קובץ; לכן אין בתזכיר קביעה על תוקפו העדכני של הסעיף.
- לא מוצתה פסיקת בית המשפט העליון לאחר 2023 בדבר תחולת עילת הסבירות בפועל והאופן שבו היא מתיישבת כיום עם מידתיות בביקורת על פעולות מינהליות.
- עמדת דגן היא עמדה אקדמית מובחנת ולא הוכח כאן כי היא אומצה במלואה בהלכה הפסוקה.
- לא נאספו כאן מקורות ראשוניים מספיקים למיפוי מלא של שלבי ההתפתחות בפסיקה.

## research_complete

NOT PERSISTED IN RUN ARTIFACT

## research_synthesis (memo)

- sections: 3
- source_roles: 2
- relationships: 2
- section headings / role assignments / relationship bodies: NOT PERSISTED IN RUN ARTIFACT

---

# L4 — `07e76882-c705-4409-a29b-2e6e0bf22aec`

## issue_summary

נבחנה התפתחות תפיסת תום הלב בדיני החוזים מן שנות התשעים דרך הלכת אפרופים ותיקון מס' 2 לחוק החוזים, וכן מחלוקת ספרותית עכשווית על היקף העיקרון ויחסו לחופש החוזים. המקורות שנקראו כוללים פסיקה, מאמרים אקדמיים ועמדה ביקורתית מזוהה. מגבלת המקורות שנקראו אינה מאפשרת לקבוע באופן מלא את כל קווי הפסיקה המאוחרים או את נוסח החוק העדכני.

## memo claims (6)

### C1 — importance: core — outcome: partially_supported

**proposition:** בספרות המתארת את המשפט הישראלי העכשווי, תום הלב נתפס כאחד משלושת עקרונות הליבה של דיני החוזים, לצד חופש החוזים ותקנת הציבור; הדיון עבר אפוא מתפיסה קלאסית הממוקדת ברצון הצדדים אל שאלת איזונם של עקרונות אלה ואחריות חברתית בחוזה.

- evidence 1: source `S2` · locator: — · body_read: ok · identity: ok · span: ok · support: supports_partially
  - reason: accepted by support verifier
  - quoted span:

```
הליבה החוזיים – עקרון חופש החוזים,
עקרון תום הלב ועקרון תקנת הציבור – ועל יחסי הגומלין ביניהם.
```

- evidence 2: source `S2` · locator: — · body_read: ok · identity: ok · span: ok · support: supports_partially
  - reason: accepted by support verifier
  - quoted span:

```
הליבה החוזיים – עקרון חופש החוזים,
עקרון תום הלב ועקרון תקנת הציבור – ועל יחסי הגומלין ביניהם.
```

- evidence 3: source `S2` · locator: — · body_read: ok · identity: ok · span: ok · support: supports_partially
  - reason: accepted by support verifier
  - quoted span:

```
הליבה החוזיים – עקרון חופש החוזים,
עקרון תום הלב ועקרון תקנת הציבור – ועל יחסי הגומלין ביניהם.
```

### C2 — importance: core — outcome: partially_supported

**proposition:** הרחבת תום הלב מוצגת בספרות כאמצעי שבאמצעותו ניתן לרתום את המוסד החוזי להגנה על ערכים חברתיים; אך אותה ספרות מדגישה שאין בחוק סדר עדיפויות מפורש בין תום הלב, תקנת הציבור וחופש החוזים.

- evidence 1: source `S2` · locator: — · body_read: ok · identity: ok · span: ok · support: supports_partially
  - reason: accepted by support verifier
  - quoted span:

```
מעורר את הפיתוי לרתום את המוסד החוזי גם לשמירתם
ולביסוסם של ערכים אלו , בעיקר באמצעות עקרונות תום הלב ותקנת הציבור.
```

- evidence 2: source `S2` · locator: — · body_read: ok · identity: ok · span: ok · support: supports_partially
  - reason: accepted by support verifier
  - quoted span:

```
מעורר את הפיתוי לרתום את המוסד החוזי גם לשמירתם
ולביסוסם של ערכים אלו , בעיקר באמצעות עקרונות תום הלב ותקנת הציבור.
```

### C3 — importance: core — outcome: partially_supported

**proposition:** גישה מרכזית אחת בספרות היא גישה מרחיבה: הפסיקה הרחיבה את תום הלב ואת תקנת הציבור כמגבלות מהותיות על רצון הצדדים. מחברי S2 מבקרים גישה זו וסבורים שהיא מחלישה יתר על המידה את חופש החוזים.

- evidence 1: source `S2` · locator: — · body_read: ok · identity: ok · span: ok · support: supports_partially
  - reason: accepted by support verifier
  - quoted span:

```
גישתה המרחיבה של הפסיקה לעקרונות תום הלב ותקנת
הציבור , אשר לטעמנו מוהלת יתר על המידה את עקרון חופש החוזים
```

- evidence 2: source `S2` · locator: — · body_read: ok · identity: ok · span: ok · support: supports_partially
  - reason: accepted by support verifier
  - quoted span:

```
גישתה המרחיבה של הפסיקה לעקרונות תום הלב ותקנת
הציבור , אשר לטעמנו מוהלת יתר על המידה את עקרון חופש החוזים
```

### C4 — importance: core — outcome: partially_supported

**proposition:** גישה נגדית, מצמצמת או מרסנת, מבקשת להעלות את קרנו של חופש החוזים ולדרוש קריטריונים שיטתיים לאיזון בינו לבין תום הלב; היא אינה שוללת את תום הלב, אלא מתנגדת להפעלתו הרחבה והבלתי-תחומה.

- evidence 1: source `S2` · locator: — · body_read: ok · identity: ok · span: ok · support: supports_partially
  - reason: accepted by support verifier
  - quoted span:

```
ביקורת על גישה
מרחיבה זו ובהצגת הגישה המצדיקה את העלאת קרנו של עקרון חופש החוזים
```

- evidence 2: source `S2` · locator: — · body_read: ok · identity: ok · span: ok · support: supports_partially
  - reason: accepted by support verifier
  - quoted span:

```
ביקורת על גישה
מרחיבה זו ובהצגת הגישה המצדיקה את העלאת קרנו של עקרון חופש החוזים
```

### C5 — importance: supporting — outcome: partially_supported

**proposition:** טליה איינהורן מציגה ביקורת חריפה יותר על אופן יישום העיקרון בישראל: לשיטתה, בפועל נעשה תום הלב מנגנון המאפשר להכריע לפי חוש הצדק של השופט; היא משווה זאת לתפקיד מצומצם ומובנה יותר של §242 הגרמני.

- evidence 1: source `S6` · locator: — · body_read: ok · identity: ok · span: ok · support: supports_partially
  - reason: accepted by support verifier
  - quoted span:

```
בפועל, הפכו בתי המשפט בישראל את עקרון
תום הלב למנגנון המאפשר לכל שופט לקבוע את תוצאת פסק הדין על פי חוש הצדק שלו.
```

- evidence 2: source `S6` · locator: — · body_read: ok · identity: ok · span: ok · support: supports_partially
  - reason: accepted by support verifier
  - quoted span:

```
בפועל, הפכו בתי המשפט בישראל את עקרון
תום הלב למנגנון המאפשר לכל שופט לקבוע את תוצאת פסק הדין על פי חוש הצדק שלו.
```

- evidence 3: source `S6` · locator: — · body_read: ok · identity: ok · span: ok · support: supports_partially
  - reason: accepted by support verifier
  - quoted span:

```
בפועל, הפכו בתי המשפט בישראל את עקרון
תום הלב למנגנון המאפשר לכל שופט לקבוע את תוצאת פסק הדין על פי חוש הצדק שלו.
```

### C6 — importance: supporting — outcome: partially_supported

**proposition:** המחלוקת על תום הלב קשורה גם להתפתחות דיני הפרשנות מאז אפרופים: תיקון מס' 2 לחוק החוזים משנת 2011 והספרות שלאחריו הציבו מחדש דרישה למשקל מהותי ללשון החוזה, כנגזרת מחופש החוזים והגנה מפני התערבות שיפוטית מיותרת.

- evidence 1: source `S7` · locator: — · body_read: ok · identity: ok · span: ok · support: does_not_support · rejection: support_does_not_support
  - reason: הציטוט קטוע וחלקי מאוד ואינו מבסס באופן משמעותי את הטענה המורכבת.
  - quoted span:

```
החוזים חוק ) כללי חלק ) ( מס תיקון ' 2 ( , התשע " א - 2011 , ס " ח 202
```

- evidence 2: source `S7` · locator: — · body_read: ok · identity: ok · span: ok · support: does_not_support · rejection: support_does_not_support
  - reason: הציטוט קטוע וחלקי מאוד ואינו מבסס באופן משמעותי את הטענה המורכבת.
  - quoted span:

```
החוזים חוק ) כללי חלק ) ( מס תיקון ' 2 ( , התשע " א - 2011 , ס " ח 202
```

- evidence 3: source `S7` · locator: — · body_read: ok · identity: ok · span: ok · support: does_not_support · rejection: support_does_not_support
  - reason: הציטוט קטוע וחלקי מאוד ואינו מבסס באופן משמעותי את הטענה המורכבת.
  - quoted span:

```
החוזים חוק ) כללי חלק ) ( מס תיקון ' 2 ( , התשע " א - 2011 , ס " ח 202
```

## unresolved_questions

- לא הושג נוסח רשמי עדכני וקריא של סעיף 39 לחוק החוזים; לכן אין לקבוע כאן טענה על נוסחו או על הדין התקף כיום.
- נדרש מחקר פסיקתי נוסף כדי למפות באופן מבוסס את ההתפתחויות המאוחרות לאחר אפרופים ותיקון מס' 2, ובפרט אם וכיצד הן שינו את הפעלת סעיף 39 במישרין.
- המחקר מאתר שתי עמדות מרכזיות (מרחיבה מול מרסנת) וביקורת חריפה של איינהורן, אך אינו מספק בסיס מספיק למיפוי ממצה של כלל החוקרים והגישות בספרות העכשווית.

## research_complete

NOT PERSISTED IN RUN ARTIFACT

## research_synthesis (memo)

- sections: 3
- source_roles: 3
- relationships: 3
- section headings / role assignments / relationship bodies: NOT PERSISTED IN RUN ARTIFACT

---

# L5 — `8cee562e-d2d4-4220-a37d-22eed5f4f8f8`

## issue_summary

סקירת ספרות נדרשת להבחין בין בעיית הנציג האנכית (מנהלים–בעלי מניות) לבין בעיית בעל השליטה–המיעוט, ולמפות את כלי הדין המהותיים, הפרוצדורליים והאכיפתיים. המחקר תומך במסגרת כללית אחת חזקה מן הספרות המשווה, ובדוגמה ישראלית עדכנית של חובת הגינות ומסלול אישור רב-שלבי לעסקאות עם בעל שליטה.

## memo claims (5)

### C1 — importance: core — outcome: partially_supported

**proposition:** הספרות מזהה את בעל השליטה כמי שפועל בצומת של שני ממדים של בעיית הנציג; יש להבחין בין מנגנונים שנועדו בעיקר לבעיית ההפרדה בין בעלות לשליטה (למשל דירקטורים בלתי תלויים) לבין ההגנה המיוחדת הנדרשת מפני ניגוד עניינים של בעל שליטה.

- evidence 1: source `S1` · locator: — · body_read: ok · identity: ok · span: ok · support: supports_partially
  - reason: accepted by support verifier
  - quoted span:

```
The role of controlling
shareholders lies at the intersection of two elements of the agency
problem that is at the core of public corporation governance. The first
element is the familiar agency problem that arises from the separation
of ownership and control. This problem is the target of governance
devices like hostile takeovers and independent directors
```

### C2 — importance: core — outcome: verified

**proposition:** גישת-על מרכזית בספרות היא לאסור או לצמצם הפקת הטבות פרטיות משליטה מעבר לתרומת הפיקוח המרוכז, באמצעות שילוב של סטנדרטים מהותיים, גילוי ואכיפה אפקטיבית.

- evidence 1: source `S1` · locator: — · body_read: ok · identity: ok · span: ok · support: supports
  - reason: accepted by support verifier
  - quoted span:

```
Good law limits private benefits of control to amounts that are smaller than the increased
productivity from more focused monitoring. To accomplish this outcome, good law must specify substantive standards, require sufficient
disclosure that those with the power to enforce the standards know of
violations, and provide an effective enforcement process.
```

### C3 — importance: core — outcome: verified

**proposition:** ביחס לצורת המנגנון, הספרות המשווה אינה מציגה מסלול יחיד: את משטר ההגנה אפשר לבנות בחקיקה מפורטת, בעקרונות שיפוטיים של חובות אמון, או באמצעות כללים פורמליים ורגולציה פרטית; לכן יש להציג אלה כחלופות מוסדיות או כמשטרים משולבים, ולא כנוסחה אחידה.

- evidence 1: source `S1` · locator: — · body_read: ok · identity: ok · span: ok · support: supports
  - reason: accepted by support verifier
  - quoted span:

```
Such a regime can be accomplished through detailed legislation, as
with European laws governing corporate groups,32 or by judicially developed principles of fiduciary duty, as in the United States.33 In turn,
standard setting can be accomplished by formal legal rules or, as is
particularly important in the United Kingdom, through private regulatory organizations.
```

### C4 — importance: supporting — outcome: verified

**proposition:** בדין הישראלי העדכני קיימת חובת הגינות סטטוטורית של בעל שליטה כלפי החברה; זהו עוגן נורמטיבי מהותי להתמודדות עם שימוש בכוח שליטה בניגוד עניינים.

- evidence 1: source `S8` · locator: סעיף 193 · body_read: ok · identity: ok · span: ok · support: supports
  - reason: accepted by support verifier
  - quoted span:

```
193. (א) על המפורטים להלן מוטלת החובה לפעול בהגינות כלפי החברה:
(1) בעל השליטה בחברה;
```

### C5 — importance: supporting — outcome: verified

**proposition:** הדין הישראלי העדכני מדגים גישה פרוצדורלית לעסקאות נגועות: עסקה מהסוג שבסעיף 270(4) מחייבת אישור מדורג של ועדת ביקורת (או ועדת תגמול), דירקטוריון ואסיפה כללית, ובאסיפה נדרש ככלל רוב מקרב בעלי המניות שאינם בעלי עניין אישי או חלופת שיעור-התנגדות נמוך.

- evidence 1: source `S8` · locator: סעיף 275(א) · body_read: ok · identity: ok · span: ok · support: supports
  - reason: accepted by support verifier
  - quoted span:

```
275. (א) עסקה שמתקיים בה האמור בסעיף 270(4) טעונה אישורם של אלה בסדר הזה:
(1) ועדת הביקורת, ובעסקה באשר לתנאי כהונה והעסקה – ועדת התגמול;
(2) הדירקטוריון;
(3) האסיפה הכללית, ובלבד שיתקיים אחד מאלה:
(א) במנין קולות הרוב באסיפה הכללית ייכללו רוב מכלל קולות בעלי המניות שאינם בעלי ענין אישי באישור העסקה, המשתתפים בהצבעה;
```

## unresolved_questions

- המחקר הנוכחי אינו ממפה במלואו את המחלוקות האקדמיות לגבי יעילותם היחסית של אישור רוב מן המיעוט, ועדות בלתי תלויות וביקורת שיפוטית בדיעבד; להעמקה בעבודה אקדמית רצוי להוסיף ספרות ייעודית לכלי האישור וההתדיינות.
- לא נבדקה כאן הפסיקה הישראלית המפרשת את היקף חובת ההגינות, את סעיף 275 ואת תוצאות הפרתם; אין להסיק מתזכיר זה לבדו את מבחני הביקורת השיפוטית או את הסעדים.
- הציטוט לסעיף 275 מפנה לעסקה המקיימת את סעיף 270(4); לצורך ניתוח של סוג העסקאות המדויק יש לקרוא גם את סעיף 270(4).

## research_complete

NOT PERSISTED IN RUN ARTIFACT

## research_synthesis (memo)

- sections: 3
- source_roles: 2
- relationships: 2
- section headings / role assignments / relationship bodies: NOT PERSISTED IN RUN ARTIFACT

---

# L6 — `25a6cd67-b97d-4e2b-8f73-0261f472ca4b`

## issue_summary

מיפוי הוויכוח האקדמי בישראל על ביקורת שיפוטית בחוקי יסוד מחייב להבחין בין ביקורת על עצם ההכרה בסמכות, בין ביקורת מסוג צורני־מוסדי של שימוש לרעה בסמכות המכוננת, ובין ביקורת תוכנית של "תיקון חוקתי שאינו חוקתי". החומר שנקרא מספק עיגון להבחנה זו, לעמדת ביקורת מזוהה אחת, ולהתפתחות הפסיקתית הרלוונטית; הוא אינו מספק מדגם מספק של ספרות אקדמית מכל המחנות לצורך מיפוי מלא של כל הכותבים והנמקותיהם.

## memo claims (6)

### C1 — importance: core — outcome: partially_supported

**proposition:** נקודת מוצא מרכזית לוויכוח היא ההבחנה בין שני מסלולים: דוקטרינת "תיקון חוקתי שאינו חוקתי" בוחנת את תוכנו ומהותו של חוק היסוד או התוספת החוקתית; לעומתה, הדיון בשימוש לרעה בסמכות המכוננת עוסק במסגרת אחרת של ביקורת על חקיקת יסוד.

- evidence 1: source `S2` · locator: — · body_read: ok · identity: ok · span: ok · support: supports_partially
  - reason: accepted by support verifier
  - quoted span:

```
כאשר עוסקים בביקורת שיפוטית על חוקה יש להבחין בין שתי דוקטרינות שונות: הראשונה, דוקטרינת ' תיקון חוקתי שאינו חוקתי ', היא דוקטרינה שבוחנת את תוכן החוקה ומהותה
```

### C2 — importance: core — outcome: verified

**proposition:** העמדה הביקורתית המיוחסת לעו״ד משה יפה מטילה ספק במקור הסמכות של בית המשפט להפעיל בישראל את דוקטרינת התיקון החוקתי שאינו חוקתי; לפי המאמר, אין מדובר רק בשאלה תוצאתית אלא בקושי מוסדי־משפטי של הסמכה.

- evidence 1: source `S2` · locator: — · body_read: ok · identity: ok · span: ok · support: does_not_support · rejection: support_does_not_support
  - reason: הציטוט מציין באופן כללי בלבד כי משה יפה מנתח את בג"ץ שפיר ומצביע על ביקורות וקשיים, ללא אזכור של דוקטרינת התיקון החוקתי שאינו חוקתי או שאלת מקור הסמכות.
  - quoted span:

```
למען האמת, יש לשאול מהיכן ישאב בית המשפט סמכות להפעלת הדוקטרינה – כי נראה שאין לו סמכות לכך בחוק.
```

- evidence 2: source `S2` · locator: — · body_read: ok · identity: ok · span: ok · support: does_not_support · rejection: support_does_not_support
  - reason: הציטוט מציין באופן כללי בלבד כי משה יפה מנתח את בג"ץ שפיר ומצביע על ביקורות וקשיים, ללא אזכור של דוקטרינת התיקון החוקתי שאינו חוקתי או שאלת מקור הסמכות.
  - quoted span:

```
למען האמת, יש לשאול מהיכן ישאב בית המשפט סמכות להפעלת הדוקטרינה – כי נראה שאין לו סמכות לכך בחוק.
```

### C3 — importance: core — outcome: partially_supported

**proposition:** בג״ץ שפיר הוא מוקד חשוב למחלוקת משום שנדונה בו ביקורת שיפוטית על פעולת הכנסת כרשות מכוננת באמצעות דוקטרינת השימוש לרעה בסמכות המכוננת; לכן, מיפוי הוויכוח צריך להפריד בין טיעונים בעד או נגד דוקטרינה זו לבין הטיעונים בדבר פסילת תיקון חוקתי מטעמי תוכן.

- evidence 1: source `S2` · locator: — · body_read: ok · identity: ok · span: ok · support: does_not_support · rejection: support_does_not_support
  - reason: הציטוט מתייחס רק באופן כללי לביקורת שיפוטית על חוקי היסוד, ואינו כולל את הפרטים המרכזיים בטענה על בג"ץ שפיר, דוקטרינת השימוש לרעה וההבחנה הנדרשת.
  - quoted span:

```
בבג"ץ שפיר נדונה בהרכב מורחב של תשעה שופטים שאלת הביקורת השיפוטית של בית המשפט העליון על עבודת הכנסת כרשות מכוננת במסגרת דוקטרינת "השימוש לרעה בסמכות הרשות המכוננת".
```

- evidence 2: source `S2` · locator: — · body_read: ok · identity: ok · span: ok · support: does_not_support · rejection: support_does_not_support
  - reason: הציטוט מתייחס רק באופן כללי לביקורת שיפוטית על חוקי היסוד, ואינו כולל את הפרטים המרכזיים בטענה על בג"ץ שפיר, דוקטרינת השימוש לרעה וההבחנה הנדרשת.
  - quoted span:

```
בבג"ץ שפיר נדונה בהרכב מורחב של תשעה שופטים שאלת הביקורת השיפוטית של בית המשפט העליון על עבודת הכנסת כרשות מכוננת במסגרת דוקטרינת "השימוש לרעה בסמכות הרשות המכוננת".
```

### C4 — importance: supporting — outcome: rejected

**proposition:** בפסיקה המאוחרת בעניין תיקון הסבירות, רוב של 12 מתוך 15 שופטים הכיר בקיום סמכות לביקורת שיפוטית על חוקי יסוד במקרים חריגים וקיצוניים של חריגה מסמכות מכוננת; רוב של 8 מתוך 15 הורה על בטלות תיקון מס׳ 3 לחוק־יסוד: השפיטה. התפתחות זו היא ההקשר הפסיקתי העדכני שבו מתנהל הוויכוח האקדמי.

- evidence 1: source `S5` · locator: — · body_read: ok · identity: ok · span: failed · support: not_reached · rejection: span_not_found
  - reason: span not present in the fetched body
  - quoted span:

```
הסמכות לו נתונה כי (שופטים 15 מתוך 12) רוב בדעת היום קבע העליון המשפט בית לקיים חוקי יסוד על שיפוטית ביקורת
```

- evidence 2: source `S5` · locator: — · body_read: ok · identity: ok · span: failed · support: not_reached · rejection: span_not_found
  - reason: span not present in the fetched body
  - quoted span:

```
וקבע הוסיף העליון המשפט בית כי יש להכריז על בטלותו של תיקון מס׳ 3 לחוק-יסוד :השפיטה
```

### C5 — importance: core — outcome: rejected

**proposition:** טיעון התומך בביקורת תוכנית קיצונית יכול להישען על תפיסה שלפיה הכנסת כרשות מכוננת אינה "יכולה כל", ואין בסמכותה לשלול או לסתור חזיתית את מאפייני היסוד של ישראל כמדינה יהודית ודמוקרטית. זהו היסוד הנורמטיבי הנגדי לטענת היעדר ההסמכה של המבקרים.

- evidence 1: source `S5` · locator: — · body_read: ok · identity: ok · span: failed · support: not_reached · rejection: span_not_found
  - reason: span not present in the fetched body
  - quoted span:

```
כי הכנסת כרשות מכוננת אינה "יכולה כל" וכי אין בסמכותה – אף לא בחוק יסוד – לשלול או לסתור חזיתית את המאפיינים הגרעיניים של מדינת ישראל כמדינה יהודית ודמוקרטית.
```

### C6 — importance: supporting — outcome: partially_supported

**proposition:** המקור הביקורתי שנקרא מתאר כי בעת כתיבתו טרם נעשה בישראל שימוש בביטול חוק יסוד בשל היותו תיקון חוקתי שאינו חוקתי, אף שהדיון בחסון הותיר, לפי תיאורו, פתח למקרים חריגים בעתיד. זו טענה היסטורית־תיאורית של המקור, ולא קביעה על מצב הדין כיום.

- evidence 1: source `S2` · locator: — · body_read: ok · identity: ok · span: ok · support: supports_partially
  - reason: accepted by support verifier
  - quoted span:

```
במדינת ישראל טרם נעשה שימוש בביטול חוק יסוד בשל היותו תיקון חוקתי שאינו חוקתי.
```

- evidence 2: source `S2` · locator: — · body_read: ok · identity: ok · span: ok · support: supports_partially
  - reason: accepted by support verifier
  - quoted span:

```
במדינת ישראל טרם נעשה שימוש בביטול חוק יסוד בשל היותו תיקון חוקתי שאינו חוקתי.
```

## repaired memo claims (9)

- C1 (core, partially_supported) · source `S2`
  - proposition: נקודת מוצא מרכזית לוויכוח היא ההבחנה בין שני מסלולים: דוקטרינת "תיקון חוקתי שאינו חוקתי" בוחנת את תוכנו ומהותו של חוק היסוד או התוספת החוקתית; לעומתה, הדיון בשימוש לרעה בסמכות המכוננת עוסק במסגרת אחרת של ביקורת על חקיקת יסוד.
  - quoted span:

```
כאשר עוסקים בביקורת שיפוטית על חוקה יש להבחין בין שתי דוקטרינות שונות: הראשונה, דוקטרינת ' תיקון חוקתי שאינו חוקתי ', היא דוקטרינה שבוחנת את תוכן החוקה ומהותה
```

- C2 (core, verified) · source `S2`
  - proposition: העמדה הביקורתית המיוחסת לעו״ד משה יפה מטילה ספק במקור הסמכות של בית המשפט להפעיל בישראל את דוקטרינת התיקון החוקתי שאינו חוקתי; לפי המאמר, אין מדובר רק בשאלה תוצאתית אלא בקושי מוסדי־משפטי של הסמכה.
  - quoted span:

```
למען האמת, יש לשאול מהיכן ישאב בית המשפט סמכות להפעלת הדוקטרינה – כי נראה שאין לו סמכות לכך בחוק.
```

- C2 (core, verified) · source `S2`
  - proposition: העמדה הביקורתית המיוחסת לעו״ד משה יפה מטילה ספק במקור הסמכות של בית המשפט להפעיל בישראל את דוקטרינת התיקון החוקתי שאינו חוקתי; לפי המאמר, אין מדובר רק בשאלה תוצאתית אלא בקושי מוסדי־משפטי של הסמכה.
  - quoted span:

```
למען האמת, יש לשאול מהיכן ישאב בית המשפט סמכות להפעלת הדוקטרינה – כי נראה שאין לו סמכות לכך בחוק.
```

- C3 (core, partially_supported) · source `S2`
  - proposition: בג״ץ שפיר הוא מוקד חשוב למחלוקת משום שנדונה בו ביקורת שיפוטית על פעולת הכנסת כרשות מכוננת באמצעות דוקטרינת השימוש לרעה בסמכות המכוננת; לכן, מיפוי הוויכוח צריך להפריד בין טיעונים בעד או נגד דוקטרינה זו לבין הטיעונים בדבר פסילת תיקון חוקתי מטעמי תוכן.
  - quoted span:

```
בבג"ץ שפיר נדונה בהרכב מורחב של תשעה שופטים שאלת הביקורת השיפוטית של בית המשפט העליון על עבודת הכנסת כרשות מכוננת במסגרת דוקטרינת "השימוש לרעה בסמכות הרשות המכוננת".
```

- C3 (core, partially_supported) · source `S2`
  - proposition: בג״ץ שפיר הוא מוקד חשוב למחלוקת משום שנדונה בו ביקורת שיפוטית על פעולת הכנסת כרשות מכוננת באמצעות דוקטרינת השימוש לרעה בסמכות המכוננת; לכן, מיפוי הוויכוח צריך להפריד בין טיעונים בעד או נגד דוקטרינה זו לבין הטיעונים בדבר פסילת תיקון חוקתי מטעמי תוכן.
  - quoted span:

```
בבג"ץ שפיר נדונה בהרכב מורחב של תשעה שופטים שאלת הביקורת השיפוטית של בית המשפט העליון על עבודת הכנסת כרשות מכוננת במסגרת דוקטרינת "השימוש לרעה בסמכות הרשות המכוננת".
```

- C4 (supporting, rejected) · source `S5`
  - proposition: פסק הדין בעניין תיקון הסבירות הוא הקשר פסיקתי מרכזי לוויכוח: לפי תקציר פסק הדין, רוב של 12 מתוך 15 שופטים הכיר בסמכות לקיים ביקורת שיפוטית על חוקי יסוד במקרים חריגים וקיצוניים של חריגה מסמכות מכוננת, ורוב של 8 מתוך 15 קבע שיש להכריז על בטלות תיקון מס׳ 3 לחוק־יסוד: השפיטה.
  - quoted span:

```
הסמכות לו נתונה כי (שופטים 15 מתוך 12) רוב בדעת היום קבע העליון המשפט בית
לקיים חוקי יסוד על שיפוטית ביקורת
חרגה הכנסת שבהם וקיצוניים חריגים במקרים ולהתערב
.המכוננת מסמכותה
```

- C4 (supporting, rejected) · source `S5`
  - proposition: פסק הדין בעניין תיקון הסבירות הוא הקשר פסיקתי מרכזי לוויכוח: לפי תקציר פסק הדין, רוב של 12 מתוך 15 שופטים הכיר בסמכות לקיים ביקורת שיפוטית על חוקי יסוד במקרים חריגים וקיצוניים של חריגה מסמכות מכוננת, ורוב של 8 מתוך 15 קבע שיש להכריז על בטלות תיקון מס׳ 3 לחוק־יסוד: השפיטה.
  - quoted span:

```
בטלותו על להכריז יש כי (שופטים 15 מתוך 8) רוב בדעת וקבע הוסיף העליון המשפט בית
אשר השפיטה :יסוד-לחוק 3 'מס תיקון של
```

- C5 (core, rejected) · source `S5`
  - proposition: הבסיס הנורמטיבי לעמדה התומכת בביקורת תוכנית הוא שלסמכות המכוננת יש גבולות מהותיים: הכנסת כרשות מכוננת אינה "יכולה כל", ואף חוק יסוד אינו יכול לשלול או לסתור חזיתית את המאפיינים הגרעיניים של ישראל כמדינה יהודית ודמוקרטית.
  - quoted span:

```
הכנסת כרשות מכוננת אינה "יכולה כל" וכי אין בסמכותה – אף לא בחוק
יסוד – לשלול או לסתור חזיתית את המאפיינים הגרעיניים של מדינת ישראל
כמדינה יהודית ודמוקרטית.
```

- C6 (supporting, partially_supported) · source `S2`
  - proposition: המקור הביקורתי שנקרא מתאר כי בעת כתיבתו טרם נעשה בישראל שימוש בביטול חוק יסוד בשל היותו תיקון חוקתי שאינו חוקתי, אף שהדיון בחסון הותיר, לפי תיאורו, פתח למקרים חריגים בעתיד. זו טענה היסטורית־תיאורית של המקור, ולא קביעה על מצב הדין כיום.
  - quoted span:

```
במדינת ישראל טרם נעשה שימוש בביטול חוק יסוד בשל היותו תיקון חוקתי שאינו חוקתי.
```

## unresolved_questions

- לא ניתן, על בסיס הקטעים המילוליים שנשמרו, לייחס במדויק את העמדה והנמקותיהם של מחברי המקור S3, אף שהוא נקרא; לכן אין להציגו כמחנה עצמאי או לייחס לו תזה ספציפית.
- לא הושגה תשתית מספקת למיפוי מלא של הספרות האקדמית התומכת בביקורת שיפוטית רחבה, המתנגדת לה כליל, או המצדדת במודלים ביניים ובסעדים פרשניים במקום בטלות. מיפוי משתמש סופי צריך לסמן זאת כמגבלת כיסוי ולא כמסקנה על היעדר עמדות כאלה.
- אין להסיק מן התיאור ההיסטורי במאמר משנת 2022 שביטול בגין "תיקון חוקתי שאינו חוקתי" לא נעשה גם כיום; נדרשת בדיקה עדכנית ונפרדת אם מבקשים טענה על הדין הנוכחי.
- המקור S4 מזוהה כפרק מאת הלל זומר ויניב רוזנאי העוסק בפרשנות תואמת־חוקה ובחלופה לבטלות, אך לא נשמר קטע מהותי מספיק המאפשר לנסח את עמדתם המדויקת או לקבוע את זיקתה לביקורת על חוקי יסוד.

## research_complete

NOT PERSISTED IN RUN ARTIFACT

## research_synthesis (memo)

- sections: 3
- source_roles: 2
- relationships: 2
- section headings / role assignments / relationship bodies: NOT PERSISTED IN RUN ARTIFACT

---

# L7 — `48a7e489-87c4-47b4-a194-2ef8076fa37e`

## issue_summary

סקירת ספרות משפטית על זכויות יוצרים בקעקועים המוצגים במשחקי וידאו, בדגש על הגישות הדוקטרינריות והמחלוקת. המחקר השיג וקרא במלואו מאמר משפטי אקדמי אחד (Boston College Law Review), אך כמה מאמרים נוספים ופסקי דין שאותרו לא היו נגישים לקריאה; לכן הממצאים להלן הם סקירה ממוקדת וזהירה של העמדה והמיפוי שבמקור שנקרא, ולא מיפוי ממצה של כלל הספרות.

## memo claims (4)

### C1 — importance: core — outcome: verified

**proposition:** הספרות שנקראה מציגה את נקודת המוצא של גישת הרישיון המשתמע: קעקוע, בהיותו מצויר על גוף אדם, מחייב לפי המחברת מתן רישיון משתמע למקועקע; הרישיון משלב את הקעקוע בדמותו הכוללת של האדם ובזכויות הנלוות לה.

- evidence 1: source `S6` · locator: Abstract · body_read: ok · identity: ok · span: ok · support: supports
  - reason: accepted by support verifier
  - quoted span:

```
Tattoos are unique amongst copyrightable forms of expression because, by virtue of being drawn onto human canvases, they necessarily require
that the artist grant an implied license to the tattooed individual. By this license, a
tattoo is integrated with the tattooed individual’s overall likeness, with all the associated rights that follow.
```

### C2 — importance: core — outcome: partially_supported

**proposition:** לפי המקור שנקרא, בפסק הדין Solid Oak Sketches (S.D.N.Y., 2020) נקבע כי העתקת הקעקועים במשחק וידאו הייתה de minimis, מכוסה ברישיון משתמע ומוגנת כשימוש הוגן; זו הגישה שהמחברת מבקשת לאמץ ככלל פדרלי.

- evidence 1: source `S6` · locator: Abstract · body_read: ok · identity: ok · span: ok · support: supports_partially
  - reason: accepted by support verifier
  - quoted span:

```
the U.S. District Court for the Southern
District of New York held that the reproduction of the defendant’s tattoos in a
video game was de minimis, covered by an implied license, and protected by fair
use as a matter of law.
```

- evidence 2: source `S6` · locator: Introduction/Abstract · body_read: ok · identity: ok · span: ok · support: supports_partially
  - reason: accepted by support verifier
  - quoted span:

```
the U.S. District Court for the Southern
District of New York held that the reproduction of the defendant’s tattoos in a
video game was de minimis, covered by an implied license, and protected by fair
use as a matter of law.
```

### C3 — importance: core — outcome: partially_supported

**proposition:** המחלוקת המרכזית העולה מן המקור היא אם ניתן להכריע בהעתקת קעקועי ספורטאים במשחקים, בנסיבות אלה, כרישיון משתמע או כשימוש הוגן כעניין משפטי; Alexander ולאחריו Hayden מוצגים כגישה שלפיה ההגנות אינן הכרחיות והסוגיה עובדתית לדיון במשפט.

- evidence 1: source `S6` · locator: Introduction/Abstract · body_read: ok · identity: ok · span: ok · support: supports_partially
  - reason: accepted by support verifier
  - quoted span:

```
the District Court for
the Southern District of Illinois held that the reproduction of athletes’ tattoos in
video games was not necessarily protected by implied license or fair use; rather,
the question was a matter of fact for juries to consider at trial.
```

- evidence 2: source `S6` · locator: Introduction/Abstract · body_read: ok · identity: ok · span: ok · support: supports_partially
  - reason: accepted by support verifier
  - quoted span:

```
the District Court for
the Southern District of Illinois held that the reproduction of athletes’ tattoos in
video games was not necessarily protected by implied license or fair use; rather,
the question was a matter of fact for juries to consider at trial.
```

### C4 — importance: supporting — outcome: partially_supported

**proposition:** המקור ממקם את המחלוקת בהקשר של שלושה פסקי דין פדרליים מחוזיים ומציין שהסוגיה טרם הגיעה לערכאת ערעור; מכאן שהספרות המתוארת עוסקת בדין בלתי אחיד ולא בהלכה ערעורית מייצבת.

- evidence 1: source `S6` · locator: Abstract · body_read: ok · identity: ok · span: ok · support: supports_partially
  - reason: accepted by support verifier
  - quoted span:

```
In recent years, a trio of federal district court decisions have attempted to demarcate the metes and bounds of the implied license
for tattoos, specifically in the realm of video games.
```

- evidence 2: source `S6` · locator: Introduction/Abstract · body_read: ok · identity: ok · span: ok · support: supports_partially
  - reason: accepted by support verifier
  - quoted span:

```
In recent years, a trio of federal district court decisions have attempted to demarcate the metes and bounds of the implied license
for tattoos, specifically in the realm of video games.
```

## unresolved_questions

- לא הושגו לקריאה מאמרים נוספים שאותרו, ובהם “Game On—Copyrighted Tattoos in Video Games as Fair Use”, “The Player, the Video Game, and the Tattoo Artist: Who Has the Most Skin in the Game?”, “Not a Taboo Use of Tattoos” ו-“Tattoos, Norms, and Implied Licenses”; לכן אין לייחס להם כאן עמדות או למפות במלואן את המחלוקות ביניהם.
- לא נקראו גופי פסקי הדין עצמם. תיאור ההכרעות ב-Solid Oak, Alexander ו-Hayden נסמך כאן על מאמר משני, ולא נבדקו הנמקותיהם המלאות, עובדותיהם המדויקות או התפתחויות דיוניות מאוחרות.
- לא נבדקו במקור עצמאי שאלות סף שעשויות להיות מרכזיות בספרות הרחבה: מקוריות וכשירות הקעקוע להגנת זכויות יוצרים, זהות הבעלים, תנאי הרישיון בפועל, והיחס בין זכות היוצרים לזכויות הדמות/הפרסום של המקועקע.
- המקור שנקרא הוא מאמר אמריקאי; לא נחקר הדין הישראלי או ספרות ישראלית, ואין להסיק ממנו לגבי הדין בישראל.

## research_complete

NOT PERSISTED IN RUN ARTIFACT

## research_synthesis (memo)

- sections: 2
- source_roles: 1
- relationships: 2
- section headings / role assignments / relationship bodies: NOT PERSISTED IN RUN ARTIFACT

---

# L8 — `1cd5dae4-108b-4542-b411-984527ebe628`

## issue_summary

מחקר השוואתי-ספרותי על האופן שבו ספרות משפטית ישראלית וספרות אנגלית ממסגרות הבטחה מינהלית וציפייה לגיטימית; נבדקו מאמרים ישראליים על עילת ההבטחה והגנת ההסתמכות, ומאמרים אנגליים על ציפיות לגיטימיות מהותיות ודיוניות. המסקנות להלן מוגבלות לספרות שנקראה, ולא נועדו לתאר באופן ממצה את הדין החי בכל שיטה.

## memo claims (6)

### C1 — importance: core — outcome: verified

**proposition:** בספרות הישראלית שנקראה, הבטחה מינהלית מוצגת כעילת ביקורת עצמאית, תוך הדגשה שהרשות חייבת להביא בחשבון הן את אינטרס ההסתמכות והן את אינטרס הציפיות של האזרח.

- evidence 1: source `S5` · locator: — · body_read: ok · identity: ok · span: ok · support: supports
  - reason: accepted by support verifier
  - quoted span:

```
מהבחינה המעשית, ראשית נעיר, כי שאלת מיון
חשובה החובה להתחשב תמיד באינטרס ההסתמכות ובאינטרס הציפיות של האזרח —
חובת שמוטלת על הרשות הציבורית, ואין נפקא מינה אתו תווית תודבק לעילת ההת־
ערבות שתגן על האינטרסים הללו.
התנאי הבטחת מינהלית הינה עילת כשלעצמה.
```

### C2 — importance: core — outcome: partially_supported

**proposition:** אותה ספרות ישראלית אינה מציגה את קיום ההבטחה כחובה מוחלטת: גם כאשר מולאו התנאים הראשוניים, על הרשות המבקשת לחזור בה להצדיק זאת בטעם סביר; הסתמכות לרעה היא שיקול משמעותי אך אינה תנאי הכרחי לקשירת הרשות.

- evidence 1: source `S5` · locator: — · body_read: ok · identity: ok · span: failed · support: not_reached · rejection: span_not_found
  - reason: span not present in the fetched body
  - quoted span:

```
לאחר שנתמלאו ארבעת התנאים הראשונים, והרשות מבקשת לנער
את חוצנה מהבטחתה, אין החזקת Omnia praesumuntur rite esse acta תעמוד
לה, לרשות, והיא תחויב להדים את נטל הראיה בדבר קיומו של הטעם הסביר המצדיק
```

- evidence 2: source `S5` · locator: — · body_read: ok · identity: ok · span: failed · support: not_reached · rejection: span_not_found
  - reason: span not present in the fetched body
  - quoted span:

```
לאחר שנתמלאו ארבעת התנאים הראשונים, והרשות מבקשת לנער
את חוצנה מהבטחתה, אין החזקת Omnia praesumuntur rite esse acta תעמוד
לה, לרשות, והיא תחויב להדים את נטל הראיה בדבר קיומו של הטעם הסביר המצדיק
```

### C3 — importance: supporting — outcome: verified

**proposition:** הספרות הישראלית שנקראה מזהה גם מגמת צמצום ביחס להלכת סאי־טקס, ומייחסת אותה, לפי המאמר, לנוקשות הסעד של צו עשה בבג"ץ.

- evidence 1: source `S5` · locator: — · body_read: ok · identity: ok · span: ok · support: supports
  - reason: accepted by support verifier
  - quoted span:

```
אין להשאיר בלא !התייחסות גם את מגמת הצמצום ביחסה של הפסיקה אל הלכת
פאי־טקם. נראה לנו, כי מגמה זו נובעת מנוקשות הסעד )צו ״עשת״( הניתן בבג״צ,
```

### C4 — importance: core — outcome: partially_supported

**proposition:** בספרות האנגלית שנקראה, ציפייה לגיטימית כוללת לפחות הקשר דיוני של זכות להיוועצות והקשר מהותי של טובת הנאה; הטענה המהותית נבחנת בשפת הגינות ושימוש לרעה בכוח.

- evidence 1: source `S3` · locator: — · body_read: ok · identity: ok · span: ok · support: supports_partially
  - reason: accepted by support verifier
  - quoted span:

```
considers that a lawful promise or practice has induced
a legitimate expectation of a bene fi t which is substantive , not simply procedural, authority now establishes that here too the court will in a proper
case decide whether to frustrate the expectation is so unfair that to take a
new and di ff erent course will amount to an abuse of power
```

- evidence 2: source `S3` · locator: — · body_read: ok · identity: ok · span: ok · support: supports_partially
  - reason: accepted by support verifier
  - quoted span:

```
considers that a lawful promise or practice has induced
a legitimate expectation of a bene fi t which is substantive , not simply procedural, authority now establishes that here too the court will in a proper
case decide whether to frustrate the expectation is so unfair that to take a
new and di ff erent course will amount to an abuse of power
```

### C5 — importance: supporting — outcome: verified

**proposition:** הספרות האנגלית שנקראה מדגישה דרישות ראייתיות וקושי בקביעת ציפייה דיונית: גם הסתמכות מזיקה ותקשורת עם הרשות אינן מבטיחות הוכחה מספקת של זכות להיוועצות; לעומת זאת, פרקטיקה עקבית עשויה לסייע.

- evidence 1: source `S3` · locator: — · body_read: ok · identity: ok · span: ok · support: supports
  - reason: accepted by support verifier
  - quoted span:

```
it can be di ffi cult to establish su ffi cient evidence of a right to consultation, even when there has been
detrimental reliance on a policy and communication between the applicant
and the public body concerning the application of the policy to that individual. 47 It can be easier, however, to establish a procedural legitimate expectation of consultation from past practice, providing there is su ffi cient
consistent evidence of this practice.
```

### C6 — importance: core — outcome: partially_supported

**proposition:** באנגליה קיימת בספרות מחלוקת או לפחות דיון חי על היקף ההגנה על ציפיות לגיטימיות מהותיות ועל גישה צרה להן; זהו מוקד שונה מן המסגור הישראלי שנקרא, המתמקד בעילת ההבטחה ובאינטרסי הסתמכות וציפיות.

- evidence 1: source `S4` · locator: — · body_read: ok · identity: ok · span: ok · support: supports_partially
  - reason: accepted by support verifier
  - quoted span:

```
The Narrow Approach to Substantive Legitimate Expectations
and the Trend of Modern Authority
```

- evidence 2: source `S4` · locator: — · body_read: ok · identity: ok · span: ok · support: supports_partially
  - reason: accepted by support verifier
  - quoted span:

```
The Narrow Approach to Substantive Legitimate Expectations
and the Trend of Modern Authority
```

- evidence 3: source `S5` · locator: — · body_read: ok · identity: ok · span: ok · support: supports_partially
  - reason: accepted by support verifier
  - quoted span:

```
החובה להתחשב תמיד באינטרס ההסתמכות ובאינטרס הציפיות של האזרח
```

## unresolved_questions

- לא נערכה בדיקה של נוסח הדין העדכני או של הפסיקה המאוחרת בכל אחת מן המדינות; לכן אין להסיק מן התזכיר מהו הדין המחייב כיום.
- המדגם הישראלי שנקרא הוא בעיקר ספרות על הבטחה מינהלית והסתמכות, ולא נמצא במקור שנקרא דיון שיטתי ומפורש הממפה את המונח האנגלי legitimate expectation מול המונח הישראלי.
- ההשוואה היא בין מוקדי הדיון במאמרים שנקראו, ולא טענה שכל הספרות בכל שיטה אחידה. בפרט, המאמר האנגלי של Tomlinson מתעד דיון ומחלוקת, ולא בהכרח עמדה קונצנזואלית.

## research_complete

NOT PERSISTED IN RUN ARTIFACT

## research_synthesis (memo)

- sections: 3
- source_roles: 3
- relationships: 2
- section headings / role assignments / relationship bodies: NOT PERSISTED IN RUN ARTIFACT
