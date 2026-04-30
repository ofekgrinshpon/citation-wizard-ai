# Make Perplexity follow through to the takdin case page when full date is missing

## What you reported

In אזכור אחיד you got back a citation flagged with `[חסר: תאריך מלא]` even though, when you opened the case manually on `lite.takdin.co.il`, the page clearly shows the full date in the `[DD.MM.YYYY]` format (e.g. `[19.10.2021]` in the screenshot you sent — סע"ש 50358-09-16).

## Root cause (most likely)

The current prompt tells Perplexity:

> "התחל תמיד מ-`https://lite.takdin.co.il/search-results?txtSearch=<docket>` — דף תוצאות זה הוא ציבורי וחושף בתקציר עצמו את שמות הצדדים, תאריך ההחלטה ובית המשפט … אין צורך לפתוח את המסמך המלא בתשלום."

That instruction was correct for **parties / court / docket prefix**, but the **search-results snippet often shows only the year** — the full `DD.MM.YYYY` date sits on the **individual case landing page** (the page in your screenshot), not on the results list. So Perplexity stops at the snippet, sees only a year, and reports the date as missing.

The case landing page on `lite.takdin.co.il` is also free / public — the only paywalled thing is the full PDF of the ruling. So we can safely tell Perplexity to follow through one more click.

## Plan — two prompt edits, no schema/code changes

### 1. `supabase/functions/case-law-search/index.ts` (single-docket lookup, used by אזכור אחיד single-case path and BatchFootnoteBuilder)

In the system prompt, replace the current "search-results page is enough" line with a two-step instruction:

- **Step 1**: hit `https://lite.takdin.co.il/search-results?txtSearch=<docket>` to identify the right case (parties, court, docket prefix).
- **Step 2**: if the snippet does **not** include a full `DD.MM.YYYY` date (only a year, or nothing), follow the result link to the individual case page on `lite.takdin.co.il` — that page exposes the decision date in `[DD.MM.YYYY]` brackets, free of charge. Only the full PDF is paywalled.
- Add an explicit reminder: "Do not return only a year if the full date is recoverable from the case page. Return `date` as `DD.MM.YYYY` whenever the case page shows it."

### 2. `supabase/functions/_shared/partyLookup.ts` (Stage-2 batch retry for chapter router)

Same two-step framing for the batch system prompt — the schema already has an optional `decision_date` field; we just need the model to actually populate it when the case page exposes it. The Stage-2 placeholder-emission policy stays as-is; the goal is to **reduce** how often we fall through to `[חסר: תאריך מלא]` in the first place.

## What this does NOT change

- No schema changes — `case-law-search` already returns `date: "DD.MM.YYYY"` and `partyLookup` already returns `decision_date`. We just push the model to fill it more often.
- No domain-filter changes — `lite.takdin.co.il` is already in `search_domain_filter` for both endpoints.
- No fallback ordering change — Nevo / supreme.court / takdin priority stays the same, and the existing `partyLookupRetry` placeholder logic remains the safety net.
- No client-side changes (`citationValidation.ts` / `citationEngine.ts` are untouched).

## Why this is the minimal fix

The symptom is specifically "Perplexity stopped one click short of where the date lives." We don't need new endpoints, scraping, or retries — we just need the prompt to stop telling it the snippet is sufficient when it isn't for the date field. The model already has the ability to follow links inside an allowed domain; it was being instructed not to.

## Validation

Re-run the same סע"ש 50358-09-16 query in אזכור אחיד after deploy. Expected: `date` comes back as `19.10.2021`, the `[חסר: תאריך מלא]` placeholder disappears, and the citation renders cleanly. Spot-check 2–3 more district / labor-court dockets where the search-results snippet is known to be year-only.

## Files touched on approval

- `supabase/functions/case-law-search/index.ts` — system-prompt block only
- `supabase/functions/_shared/partyLookup.ts` — system-prompt block only

Both functions get redeployed (`case-law-search`, `legal-qa`).

Approve and I'll make the two prompt edits and redeploy.