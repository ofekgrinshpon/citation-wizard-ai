

## חידוד מאושר

ה-auto-validator **לא ממיר** לפורמט כלל 8.3 — הוא רק **מנקה דפוסים שגויים**. ההפקה של הפורמט התקין עצמו נשארת באחריות ה-AI (פרומפט + hints על ה-source cards). אם אחרי הניקוי ההערה לא תקינה — הסינון הקיים יפיל אותה.

## עדכוני ניסוח

### 1. תגובת תכנון — חלק 4 (Auto-validator, שורה ~2595)

תיאור מדויק יותר:

> **Auto-validator — מנקה בלבד, לא ממיר**:
> 
> מטרת הבלוק היא להסיר דפוסים שאסור שיופיעו בציטוט פרוטוקול:
> - `(פורסם באתר כנסת, ...)` — לא חלק מפורמט כלל 8.3.
> - `[חסר: מספר ישיבה]` — כלל 8.3 דורש להשמיט, לא לסמן.
> - `[חסר: שם מומחה/מחבר]` בתחילת ציטוט פרוטוקול — לפרוטוקול אין מחבר.
> 
> **הבלוק לא מייצר פורמט תקני**. יצירת `פרוטוקול ישיבה X של ועדת Y, הכנסת ה-N (date).` נשארת באחריות ה-AI על בסיס:
> - הפרומפט (חלק 2).
> - ה-hint שמוזרק ל-source card (חלק 3): `[פרוטוקול ישיבה — עצב לפי כלל 8.3: הכנסת ה-N; ...]`.
> - כלל 8.3 ב-`citationRules.ts` (חלק 1).
> 
> **תפקיד הסינון אחרי הניקוי**: אם אחרי `replace` ההערה הופכת לקצרה מדי, ריקה, או לא-מהותית — הפילטרים הקיימים (`url_only`, `too_short`, `placeholder_dominant`, `broken_title`) יפילו אותה. ה-validator לא יוצר פורמט חדש ולא "מציל" הערה שבורה — הוא רק מסיר רעש כדי שההחלטה הסופית (לקבל / להפיל) תהיה נקייה.

### 2. הקוד עצמו — נשמר כפי שהוא

הלוגיקה הקיימת (`KNESSET_PUB_RE`, `MISSING_MEETING_NUM_RE`, `PROTOCOL_AUTHOR_RE` + `replace` בלבד) כבר תואמת לחידוד. הוספת תגובה מובהקת בקוד:

```typescript
// Cleanup ONLY — does not synthesize Rule 8.3 format.
// Strips invalid patterns; if nothing meaningful remains, the existing
// filter pipeline (url_only / too_short / placeholder_dominant / broken_title)
// will drop the footnote. Producing a valid Rule 8.3 citation is the AI's
// responsibility (driven by prompt + source-card hint + citationRules.ts).
```

### 3. עדכון memory — דיוק נוסף

ב-`mem://logic/citation-rules/meeting-protocols-rule-8-3.md` (החדש):

> **חלוקת אחריות**:
> - **AI (יצירה)**: מפיק פורמט כלל 8.3 על בסיס הפרומפט, ה-hints על source cards, וכללי 8.3 מ-`citationRules.ts`.
> - **Auto-validator (ניקוי)**: מסיר דפוסים שגויים בלבד — `(פורסם באתר כנסת)`, `[חסר: מספר ישיבה]`, `[חסר: שם מומחה]`. **לא** ממיר ל-Rule 8.3.
> - **Filters (החלטה סופית)**: אם אחרי הניקוי לא נשארה הערה מהותית — `url_only` / `too_short` / `placeholder_dominant` / `broken_title` מפילים אותה.

ב-`mem://logic/legal-qa/anchored-partial-citations.md`:

> **עיקרון post-processing**: auto-validators מנקים דפוסים שגויים, לא ממירים פורמטים. יצירת פורמט תקני = AI. החלטה לקבל/להפיל = pipeline הסינון הקיים.

## מה לא משתנה
- מבנה הקוד של ה-validator (חלק 4 בתכנון הקודם).
- חלקים 1, 2, 3, 5, 6 — נשמרים כמתוכנן.
- כל הסינון הקיים — ללא שינוי.

## תוצאה צפויה
- שלוש שכבות מוגדרות בבירור: **יצירה (AI) → ניקוי (validator) → סינון (filters)**.
- אין הבטחה שווא ש-validator "מתקן" פורמטים שבורים.
- אם ה-AI מתעלם מהפרומפט — ה-validator ינקה והסינון יפיל; ההערה לא תופיע למשתמש כ"חצי-תקנית".

