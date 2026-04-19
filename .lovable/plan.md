

## Plan — Improve local recall in `legal-qa`

Single file change: `supabase/functions/legal-qa/index.ts`

### 1. Semantic query expansion (new pre-step)
Before retrieval, if the user question is **< 5 words OR < 25 chars**, call Lovable AI Gateway (`google/gemini-2.5-flash-lite`, fast/cheap) with a tight prompt:

> "הרחב את השאלה המשפטית הבאה למשפט תיאורי פורמלי אחד (עד 25 מילים), הכולל מונחים משפטיים מלאים במקום קיצורים. החזר רק את המשפט המורחב."

Use the expanded sentence **in addition to** the original for embedding + keyword search. Both queries' results are merged and de-duped before re-rank.

Failure handling: if expansion call fails or times out (>3s), fall back to original query only — never block retrieval.

Log: `Query expansion: "<orig>" → "<expanded>"`.

### 2. Hebrew abbreviation expansion in `extractKeywords` (append, don't replace)
Add a static map of ~20 high-frequency legal abbreviations:

```
יועמ"ש / יועמש / היועמשית → היועץ המשפטי לממשלה, היועצת המשפטית לממשלה
בג"ץ → בית המשפט הגבוה לצדק
בימ"ש → בית המשפט
ביה"ד → בית הדין
ע"א → ערעור אזרחי
ע"פ → ערעור פלילי
רע"א → רשות ערעור אזרחי
ס"ח → ספר החוקים
ק"ת → קובץ התקנות
תקנ' → תקנות
ועדת חוקה → ועדת חוקה חוק ומשפט
מ"י → מדינת ישראל
חו"י → חוק יסוד
פס"ד → פסק דין
ב"כ → בא כוח
פד"י → פסקי דין
```

Logic: detect each abbreviation in the question, **append** its full form to the keyword set (original abbreviation stays). This widens both the keyword search and gives more material for vector embedding.

### 3. Lower vector threshold + bump candidate count
- `match_legal_chunks` threshold: `0.70 → 0.55`
- `match_count`: `8 → 15` for both vector and keyword searches
- Final merged cap stays at 12 (after re-rank) to keep prompt size bounded

### 4. Neutral re-ranker
Update the re-rank prompt to be **source-type-blind**:

> "דרג כל מקור 0–10 לפי רלוונטיות תוכנית בלבד לשאלה. אל תתחשב בסוג המקור (פסיקה / מאמר / מחקר כנסת) — רק במידת העזרה שיתן בתשובה משפטית מקצועית."

Also: lower keep threshold from `≥5` to `≥4` to preserve background context.

### 5. Re-rank failure handling
Already shipped: when score parsing fails, fall back to raw similarity ≥ 0.5 (not "use all"). Confirmed in current code, no change needed.

### 6. Diagnostic logging
- `Keyword set (with expansions): [...]`
- `Vector search: top 3 raw similarities = [0.XX, 0.XX, 0.XX]`
- `Rerank scores per doc: {doc_id: score}`
- `Final source mix: <N> local / <M> perplexity`

## Expected impact
For "האם אפשר לפטר את היועמשית":
- Query expansion adds full legal phrasing → vector hits topical chunks
- Abbreviation map catches "היועמשית" → "היועצת המשפטית לממשלה"
- Lower threshold + more candidates → re-ranker has 15+ local cards to choose from
- Neutral re-rank → best answer wins regardless of source type
- Estimated local card count: 1 → 5–7

## Out of scope
- No DB schema changes, no re-embedding
- No client changes
- No prompt-to-AI changes for the answer itself (only for expansion + rerank)
- No changes to footnote matcher (already strict & accurate after previous fix)

## File changes
- `supabase/functions/legal-qa/index.ts` — items 1, 2, 3, 4, 6

