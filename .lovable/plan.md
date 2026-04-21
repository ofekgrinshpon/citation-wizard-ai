

## מטרה
לבטל את ה־route הישן `/legal-qa` ולהפנות אותו ל־flow הקנוני היחיד: `/app?mode=legalqa`. כך מסירים את הכפילות בין `LegalQA.tsx` ל־`LegalQAChat.tsx`, ומונעים drift עתידי בקופי, בקרדיטים, ב־footnotes ובחווית המשתמש.

## שינויים

### 1. `src/App.tsx`
- להחליף את ה־route:
  ```tsx
  <Route path="/legal-qa" element={<LegalQA />} />
  ```
  ב־redirect קבוע ששומר על `addin=1` במידת הצורך:
  ```tsx
  <Route path="/legal-qa" element={<Navigate to="/app?mode=legalqa" replace />} />
  ```
- להסיר את ה־import של `LegalQA` מהקובץ.

### 2. `src/pages/LegalQA.tsx`
- למחוק את הקובץ. הוא לא יישאר בשימוש בשום מקום באפליקציה.

### 3. בדיקת קישורים פנימיים
- לוודא שאף קומפוננטה (סיידבר, ניווט, כפתורי "פתח עוזר משפטי", landing) לא מפנה ל־`/legal-qa`. אם כן — לעדכן ל־`/app?mode=legalqa`. (בסריקה מקדימה לא נצפה שימוש פעיל מתוך הסיידבר, אבל יש לוודא ולהחליף בכל מופע אם קיים.)

### 4. שמירת תאימות לאחור
- ה־redirect הוא `replace`, כך שמשתמשים שיש להם bookmark ישן ל־`/legal-qa` יועברו אוטומטית ל־flow הקנוני בלי להשאיר רשומה ב־history.
- אם יש פרמטר `?addin=1` או query אחר, ה־redirect הסטטי לא ישמר אותו. אם רוצים לשמר addin, אפשר להשתמש ב־wrapper קטן:
  ```tsx
  function LegalQARedirect() {
    const search = window.location.search;
    return <Navigate to={`/app?mode=legalqa${search ? `&${search.slice(1)}` : ""}`} replace />;
  }
  ```
  ולהשתמש בו במקום `<Navigate />` הישיר.

## מחוץ ל־scope
- שינויים ב־`LegalQAChat.tsx` או ב־edge function `legal-qa`.
- איחוד קופי/קרדיטים/footnotes — כבר נמצאים רק ב־flow הקנוני אחרי המחיקה.
- הוספת בדיקות אוטומטיות לניתוב.

## תוצאה
- קיים flow אחד בלבד לעוזר המשפטי: `/app?mode=legalqa` (`LegalQAChat.tsx`).
- `/legal-qa` ממשיך לעבוד כ־URL חוקי אבל מבצע redirect שקוף ל־flow הקנוני.
- מסירים כ־400 שורות קוד כפול שגרמו לבאגים מתועדים (footnote ‎10/20 שבור, אין refund toast, אין החלפת מצב, אין task modes, אין file upload).
- אין יותר drift אפשרי בין שתי גרסאות של אותו פיצ'ר.

