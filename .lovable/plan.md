**Plan**

I found two separate issues behind this behavior:

1. The backend already detects the input as case law in the logs, but if the party-name web search returns no results, the final AI call can still see stale/insufficient classification context and answer using the old “book” pattern.
2. When you manually switch the source to case law, the reclassification prompt does not include the same case-law search/routing path as a normal send, so it can re-run the AI with “case law” wording but without the dedicated case-law lookup logic.

**What I’ll change**

1. **Make case-law classification authoritative before the AI prompt**
   - In `supabase/functions/citation-chat/index.ts`, whenever `isCaseLaw` is true, force the last user message to contain:
     - `[סיווג אוטומטי: פסיקה (מאגר)]` or `[סיווג אוטומטי: פסיקה (דפוס)]` when appropriate.
     - the Rule 19/Rule 18 citation-engine hint.
   - Strip any stale book/literature engine hint from the prompt before the AI sees it.
   - Explicitly block `bookHint` and article/literature branches for case-law signals.

2. **Fix party-name case-law search for inputs like `סע״ש קמיקר נגד מדינת ישראל ורשות האוכלוסין וההגירה`**
   - Clean the search query so the procedure prefix (`סע"ש`) is not treated as party 1.
   - Normalize `נ`, `נ׳`, `נ'`, and `נגד` consistently.
   - Add an alternate focused search query that includes the prefix as a court/type constraint but searches the real parties, e.g. `קמיקר נגד מדינת ישראל ורשות האוכלוסין וההגירה`.
   - If external search still returns no result, return a case-law shaped citation with `[חסר: ...]` fields instead of allowing the AI to turn it into a book.

3. **Make manual “change source to case law” use the same pipeline**
   - In `src/pages/Index.tsx`, when the user chooses `פסיקה (מאגר)` or `פסיקה (דפוס)` from “שינוי מקור”, resend through the normal backend flow with a hard correction tag, not a lightweight reclassification prompt.
   - Apply the backend `sourceTypeOverride` after reclassification too, so the UI badge updates correctly.
   - Store history using the effective source type rather than the original wrong `ספר` label.

4. **Improve frontend detection consistency**
   - Extend `src/data/abbreviations.ts` and `src/lib/citationInputValidation.ts` so labor-court prefixes (`סע"ש`, `סעש`, `ס"ק`, `ד"מ`, etc.) and bare ` נ ` separators are recognized everywhere before book heuristics.
   - Extend `MessageBubble`’s case-law fallback regex to include labor-court prefixes so the UI treats those outputs as case-law messages.

5. **Add targeted debug logging**
   - Add concise logs showing final classification, whether a stale book hint was removed, and the exact party search query used. This will make the next failure diagnosable from the edge logs instead of guessing.

**Expected result**

- The same input should display as `פסיקה (מאגר)` rather than `ספר`.
- Switching source to case law should actually trigger case-law lookup/routing.
- If the case cannot be found by party names alone, the app should ask for a case number or produce a case-law citation with missing-field markers, not classify it as a book.