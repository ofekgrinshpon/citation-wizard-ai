## Goal

Reduce flaky "1st call empty, 2nd call perfect" symptom on Supreme Court dockets (e.g. `ע"א 9308/20`, `ע"פ 4596/98` run 1) by (a) pointing Perplexity at the official Supreme Court full-text search and (b) auto-retrying once on empty.

## Changes

### 1. Add Supreme Court fullsearch hint

Both case-law system prompts already mention takdin-lite. Add a parallel line right after it:

> טיפ חיפוש נוסף לתיקי בית המשפט העליון (ע"א/ע"פ/בג"ץ/דנ"א/דנ"פ/רע"א/רע"פ/בש"א/בש"פ וכו'): ב-`https://supreme.court.gov.il/Pages/fullsearch.aspx` ניתן לחפש לפי מספר תיק ולקבל את פסק הדין הרשמי עם שמות הצדדים, תאריך וכרך פד"י. הצלב את הנתונים שם.

Domain `supreme.court.gov.il` is already in `search_domain_filter`, so no allow-list change.

### 2. Single auto-retry on empty first pass

If the first Perplexity call returns `{"found": false}` or empty `search_results[]`, fire the **same** request once more before returning. If retry also empty, return `found: false` as today.

Log `[case-law] empty first pass, retrying…` so we can see in logs how often it fires.

## Files

- `supabase/functions/case-law-search/index.ts` — prompt edit (~line 85) + wrap the first Perplexity call (~lines 73–117) in a `for (let attempt = 0; attempt < 2; attempt++)` loop that breaks on non-empty result
- `supabase/functions/citation-chat/index.ts` — same prompt edit (~line 1086) + same retry wrap in the case-law branch (~lines 1078–1118)

## Out of scope

- No new domains in `search_domain_filter`
- No changes to date-verify, party-search, or legislation/regulations/books/articles branches
- No more than one retry

## Verification

Re-run `ע"א 9308/20` and `ע"פ 4596/98` several times each. Expect resolution on first user-visible attempt. Logs should occasionally show the retry firing and succeeding.
