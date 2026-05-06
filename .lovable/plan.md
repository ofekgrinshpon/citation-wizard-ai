## Goal

Improve Perplexity grounding for case-law lookups by **explicitly hinting** that `lite.takdin.co.il/search-results` is a high-yield source for the exact fields we need (parties, date, court, docket).

This is a low-risk prompt + domain-filter tweak — no logic changes, no schema changes, no new dependencies.

## Why it helps

`lite.takdin.co.il/search-results?txtSearch=<docket>` returns a public snippet for almost every Israeli case that includes:

- Court + docket prefix (e.g. `תא (ראשון לציון) 13579-11-24`)
- Party 1 נ' Party 2
- Decision date

Today Perplexity is told it *may* use takdin.co.il, but is not pointed at the specific search endpoint. The model often lands on Nevo/court paywall pages with weaker snippets.

## Scope — exactly two edge functions

### 1. `supabase/functions/case-law-search/index.ts`

This function already calls `sonar` for a single docket lookup. Two surgical edits to the request body:

- Add `search_domain_filter: ["lite.takdin.co.il", "takdin.co.il", "nevo.co.il", "supreme.court.gov.il", "court.gov.il"]` so Perplexity prioritizes these.
- Append an explicit hint to the **system message**:
  > כאשר אתה מאתר תיק לפי מספר תיק, התחל מחיפוש ב-`https://lite.takdin.co.il/search-results?txtSearch=<מספר התיק>`. דף זה מכיל לרוב את שמות הצדדים, תאריך ההחלטה, ובית המשפט בתוצאת החיפוש עצמה — בלי צורך לפתוח את המסמך המלא.

No change to the JSON schema, parsing, or output shape.

### 2. `supabase/functions/_shared/partyLookup.ts`

Same two edits to the batch party-lookup call (`sonar-pro`):

- Extend the existing `TRUSTED_LEGAL_DOMAINS` list with `lite.takdin.co.il` (it's the public face of `takdin.co.il`, so the trust posture is identical).
- Add a one-line system-prompt hint pointing at `lite.takdin.co.il/search-results?txtSearch=<docket>` as the preferred starting point for each docket.

`TRUSTED_LEGAL_DOMAINS` is also imported by Stage E.5 URL-allowlist validation in `legal-qa`, so adding the host there means citations anchored on `lite.takdin.co.il` will survive the guard — desirable, since these are real takdin pages.

## Out of scope

- No HTML scraping of takdin from our side. The hint is purely instructional for Perplexity.
- No changes to citation engine, classification, or the React side.
- No change to `bibliography-lookup` (it handles books/articles, not case law).

## Risk

Minimal. Worst case: Perplexity ignores the hint and behaves as today. Best case: higher hit rate on `case-law-search.found = true` and fewer `OMIT`s in `partyLookup`.

## Validation

After deploy, spot-check 3–5 dockets via the existing `case-law-search` invocation in BatchFootnoteBuilder / PartyNameCheck and confirm:
- Returned `parties` / `date` / `court` populated more consistently.
- Edge function logs show Perplexity citations including `lite.takdin.co.il` URLs.

No memory update needed unless we later promote this into a documented architectural rule.
