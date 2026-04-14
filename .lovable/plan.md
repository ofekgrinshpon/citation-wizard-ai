

## מחיקת מסמכי "הפרקליט" מהמסד

### מה נמצא
- 157 רשומות ב־`legal_documents` שבהן `source_url` או `pdf_url` מכילים `hapraklit`
- יש גם chunks תלויים ב־`legal_document_chunks` שצריך למחוק קודם (FK constraint)

### מה אעשה
אריץ migration אחת עם שתי פקודות:

```sql
-- First delete dependent chunks
DELETE FROM legal_document_chunks
WHERE document_id IN (
  SELECT id FROM legal_documents
  WHERE source_url LIKE '%hapraklit%'
     OR pdf_url LIKE '%hapraklit%'
);

-- Then delete the documents
DELETE FROM legal_documents
WHERE source_url LIKE '%hapraklit%'
   OR pdf_url LIKE '%hapraklit%';
```

### קבצים מושפעים
- אין שינויי קוד, רק migration למסד הנתונים

