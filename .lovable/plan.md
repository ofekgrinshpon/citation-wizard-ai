**ממצאים**
- ההודעה “יש להזין טקסט.” קיימת רק ב־`LegalQAChat.tsx`, בתוך `handleAcademicSubmit`.
- למרות שה־guard הנוכחי נראה נכון, יש נקודת race: בלחיצה על שאלה מוצעת או אישור שאלת מחקר, הקוד עושה `setResearchQuestion(...)` ואז מיד קורא `handleAcademicSubmit(...)`. React עדיין לא עדכן את state, ולכן `handleAcademicSubmit` רואה `researchQuestion` ריק ועלול להפעיל את guard של “יש להזין טקסט”.
- בנוסף, `writeCurrentChapter()` לא מעביר במפורש את פרטי הפרק הנוכחי, ולכן הוא עדיין תלוי ב־state שעלול להיות לא מסונכרן.

**תוכנית תיקון**
1. לעדכן את `handleAcademicSubmit` כך שיבנה `effectiveResearchQuestion` מתוך שלושה מקורות לפי סדר עדיפות:
   - `extraBody.researchQuestion` אם הועבר במפורש.
   - `researchQuestion` מה־state.
   - `question.trim()` כ־fallback בשלבי מעבר מוקדמים.
2. להחליף את כל בדיקות `researchQuestion?.trim()` בתוך `handleAcademicSubmit` ב־`effectiveResearchQuestion`, כדי למנוע קריאה ל־state ישן.
3. בשלבי כתיבה (`write_chapter`, `write_introduction`, `write_conclusion`, abstract), לשלוח תמיד `question`, `researchQuestion`, `chapterTitle`, ו־`chapterIndex` מתוך הערכים האפקטיביים, לא מתוך textarea ריק.
4. לעדכן את `writeCurrentChapter()` כך שיעביר במפורש את `chapterTitle`, `chapterIndex`, ו־`researchQuestion` ל־`handleAcademicSubmit`, כולל למסלולי מבוא/סיכום/תקציר.
5. להשאיר את “יש להזין טקסט” רק לשלבים הראשונים שבאמת דורשים הקלדה ידנית: הצעת שאלות, בדיקת שאלה, ומתווה ללא שאלת מחקר שמורה.

**מה לא משתנה**
- אין שינוי ב־backend, חיוב/קרדיטים, prompts, או עיצוב.
- אין שינוי בהתנהגות הסיכום/מבוא מעבר לכך שהם לא ידרשו textarea.