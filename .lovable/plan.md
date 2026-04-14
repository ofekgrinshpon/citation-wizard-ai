

## עדכון 67 רשומות Supreme Decisions נוספות ל-caselaw

### מה נמצא
- 506 רשומות כבר עודכנו ל-`caselaw` בפעולה הקודמת
- 67 רשומות נוספות עם `supremedecisions` ב-URL עדיין מסווגות כ-`knesset_research`

### SQL
```sql
UPDATE legal_documents
SET source_type = 'caselaw'
WHERE (source_url LIKE '%supremedecisions%' OR pdf_url LIKE '%supremedecisions%')
  AND source_type != 'caselaw';
```

### פרטים טכניים
- שינוי נתונים בלבד, ללא שינוי סכמה
- 67 שורות יושפעו

