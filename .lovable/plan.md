**Goal**

Stop hallucinated publication metadata (e.g. `פ"ד נז 560 (2003)` for `ע״א 158/77 רבינאי נ׳ מן שקד`) caused by Takdin-lite snippet noise leaking into Perplexity output, and add a verification gate on the party-search branch.

**Root causes (confirmed from logs)**

1. Party-search returned `padi_volume=נז`, `padi_page=560`, `year=2003` for a 1977 docket. The 26-year gap between the `/77` docket and `2003` year is a clear hallucination signal that is currently ignored.
2. `lite.takdin.co.il` is in `search_domain_filter`. Its result pages mix metadata from neighboring cases, so the model picks up wrong volume/year tokens.
3. Unlike the case-number branch, the party-search branch in `supabase/functions/citation-chat/index.ts` does not call any verification step before trusting `padi_volume / padi_page / year`.
4. The Perplexity system prompt encourages filling `padi_*` fields rather than leaving them missing, so the model invents values when the snippet is ambiguous.

**Implementation plan (single edge function, no schema changes)**

Edit `supabase/functions/citation-chat/index.ts` only.

1. Add a docket↔year sanity check
   - Parse trailing 2-digit year from `caseNumber` (e.g. `158/77` → `1977`, with `/2x` → `20xx`).
   - Mark a result as `suspect` when:
     - `Math.abs(year - docketYear) > 3`, OR
     - `isPublished === true` but `date` is empty, OR
     - `padi_volume` present but `padi_page` missing (or vice versa).

2. Extract a shared `verifyPadiPublication(caseType, caseNumber)` helper
   - Reuse the existing case-number-branch verification logic (the one that calls `case-law-search` / nevo-style lookup).
   - Returns `{ verified: boolean, padi_volume?, padi_part?, padi_page?, date?, year?, source_url? }`.

3. Gate the party-search branch on verification
   - After Perplexity returns the party-search result, if the result is `suspect` OR has no trusted `source_url`, call `verifyPadiPublication`.
   - If verification confirms different values → replace `padi_*`, `date`, `year` with verified values.
   - If verification fails → strip `padi_*` and set `isPublished = false` with `databaseName` kept (or `[חסר: פרסום בפ"ד]` placeholder); never emit fabricated `פ"ד` data.

4. Trusted-domain allowlist for skipping verification
   - Only treat publication fields as trusted without secondary verification when `source_url` is on:
     `nevo.co.il`, `supreme.court.gov.il`, `court.gov.il`, `psakdin.co.il`.
   - `lite.takdin.co.il` and `takdin.co.il` are explicitly NOT trusted for `padi_*` fields (they remain trusted for `party1/party2/caseType/caseNumber/databaseName`).

5. Tighten the Perplexity prompts (system + user) for party search
   - Forbid inventing `padi_volume` / `padi_page` / `year` from Takdin-lite snippets.
   - Require: if exact `פ"ד` publication is not visible in a single trusted source, return `padi_volume=""`, `padi_page=""`, `isPublished=false`, and (if known) the `databaseName`.
   - Require `source_url` per result; results without it must omit publication fields.
   - Keep the existing `[חסר: תאריך]` rule when `date` is empty.

6. Logging
   - Log the suspect flag, docketYear vs year, source_url, and whether `verifyPadiPublication` ran and what it returned.

7. Memory
   - Update `mem://logic/case-disambiguation-relevance` with:
     - Takdin-lite is search-only for parties; never trusted for `padi_*`.
     - Party-search must run `verifyPadiPublication` whenever a result is suspect or lacks a trusted `source_url`.
     - Hallucinated publication fields are stripped, never displayed.

**Expected behavior after the fix**

- `רבינאי נגד מן שקד` → returns `ע״א 158/77 רבינאי נ׳ חברת מן שקד בע״מ` with verified `פ"ד` values from a trusted source, or with `[חסר: פרסום בפ"ד]` if verification cannot confirm — never the wrong `פ"ד נז 560 (2003)`.
- `סע״ש קמיקר` flow keeps working (Takdin still used for parties/caseType/docket).
- No regressions on the case-number branch (uses the same extracted helper).