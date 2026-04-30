I found why this can still appear as “book” even though the backend now detects the query as case law: the frontend source-type badge and the prompt sent to the AI can still carry the earlier “ספר” classification, and when the backend later discovers case-law data it only rewrites the label in some cases. The book search itself is not running in the latest logs, but the model/UI can still be guided/displayed as book.

**Plan**

1. **Make case-law detection authoritative before the frontend labels the source**
   - In `src/data/abbreviations.ts`, add a shared “case-law signal” helper that recognizes:
     - all Israeli procedure prefixes, including `סע"ש`, `ס"ק`, `ד"מ`, `עת"מ`, etc.
     - prefixes with typographic quotes (`סע״ש`) and quote-less user input (`סעש`)
     - party separators: `נ'`, `נ׳`, `נגד`, and bare ` נ `
   - Run this before the book heuristic so `סע״ש קמיקר נ מדינת ישראל ורשות האוכלוסין וההגירה` is labeled `פסיקה (מאגר)` in the UI from the start.

2. **Mirror the same legal-signal set in input validation**
   - Update `src/lib/citationInputValidation.ts` and the server-side validator in `supabase/functions/citation-chat/index.ts` so lower/labor-court prefixes like `סע"ש` are treated as legal markers consistently.
   - This avoids any “generic Hebrew title” path for labor-case queries.

3. **Force backend prompt classification when backend detects case law**
   - In `supabase/functions/citation-chat/index.ts`, after backend `isCaseLaw` is true, strip any stale client-supplied book engine block and replace it with a case-law label/engine hint before the final AI call.
   - If the Perplexity case search returns one result with a database/date, force `[סיווג אוטומטי: פסיקה (מאגר)]` and Rule 19 instructions.
   - If the returned result lacks real פ"ד volume/page data, do not let `isPublished: true` with `"לא צוין"` switch it to printed case-law; keep it as database case-law.

4. **Do not show “ספר” in the result badge when backend corrected the route**
   - Return a lightweight `sourceTypeOverride` from `citation-chat` when the backend overrides the label to case law.
   - Update `src/pages/Index.tsx` to use that override for `messageSourceTypes`, citation history, and the badge shown above the assistant response.

5. **Add guardrails for disambiguation selections**
   - When a clicked option is sent as `[בחירת תוצאה]`, force frontend detection to `case_law_database` even if the selected line lacks a docket number or includes markdown/bold formatting.
   - Keep the direct-click behavior, but ensure the source badge and prompt are never `ספר` for selected case-law options.

**Expected result**

For inputs like:

`סע״ש קמיקר נ מדינת ישראל ורשות האוכלוסין וההגירה`

and for clicking returned options, the UI should display `פסיקה (מאגר)`, the backend should use Rule 19/case-law prompts, and the AI should no longer output or display the request as a book.