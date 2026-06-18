## Two fixes in `supabase/functions/citation-chat/index.ts`

### 1. Kill the "העוזר המשפטי מבין/מזהה ..." preamble

The model still opens answers with a persona sentence because the system prompt tells it to refer to itself by name ("העוזר המשפטי האוטומטי") and the "forbidden phrasing" example actually *uses* the phrase, which reinforces it.

**Changes to `SYSTEM_PROMPT`:**
- Remove the two instructions telling the model to call itself "העוזר המשפטי האוטומטי" (in the persona section and in סגנון תקשורת).
- Replace the "פלט שגוי" example so it no longer literally contains the forbidden sentence (the model parrots examples). Use a generic placeholder description instead of a quoted bad sentence.
- Add an explicit rule: "אסור לפתוח את הפלט במשפט הסבר/זיהוי/הקדמה כלשהי. הפלט חייב להתחיל ישירות באזכור עצמו."

**Server-side safety net (post-processing):**
Before returning the assistant reply, strip any leading line that matches `/^\s*(העוזר המשפטי[^\n]*|המערכת[^\n]*מזהה[^\n]*|מכיוון שמדובר[^\n]*)\n+/` (one pass, only at the very start). This guarantees a clean opening even if the model regresses.

### 2. Cross-type biblio fallback so "שחר ליפשיץ שלילת אבהות כהסכמה" works

Today the branches are siloed: pick "ספר" → only `bookSearchQuery` runs; if Perplexity returns `{found:false}` (as in the logs), the user gets nothing actionable. Same for "מאמר". The query above is genuinely a chapter-in-book, so neither branch alone reliably finds it.

**Changes:**

a. **Book branch — fallback to article-style search.** When the book Perplexity call returns `{found:false}` *or* the title-anchor gate drops everything, immediately run the article search prompt (journal OR article-in-book schema) on the same `bookQuery`. If that hits and anchors, build the article hint instead of the book hint.

b. **Article branch — fallback to book-style search.** Symmetrically: when the article call returns `{found:false}` *or* the anchor gate fails, run the book search prompt; if it hits and anchors, build a book hint.

c. **Generic biblio classifier as the fallback prompt.** Instead of duplicating the existing prompts, add one helper `searchBiblioAny(query)` that asks Perplexity (sonar-pro, open web) to return one of:
   ```json
   {"found":true,"kind":"journal|article_in_book|book","author":"...","title":"...","journalName":"...","bookTitle":"...","bookAuthor":"...","volume":"...","firstPage":"...","year":0,"hebrewYear":"...","editor":"..."}
   ```
   Reuse the existing title-anchor + `verifyBiblioAuthor` guardrails on the result. Each branch calls this helper as its fallback and routes the result into the matching `bookHint` / `articleHint` formatter (the article-in-book formatter already exists at ~line 2608).

d. **Telemetry:** log `[book] fallback=article hit=true/false` and `[article] fallback=book hit=true/false` plus the chosen `kind`.

### Out of scope
- Caselaw, legislation, regulation branches.
- Client-side classifier UI (no change to how the user picks "ספר" vs "מאמר" — the fallback runs server-side after the chosen branch fails).
- The `[חסר: ...]` rendering and rule-24.7.1/24.9 warnings (those are correct behavior when data is genuinely missing).

### Verification
- Re-run `שחר ליפשיץ שלילת אבהות כהסכמה` as ספר → expect logs `[book] found=false → fallback=article` and a populated chapter-in-book citation.
- Re-run same query as מאמר → expect `[article] found=false → fallback=book` with the same final citation.
- Re-run any caselaw query → unchanged.
- Confirm replies no longer start with "העוזר המשפטי מבין/מזהה ...".
