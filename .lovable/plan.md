## מטרה
לוודא ש-365 מסמכי `supreme_court_il` שנקלטו לאחרונה יהיו ברי-חיפוש סמנטי, אבל בלי לבזבז קוורידות OpenAI על כרכים שלמים (33MB), תוכן עניינים, ועמודי פתיחה — שהם רעש ולא פסקי דין.

## שלב 1 — ניקוי DB (מיגרציית data)

מחיקת 63 מסמכים שאינם פסקי דין בודדים + ה-chunks שלהם:

- 21 × "הכרך המלא" (≈33MB טקסט מצטבר)
- 21 × "תוכן הענינים"
- 21 × "עמודי פתיחה"

```sql
DELETE FROM legal_document_chunks
WHERE document_id IN (
  SELECT id FROM legal_documents
  WHERE source_type = 'supreme_court_il'
    AND (title LIKE '%הכרך המלא%'
      OR title LIKE '%תוכן הענינים%'
      OR title LIKE '%עמודי פתיחה%')
);

DELETE FROM legal_documents
WHERE source_type = 'supreme_court_il'
  AND (title LIKE '%הכרך המלא%'
    OR title LIKE '%תוכן הענינים%'
    OR title LIKE '%עמודי פתיחה%');
```

נשארים **302 פסקי דין בודדים** (≈32MB טקסט).

## שלב 2 — הפעלת Batch Embedding על מה שנשאר

הפאנל הקיים `BatchEmbeddingPanel` (Admin → "🧬 יצירת Embeddings") מעבד **כל** chunk שאין לו embedding, ללא תלות ב-`source_type`. אחרי הניקוי הוא יטפל אוטומטית בכל ה-chunks של 302 הפסקי-דין שנותרו.

**אופן הפעלה:**
1. להיכנס לעמוד Admin
2. ללחוץ "▶️ הפעל Batch Embedding"
3. הפאנל ירוץ בלופ אוטומטי (500 chunks לכל אצווה, 50 לסאב-באטץ' של OpenAI) עד שיגמרו

**אומדן:** לאחר שלב 1 צפויים ~כמה אלפי chunks (במקום 51,544); ההרצה תיקח דקות בודדות.

## הערה
ה-`source_type` נשאר `supreme_court_il`. אם תרצה שהמסמכים האלה יוצגו ב-retrieval של מצב caselaw, נצטרך גם `UPDATE source_type='caselaw'` — אבל זה החלטה נפרדת ולא נכלל בתכנית הזו.
