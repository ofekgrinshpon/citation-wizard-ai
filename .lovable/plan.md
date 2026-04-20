
## Goal
Fix the `סיכום פסיקה` flow so a case like `18225-06-25` does not fall through to the upload-refusal when the court file is actually reachable.

## What I found
- The current refusal is expected from the latest logs:
  - `verify-case-fulltext: external DOCX (0 chars ...)`
  - `DOCX extraction failed: invalid zip data`
  - then `verify-case-fulltext: not found`
- So the system is reaching the court URL, but the response being fetched is not the real DOCX payload that `fflate` expects.
- There is a second weakness: `extractCaseNumber()` only recognizes prefixed/slash-style numbers like `בג"ץ 1234/05`, so a raw input like `18225-06-25` likely skips the local DB match entirely and relies on the flaky external path.

## Plan

### 1. Harden court-file fetching in `verify-case-fulltext`
Update `supabase/functions/verify-case-fulltext/index.ts` to fetch court download URLs with the same browser-like headers already used successfully in `apify-ingest-cases`:
- `User-Agent`
- `Accept`
- `Accept-Language`

Then add response validation before DOCX extraction:
- inspect `content-type`
- inspect `content-disposition`
- if a `type=4` court URL returns HTML/redirect/interstitial instead of a real DOCX, treat it as a failed fetch and try fallback handling instead of unzipping garbage

### 2. Add a resilient court-download fallback path
For Supreme Court `Download?...type=4` URLs:
- detect when the first fetch does not yield a valid DOCX
- retry with stricter headers / redirect-aware handling
- only run `extractDocxText()` after confirming the response looks like an actual DOCX/ZIP payload
- log the exact reason for rejection (`html interstitial`, `wrong content-type`, `empty buffer`, `invalid zip`) so this is debuggable next time

### 3. Normalize case numbers so local matching works for `18225-06-25`
Improve `extractCaseNumber()` (or add a small normalizer beside it) so bare hyphenated numbers can map to the DB-friendly canonical form:
- `18225-06-25` → `18225/06`
- keep existing support for prefixed/slash-style inputs
- use the normalized value in the local DB lookup before external retrieval

This should reduce unnecessary external fetches for users who paste procedural numbers directly.

### 4. Keep the strict refusal rule intact
Do not loosen the prohibition.
If after normalization + stronger fetch handling there is still no usable full text, keep returning the exact upload/refusal message.

### 5. Validate the case-summary path end-to-end
After implementation, verify that:
- entering `18225-06-25` can hit local or external full text successfully
- `verify-case-fulltext` returns real text, not `0 chars`
- `legal-qa` produces a structured summary instead of refusal
- the existing structured `CaseSummaryReport` still renders with the source badge

## Files to update
- `supabase/functions/verify-case-fulltext/index.ts`
- possibly `supabase/functions/legal-qa/index.ts` only if a tiny normalization helper is also needed there, but most of the fix belongs in `verify-case-fulltext`

## Technical notes
- Root bug is not the summary prompt; it is retrieval.
- `apify-ingest-cases` already shows the winning fetch pattern for court DOCX files, so I’d align `verify-case-fulltext` with that implementation instead of inventing a new extraction strategy.
- The current Hebrew-ratio guard is good and should stay; it is correctly preventing hallucinated summaries from broken binary fetches.

## Expected outcome
A user who enters `18225-06-25` should no longer get an upload refusal merely because the court download response was fetched incorrectly. If the judgment text is truly available, the app should generate the structured case summary; if not, it should still refuse cleanly.
