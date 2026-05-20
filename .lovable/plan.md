## Goal

Fix wrong dates (e.g. `27.07.2022` instead of real `13.02.2023` for `ע"א 9308/20`) by being strict about **where** Perplexity is allowed to pull the decision date from when the only source is another judgment that mentions this case.

## Two changes (in order)

### 1. Auto-retry once on empty `sonar-pro` response

In `supabase/functions/citation-chat/index.ts` (case-number branch, ~line 1077–1102) and mirror in `case-law-search/index.ts`:

If the first call returns `search_results.length === 0` or `parsed.found === false`, retry **once** with a slightly reworded query that hints `lite.takdin.co.il/search-results`. Log `[case-law] retry attempt 2`. No further retries.

Eliminates the "tried many times" friction.

### 2. Strict adjacency rule for dates pulled from other judgments

This is the key change. Update the **first-call extraction prompt** (around line 1097 in `citation-chat`, mirror in `case-law-search` ~line 95) to encode the user's rule explicitly:

> כלל לחילוץ תאריך פסק דין:
>
> 1. **המקור המועדף** הוא עמוד התיק עצמו במאגר (נבו / תקדין / פסקדין / supreme.court.gov.il). אם מצאת שם תאריך — קח אותו וסיים.
>
> 2. אם התיק מוזכר **בתוך פסק דין אחר** (או בכל מסמך שאינו עמוד התיק עצמו), מותר לקחת את התאריך **רק אם הוא מופיע צמוד לאזכור התיק בפורמט המקובל**, כלומר:
>    `[סוג תיק] [מספר]/[שנה] [שם צד א] נ' [שם צד ב] (DD.MM.YYYY)`
>    הסוגריים חייבים להופיע **מיד אחרי שמות הצדדים של התיק הספציפי הזה**, באותה שורה, ללא משפט מפריד.
>
> 3. **אסור** לקחת תאריך:
>    - מדף ריכוז / רשימת תיקים שמכיל מספר תאריכים שונים;
>    - ממשפט תיאורי כמו "נדון בעניין X" או "ראו פסק דין מ-DD.MM.YYYY";
>    - מהקשר של פסק דין אחר שמצטט תאריך משלו ולא של התיק המבוקש.
>
> 4. אם אף אחד מהמקורות אינו עומד בכללים האלה — החזר `"date":""` ו-`"year":""`. אל תנחש.

This is the **upstream** fix. For `ע"א 9308/20`, the only source was a takdin aggregator listing many cases with many dates — Rule 3a applies, Perplexity should now return empty rather than `27.07.2022`.

### 3. Unpublished date-verify safety net (downstream)

Extend `verifyDecisionDate`/`reconcilePublishedDate` (lines 70–173 of `citation-chat/index.ts`) to also cover **unpublished** cases. Currently the safety net only fires for `isPublished && padi_volume`.

Add `verifyUnpublishedDecisionDate(caseType, caseNumber, party1, party2)` that re-asks Perplexity with the **same strict adjacency rule** as above, anchored on case number + parties. Reconciliation:

- Verified date matches original → keep, `confidence: high`.
- Verified date differs and has `confidence: high` → override, log the swap.
- Verifier returns empty (no source met the adjacency rule) → **clear** `date`/`year`, set `confidence: low` so the AI emits `[חסר: תאריך]` instead of a wrong day.

For `ע"א 9308/20` this is the second line of defense: even if the first call slipped a date through, the verifier — applying the same strict rule — would clear it.

## Out of scope

- Wikipedia verifier (strict adjacency rule should make it unnecessary).
- Changes to party-name extraction, publication checks, or `search_domain_filter`.
- Touching legislation/regulations/books/articles paths.

## Files

- `supabase/functions/citation-chat/index.ts` — retry helper, strict adjacency in extraction prompt, extended date-verify.
- `supabase/functions/case-law-search/index.ts` — mirror all three changes (manual-entry path).

## Telemetry

- `[case-law] retry attempt 2`
- `[case-law] date cleared by adjacency rule` (when first call returns empty date because no source qualified)
- `[case-law] unpub date-verify: original=... verified=... action=keep|override|clear`
