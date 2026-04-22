

## הבעיה
ההערות שצירפת:
```
3. חסר: פרטי פסיקה | פס"ד שפירא [חסר: מספר תיק] שפירא נ' מדינת ישראל [חסר: פרטי פרסום] (פורסם בנבו [חסר: תאריך]).
4. חסר: שם מחבר "חשיבות עצמאותו של היועץ המשפטי לממשלה ותפקידו כשומר הסף" [חסר: שם כתב עת] [חסר: כרך] [חסר: עמוד פתיחה] ([חסר: שנה]).
```
שתיהן **בלי URL ובלי source אמיתי** — בדיוק התרחיש שתיקון "anchored partial citations" היה אמור למנוע. אז למה הן עברו?

## ניתוח הבאג

ב-`supabase/functions/legal-qa/index.ts`, שורות 2148–2210:
1. `matchFootnoteToCard` נכשל למצוא card תואם.
2. `fuzzyUrl` נכשל גם הוא — אין URL.
3. ה-fallback בשורה 2202 דוחף את ההערה כמו שהיא עם `source: "unverified"`.
4. ב-`reasonFor` (שורות 2592–2601) — `hasAnchor` מחזיר `false` (כי `unverified` נחסם ✓), אבל הציטוט ארוך מ-25 תווים ומכיל "שפירא"/"מדינת ישראל" → **עובר את `too_short` וגם את `missing_parties`** ונשאר.

הסינון הנוכחי בעצם תפס רק הערות **קצרות** או **חסרות תוכן מילולי** — לא הערות שהן רק שלד טקסטואלי של `[חסר: ...]` סביב כותרת בלי anchor אמיתי.

## הפתרון

שינוי ממוקד אחד ב-`reasonFor` (`supabase/functions/legal-qa/index.ts`, שורות 2592–2601):

### חוק חדש: `placeholder_dominant`
אם הערה היא **לא מעוגנת** (`!hasAnchor`) **ויש בה לפחות סמן `[חסר: ...]` אחד** → הערה נופלת, ללא תלות באורך.

הרציונל: כש-AI כותב `[חסר: ...]` הוא מודה במפורש שחסר לו פרט. אם בנוסף אין שום anchor (URL/local source/perplexity card) — **אין שום בסיס לסמוך על קיומו של המקור עצמו**. לעומת זאת, כשיש anchor — הסמן הוא חלק לגיטימי של ציטוט חלקי-אך-כן (התרחיש שאושר).

### סקיצת קוד
```typescript
const reasonFor = (fn): string | null => {
  const t = fn.citation.trim();
  if (isUrlOnly(t)) return "url_only";              // hard fail
  const anchored = hasAnchor(fn);
  // NEW: unanchored + AI admitted missing fields → drop
  if (!anchored && hasMissingMarker(t)) return "placeholder_dominant";
  const minLen = anchored ? 12 : 25;
  if (t.length < minLen) return "too_short";
  if (!anchored && isMissingSubstance(t)) return "missing_parties";
  return null;
};
```

### עדכון לוג
```
Dropped footnote #3 [placeholder_dominant, anchored=false, has_marker=true]: "..."
```
זה יחשוף בבירור בלוגים את התרחיש הזה לדיבוג עתידי.

### עדכון מקביל ב-prompt (שורות ~1771)
לחזק את ההנחיה הקיימת בפסקה אחת מפורשת:

> "אם אינך מצליח לעגן הערה במקור אמיתי (אין URL, אין רשומה ב-[מאומת] או [חיצוני]) — **אל תכתוב את ההערה כלל**, גם לא בצורת `[חסר: ...]`. סמן `[חסר: ...]` מותר רק כשיש מקור אמיתי וחסר ממנו פרט. הערה ללא anchor ועם `[חסר: ...]` תיפסל אוטומטית — אל תייצר אותה."

### ניקוי הפניות יתומות בגוף
הקוד הקיים בשורות 2622–2625 כבר מוחק את הסופרסקריפטים של הערות שנפלו. ההערות החדשות שייפלו ייהנו מאותו ניקוי אוטומטית — אין צורך בשינוי שם.

## מה לא משתנה
- `hasAnchor` — ההגדרה נשמרת (URL או source non-`unverified`).
- מנגנון anchored partial citations — נשמר במלואו. הערות עם URL + `[חסר: עמוד]` ימשיכו לעבור.
- שאר ה-validators (Rule 37, renumbering, content-aware back-ref) — אין שינוי.
- ה-fallback path בשורות 2202 (push עם `source: "unverified"`) — נשמר; הסינון בהמשך הוא שיפיל.

## תוצאה צפויה
- "פס"ד שפירא [חסר: מספר תיק] [חסר: פרטי פרסום]" ללא URL ← נופל ב-`placeholder_dominant`.
- "מאמר עם 4 סמני [חסר: ...]" ללא anchor ← נופל באותה דרך.
- "בג"ץ גילון, פ"ד [חסר: כרך], 263" עם URL מ-Perplexity ← **נשמר** (anchored).
- "ס' 8 לחוק-יסוד: כבוד האדם, ס"ח [חסר: עמוד]" עם match ל-local card ← **נשמר** (anchored).

