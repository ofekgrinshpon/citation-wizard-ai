

## מטרה
לעדכן את נוסח ה־banner שמופיע ב־Academic Wizard לפרקים השוואתיים כך שיתואר בצורה מדויקת ומועילה יותר, עם CTA ברור.

## שינוי
ב־`src/components/LegalQAChat.tsx`, באזור ה־Academic Wizard (הסקציה שתתווסף בתיקון 3 של ה־plan המאושר), להחליף את הנוסח של ה־banner.

### במקום הנוסח שהוצע:
> "פרק זה עוסק בנושא השוואתי. המאגר המקומי מכיל בעיקר מקורות ישראליים — מומלץ להעלות PDFs של מאמרים השוואתיים כדי לקבל הערות שוליים מדויקות."

### לכתוב:
**שורה 1 (כותרת/דגש):** "לא מצאתי מספיק מקורות זרים מעמיקים בחיפוש אוטומטי."

**שורה 2 (גוף):** "כדי שהפרק ההשוואתי יהיה ברמה אקדמית גבוהה, מומלץ להעלות כאן מאמרים או פסקי דין ספציפיים (PDF). אני אנתח אותם ואשלב אותם בטקסט עם אזכורים מדויקים."

**כפתור CTA:** "העלאת מקורות זרים" — שיפעיל את אותו file input הקיים ב־wizard ל־`documentTexts` (אותו upload flow של "צרף מסמך").

### מבנה ויזואלי
```tsx
{isComparativeChapter && uploadedDocumentTexts.length === 0 && (
  <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 text-sm text-amber-100 space-y-2">
    <div className="flex items-start gap-2">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      <div className="space-y-2 flex-1">
        <p className="font-semibold">לא מצאתי מספיק מקורות זרים מעמיקים בחיפוש אוטומטי.</p>
        <p className="text-amber-200/90 leading-relaxed">
          כדי שהפרק ההשוואתי יהיה ברמה אקדמית גבוהה, מומלץ להעלות כאן מאמרים או פסקי דין ספציפיים (PDF).
          אני אנתח אותם ואשלב אותם בטקסט עם אזכורים מדויקים.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          className="border-amber-500/40 text-amber-100 hover:bg-amber-500/20"
        >
          <Upload className="w-3.5 h-3.5 ml-1.5" />
          העלאת מקורות זרים
        </Button>
      </div>
    </div>
  </div>
)}
```

### תזמון הצגת ה־banner
- מופיע **לפני** התחלת כתיבת פרק השוואתי (בשלב `outline_review` או בתחילת `writing` של פרק כזה).
- מתחבא אוטומטית ברגע שמשתמש העלה לפחות PDF אחד (`uploadedDocumentTexts.length > 0`).
- ה־detection (`isComparativeChapter`) משתמש באותו regex שהוצע: `/משווה|מודלים השוואתיים|ארצות הברית|אנגליה|קנדה|אוסטרליה|גרמניה|comparative|international/i` על שם הפרק.

## מה לא משתנה
- כל שאר התיקונים ב־plan המאושר (timeout 30s, retry, caselaw guard, validator מחמיר, prompt reinforcement, dropped_footnotes_count) נשארים כפי שאושרו.
- ה־upload flow עצמו לא משתנה — משתמשים ב־`fileInputRef` הקיים של ה־wizard.

## תוצאה
משתמש שכותב פרק השוואתי יראה הודעה כנה ומדויקת על מצב המקורות, ויקבל CTA ישיר להעלאת PDFs במקום הצעה גנרית.

