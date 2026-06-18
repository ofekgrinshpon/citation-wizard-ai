## Use Gemini as a smarter source-type classifier

Replace the brittle regex heuristic that mis-tags `שחר ליפשיץ שלילת אבהות כהסכמה` as `book` with a Gemini-based classifier that runs before the existing branches. It will decide between caselaw / legislation / book / article / article-in-book / internet / etc., and the rest of the pipeline stays the same.

### Where the wrong decision happens today
- `src/data/abbreviations.ts → detectSourceType()` is regex-only. For bare bibliographic strings it falls into the "Hebrew name + 4 words → book" branch and locks the backend into the book search.
- The backend (`supabase/functions/citation-chat/index.ts`) trusts that tag (`[סיווג אוטומטי: ספר]`) and runs only the book Perplexity branch.
- The "שינוי מקור" UI sends `[תיקון סיווג: ...]`, which the backend does not currently read, so changing the source to "מאמר" never enters the article search branch.

### Plan

1. New edge function `classify-source` (Lovable AI Gateway, default `google/gemini-3-flash-preview`).
   - Input: `{ rawText: string }`.
   - System prompt: short Hebrew-language instruction listing the exact `SourceType` enum from `abbreviations.ts` and asking the model to pick one, plus a confidence and a one-line reason.
   - Output via AI SDK `Output.object` Zod schema:
     ```text
     { sourceType: SourceType, confidence: 0..1, reason: string }
     ```
   - No web search needed for classification — it's a typing decision, fast and cheap. (We keep Perplexity for the actual bibliographic lookup downstream.)

2. Frontend wiring in `src/pages/Index.tsx`.
   - Keep `detectSourceType()` as a fast pre-classifier.
   - Call `classify-source` in parallel for **ambiguous** cases only: result is `unknown`, OR result is `book`/`article`/`article_in_book` (the literature family that gets confused), OR the input has no strong markers (no case number, no חוק/תקנות/הצעת חוק/אמנה, no URL).
   - If Gemini's confidence ≥ 0.6 and it disagrees, use Gemini's `sourceType` for the `[סיווג אוטומטי: ...]` tag and the engine hint.
   - For caselaw / legislation / treaty / bill etc. with a strong regex signal, skip the LLM call (cheaper, and regex is already reliable there).

3. Backend tweaks in `supabase/functions/citation-chat/index.ts`.
   - Recognize both `[סיווג אוטומטי: ...]` and `[תיקון סיווג: המשתמש ציין שמדובר ב...]` everywhere `classMatch` is computed, so "שינוי מקור" actually routes to the right branch.
   - In the book branch, when Perplexity's response includes journal clues (`publisher` contains `כתב העת`, or `journalName`, or the source looks like an article), treat as unusable and trigger the existing `fallbackBiblioSearch(..., "article")`.

4. Validation alignment in `src/lib/citationValidation.ts`.
   - Add `inferSourceTypeFromCitation(line, fallback)` that detects a rendered article (quoted title + journal + volume + page + year) and validates against rule 24 instead of rule 23. Stops the false "missing rule 23 fields" warning when the engine output is already a correct article.

### Out of scope
- Touching caselaw / legislation / regulation branches in the backend.
- Re-rendering already-displayed citations automatically.
- Caching the classifier result across requests (can add later if cost matters).

### Verification
- `שחר ליפשיץ שלילת אבהות כהסכמה` → Gemini returns `article` (or `article_in_book`) with high confidence → backend runs the article Perplexity branch → expected output `שחר ליפשיץ "שלילת אבהות כהסכמה" משפטים נא(1) 231 (2021).` with no false warning.
- `ע"א 6821/93 בנק המזרחי נ' מגדל` → regex shortcut → unchanged.
- `חוק החוזים (חלק כללי), תשל"ג-1973` → regex shortcut → unchanged.
- Pressing "שינוי מקור → מאמר בכתב עת" on a book-misclassified result → backend now sees the corrected tag and runs the article branch.

### Cost note
Classifier call is ~1 short prompt per ambiguous query on `gemini-3-flash-preview` — fast and cheap; skipped entirely for queries with strong regex signals.