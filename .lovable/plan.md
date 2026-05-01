**Plan: Fix wrong date and "לא מזוהה" badge for case-law queries**

**Root cause analysis (from edge logs)**

For the query `סע"ש 50358-09-16 קמיקר נ' מדינת ישראל...`:

1. **First search** (case-law-search) → returned `date: ""` (only `year: "2016"`).
2. **Verification search** → `{"isPublished": false}` — no date.
3. **Date-recovery search** → `{"date": ""}` — also failed.
4. The AI then drafted the citation with no date and the frontend rendered the badge as **לא מזוהה**.

The screenshot the user shared earlier proves the date `19/10/2021` is plainly visible on the תקדין search-results card — Perplexity is just not extracting it.

There are two distinct bugs producing the symptom:

**Bug A — Date-recovery prompt is too generic.**
`citation-chat/index.ts` lines 1049–1057 use a prompt that talks abstractly about "search results" and tells the model not to refuse, but never tells it where the date actually is (the תקדין search-results card in `DD/MM/YYYY`). It also uses a free-form Hebrew query string which doesn't always pin the model to the correct page. As a result the model returns `{"date":""}` even when the date is right there.

**Bug B — Refusal path drops `sourceTypeOverride`.**
`citation-chat/index.ts` lines 1791–1801 short-circuit on `isRefusalResponseServer(content)` and return a JSON body with `content + refunded + refundReason` only — `sourceTypeOverride` is omitted. The frontend (`src/pages/Index.tsx`) then has nothing to override the client-side guess, and the badge falls back to "לא מזוהה". When the AI's draft is thin (because no date was recovered), this refusal heuristic can fire even though the system already knows it's case-law.

**Changes**

1. **Sharpen the date-recovery prompt (`supabase/functions/citation-chat/index.ts`, lines ~1045–1059)**
   - Switch the system prompt to explicitly describe the תקדין search-results card layout: parties in the title, court in parentheses inside the docket, full date in the corner of each card in `DD/MM/YYYY` format.
   - Tell the model NOT to open the case page or any PDF — the date is already on the search-results card.
   - Require it to convert `DD/MM/YYYY` to `DD.MM.YYYY` and return only `{"date":"DD.MM.YYYY"}`.
   - Tighten the user message to a precise URL-anchored query: `site:lite.takdin.co.il "<docket>"` plus party names, instead of free-form Hebrew.

2. **Always include `sourceTypeOverride` even on the refusal path (`citation-chat/index.ts`, lines ~1790–1801 and ~1806–1809)**
   - Compute the override label once, earlier (it's already known at this point because `caseLawOverrideLabel` and `isCaseLaw` are set well before the refusal check).
   - Include the same `sourceTypeOverride` field in the refusal-branch response body so the frontend badge stays "פסיקה (מאגר)" / "פסיקה (דפוס)" even when the model output was thin.

3. **Sanity-log the date-recovery query**
   - Add a single `console.log` of the exact docket + parties used for date-recovery so the next failure is diagnosable from the edge logs without guessing.

4. **No frontend changes required** — `lastSourceTypeOverrideRef` already consumes whatever the backend sends; once the backend always sends it, the badge will follow.

**Files touched**

- `supabase/functions/citation-chat/index.ts` (date-recovery prompt + refusal-branch response shape + one log line)
- Redeploy `citation-chat`.

**Expected result**

- Date `19.10.2021` (or whichever DD/MM/YYYY the תקדין card shows) is recovered and inserted into the case-law citation.
- The badge stays "פסיקה (מאגר)" instead of degrading to "לא מזוהה" even if the AI's prose answer is thin enough to look like a refusal.