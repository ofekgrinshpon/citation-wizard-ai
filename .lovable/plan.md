

## Fix: Add relevance filtering instruction to prevent irrelevant source citations

### Problem
The keyword-based retrieval (OR logic) returns sources with superficial keyword overlap (e.g., "ראש הממשלה") even when the legal topic is completely different. The AI then cites these irrelevant sources instead of ignoring them.

### Solution
Add an explicit instruction in the system prompt telling the AI to evaluate source relevance before citing, and to skip sources that don't substantively relate to the legal question.

### Changes

**File: `supabase/functions/legal-qa/index.ts`** — Add a new critical rule after the source priority block (~line 504):

```
כלל קריטי – רלוונטיות מקורות:
- לפני שאתה מצטט מקור כלשהו, בדוק שהוא רלוונטי מהותית לשאלה המשפטית. התאמה במילות מפתח (למשל "ראש הממשלה") אינה מספיקה — המקור חייב לעסוק באותה סוגיה משפטית.
- אם מקור מהרשימה עוסק בנושא אחר לחלוטין (למשל: השאלה עוסקת בחנינה, והמקור עוסק במינויים), אל תצטט אותו כלל, גם אם הוא מסומן [מאומת].
- עדיף לצטט פחות מקורות רלוונטיים מאשר להוסיף מקורות שאינם קשורים לנושא.
```

### Technical details
- Prompt-only change, no code logic changes
- Redeploy Edge Function `legal-qa`

