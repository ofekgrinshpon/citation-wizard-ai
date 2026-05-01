**What I found**

The backend is correctly recognizing `סע"ש 50358-09-16` as case law and the case-law search is running. The recent logs show:

- `isCaseLaw=true`
- `caseNumberMatch=סע"ש 50358-09-16`
- `overrideLabel=פסיקה (מאגר)`
- The generated citation is: `סע"ש 50358-09-16 ... (תקדין [חסר: תאריך מלא])`

So the issue is not that the backend still thinks this is a book. There are two separate failures:

1. **The date recovery still returns empty**
   - The first Perplexity lookup finds the parties and database, but returns `date:""`.
   - The focused date-recovery lookup also returns `{"date":""}`.
   - The current prompt asks the model to read Takdin result cards, but it still relies on the LLM search answer rather than a deterministic extraction path.

2. **The displayed/history source type is still saved as unknown/null**
   - The backend returns `sourceTypeOverride=case_law_database`, but `src/pages/Index.tsx` still saves `citation_history.source_type` from the original client-side value.
   - In the database, the last three `סע"ש 50358-09-16` entries have `source_type = null`, which is why the UI/history can show `לא מזוהה` even though the backend classified it as case law.

**Plan**

1. **Fix source-type persistence on the frontend**
   - In `src/pages/Index.tsx`, compute an `effectiveSourceType` using the backend override:
     - `lastSourceTypeOverrideRef.current ?? sourceType`
   - Use that effective value consistently for:
     - the assistant badge (`messageSourceTypes`)
     - `citation_history.source_type`
     - verified-source saving
     - activity logging
   - This should stop `source_type` being saved as `null` for backend-confirmed case-law queries.

2. **Add a backend post-processing safety net for case-law citations**
   - In `supabase/functions/citation-chat/index.ts`, after the AI response is produced, if the request is case law and the response lacks a full date, normalize the response to keep the case-law structure and preserve the `sourceTypeOverride`.
   - Ensure missing date is represented as `[חסר: תאריך מלא]`, not as a refusal/unknown source.

3. **Make Takdin date extraction deterministic instead of prompt-only**
   - Update the case-law date recovery path to use a direct search/results strategy before asking the LLM:
     - try the Perplexity Search API or a tightly scoped search query for `lite.takdin.co.il/search-results?txtSearch=<docket>`
     - inspect returned snippets/titles/URLs for `DD/MM/YYYY` or `DD.MM.YYYY`
     - require exact docket match before accepting a date
   - Only fall back to the current LLM date-recovery prompt if deterministic extraction fails.

4. **Remove stale contradictory Takdin instructions**
   - The main case-law search prompt still contains older instructions saying to follow the Takdin case link for the date.
   - Replace that with the correct instruction: use the Takdin search-result card first because the docket, parties, court and date are already visible there.

5. **Add diagnostic logs for the final payload**
   - Log the final `sourceTypeOverride`, whether a valid date was found, and what `source_type` the frontend is expected to persist.
   - This will make the next check conclusive instead of ambiguous.

**Expected result after implementation**

For `סע"ש 50358-09-16`:

- The source badge should show **פסיקה (מאגר)**, not `לא מזוהה`.
- History should save `source_type` as `פסיקה (מאגר)` or the equivalent case-law category, not `null`.
- If the Takdin card date can be extracted, the citation should include that full date.
- If the date cannot be extracted reliably, the citation should still remain classified as case law and display `[חסר: תאריך מלא]` rather than falling back to unknown/book behavior.