

# הטמעת כלל 25 (ערכים במילונים/אנציקלופדיות) וכלל 26 (עבודות אקדמיות) — ללא חיפוש Perplexity

## סיכום

הוספת שני סוגי מקור חדשים עם זיהוי אוטומטי, תבניות עיצוב, והנחיות ל-AI — ללא חיפוש Perplexity.

## שינויים

### 1. `src/data/abbreviations.ts`

- הוספת `'encyclopedia_entry'` ו-`'academic_work'` ל-`SourceType`
- הוספת `REQUIRED_FIELDS`, `SOURCE_TYPE_LABELS`, `RULE_REFERENCES`, `FIELD_LABELS` (workType, institution, courseName)
- הוספת זיהוי ב-`detectSourceType`:
  - `encyclopedia_entry`: `/מילון|אנציקלופד|ערך\s+"/`
  - `academic_work`: `/עבודת\s+גמר|חיבור\s+לשם|עבודה\s+סמינריונית|דוקטור.*תואר|מוסמך.*תואר|תזה|דיסרטציה/`

### 2. `src/data/citationEngine.ts`

**encyclopedia_entry** (כלל 25):
- נוסחה כמו מאמר בספר (24.11): `"{שם הערך}" {מחבר} **{שם המילון}** {עמוד} ({עורך} {שנה}).`

**academic_work** (כלל 26):
- נוסחה: `{מחבר} **{שם העבודה}** {הפניה} ({סוג העבודה}, {מוסד אקדמי} {שנה}).`
- עבודה בקורס: "בקורס {שם הקורס}" אחרי סוג העבודה

### 3. `supabase/functions/citation-chat/index.ts`

- הוספת שתי רשומות ל-`CITATION_TEMPLATES` עם נוסחאות, דוגמות ו-notes
- עדכון הפרומפט עם הנחיות לכללים 25 ו-26

### פריסה
Edge Function — deploy אוטומטי.

