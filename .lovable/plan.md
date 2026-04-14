

## עדכון מסמכי Supreme Decisions ל-caselaw

### מה נמצא
- 506 רשומות ב-`legal_documents` עם `source_url` או `pdf_url` שמכילים `supremedecisions`
- כולן מסווגות כרגע כ-`knesset_research`

### SQL
```sql
UPDATE legal_documents
SET source_type = 'caselaw'
WHERE source_url LIKE '%supremedecisions%'
   OR pdf_url LIKE '%supremedecisions%';
```

### פרטים טכניים
- שינוי נתונים בלבד, ללא שינוי סכמה
- 506 שורות יושפעו

