

## Fix: [NEW:] markers, hallucinated cross-references, and self-referencing footnotes

### Problems identified

1. **[NEW:...] in footnotes**: The prompt (line 464) instructs the AI to wrap non-listed sources as `[NEW:citation]`. These brackets leak into the parsed footnote text and appear in the output.

2. **Hallucinated "לעיל ה"ש" references**: A footnote references "לעיל ה"ש 2" but footnote 2 is a completely different source — the AI fabricates cross-references between unrelated citations.

3. **Self-referencing footnotes**: Footnote 7 says "לעיל ה"ש 7" — pointing to itself, which is logically impossible.

### Changes

**File: `supabase/functions/legal-qa/index.ts`**

**A. Remove [NEW:] marker system from prompt (~line 464)**

Replace:
```
- אתה יכול גם לכתוב אזכורים נוספים שאינם ברשימה, אם אתה בטוח לחלוטין שהם קיימים. סמן אותם כ-[NEW:אזכור מלא לפי כללי האזכור].
```
With:
```
- אתה יכול גם לכתוב אזכורים נוספים שאינם ברשימה, אם אתה בטוח לחלוטין שהם קיימים. כתוב אותם ישירות בחלק הערות השוליים בדיוק כמו כל הערה אחרת, ללא סימון מיוחד.
```

**B. Add prompt rule for correct "לעיל" usage (~after line 489)**

```
- כלל קריטי – שימוש נכון ב"לעיל ה"ש":
  * "לעיל ה"ש X" משמעותו: ראה את המקור שצוטט בהערת שוליים מספר X. הערה X חייבת להכיל את האזכור המלא של אותו מקור בדיוק.
  * אסור בשום מצב שהערה תפנה לעצמה (למשל הערה 7 לא יכולה לכתוב "לעיל ה"ש 7").
  * אסור שהערה תפנה להערה שמכילה מקור אחר לחלוטין. אם אינך בטוח מהו מספר ההערה הנכון — כתוב אזכור מלא במקום "לעיל".
```

**C. Post-processing: strip [NEW:] wrappers from footnotes (~after line 848)**

Add cleanup to strip residual `[NEW:...]` wrappers from both body and footnote text:
```typescript
// Strip [NEW:...] wrappers from footnotes
for (const fn of footnotes) {
  fn.citation = fn.citation.replace(/^\[NEW:\s*/, "").replace(/\]$/, "").trim();
}
// Strip any remaining [NEW:...] from body
answer = answer.replace(/\[NEW:[^\]]+\]/g, "");
```

**D. Post-processing: detect and fix self-referencing footnotes (~after step 7)**

Validate "לעיל ה"ש X" references: if X equals the footnote's own number, remove the back-reference phrase and keep the rest of the citation text.

### Technical details
- Prompt + post-processing changes in `supabase/functions/legal-qa/index.ts`
- Redeploy Edge Function `legal-qa`

