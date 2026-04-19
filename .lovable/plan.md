
## Problem
The recovery loop is likely not just “doing badly” — it is probably **stuck reprocessing already-broken placeholder docs**.

Why:
- `recover-knesset-titles` currently fetches rows with only `source_type='knesset_research'` and `title='פרטי מסמך'`.
- When a doc is flagged broken, its `title` stays `פרטי מסמך`.
- So those same docs remain eligible forever.
- The function’s `remaining` count uses the same loose filter, so the admin loop keeps thinking there is more work.
- Result: very low success count, inflated broken count, and a process that may never naturally finish.

## Plan

### 1) Fix the recovery queue definition
Update `supabase/functions/recover-knesset-titles/index.ts` so “pending recovery” means:
- `source_type='knesset_research'`
- `title='פרטי מסמך'`
- `metadata.broken_title != true`
- `metadata.recovered_title != true`

Also make the batch deterministic with an `order(...)` so it walks forward consistently.

### 2) Fix the completion logic
Use the **same pending filter** for the `remaining` count.
That way:
- already-broken docs are excluded from future attempts
- the loop can actually reach `remaining = 0`
- the admin panel reflects real progress instead of retry noise

### 3) Make broken docs one-time terminal results
When extraction fails:
- keep `broken_title=true`
- keep the placeholder title
- do not try that doc again automatically

Optionally store a small failure reason/method in metadata so we can later distinguish:
- scrambled OCR
- no valid title candidate
- invalid date/boilerplate line

### 4) Improve admin progress reporting
Update `src/components/admin/BatchEmbeddingPanel.tsx` so the recovery area shows:
- recovered this run
- newly flagged broken this run
- pending remaining

And stop the loop based on the corrected pending count.
Add a clearer note that previous counters may have included repeated attempts before this fix.

### 5) Validate output quality, not just throughput
After the fix, QA the current recovered docs and future recoveries:
- sample the 8 already recovered docs
- confirm citations follow Rule 23.11 format:
  `AUTHOR TITLE (הכנסת, מרכז מחקר ומידע YEAR).`
- if any of those 8 are malformed, reset only those rows and let them be retried under the fixed queue logic

### 6) Re-run recovery cleanly
Once patched:
- re-run from the admin panel
- expect the process to end normally
- expect broken count to represent unique docs, not repeated retries
- recovered docs should remain citeable; broken docs stay filtered out of Legal QA

## Technical notes
- No schema change is needed.
- Main files:
  - `supabase/functions/recover-knesset-titles/index.ts`
  - `src/components/admin/BatchEmbeddingPanel.tsx`
- `legal-qa` filtering for `broken_title` already exists and should remain.

## Expected result
- The recovery job stops looping over the same broken docs.
- “Remaining” becomes meaningful.
- The process finishes.
- Recovered Knesset docs can still be used with proper Rule 23.11 citations.
- Broken docs remain excluded instead of wasting more recovery attempts.
