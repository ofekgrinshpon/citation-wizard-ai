**Plan: Simplify Perplexity prompt — read date directly from תקדין search results page**

**Problem**

The current system prompt in `supabase/functions/case-law-search/index.ts` (lines 93–97) instructs Perplexity to perform a two-step flow on תקדין לייט: first identify the case on the search-results page, then **follow the link into the individual case page** to retrieve the full date in `[DD.MM.YYYY]` format.

The user has confirmed (with screenshot) that the תקדין search-results page itself already shows the full date (e.g. `19/10/2021`), the procedure prefix + case number (e.g. `סע"ש (תל אביב) 50358-09-16`), and the full party names directly in each result card. The "follow the link" step is unnecessary, slows the model down, and sometimes causes it to either return only a year or fail entirely.

**Change**

Rewrite the תקדין-related portion of the system prompt in `supabase/functions/case-law-search/index.ts` so that:

1. Perplexity is told the search-results page (`https://lite.takdin.co.il/search-results?txtSearch=<מספר התיק>`) already exposes everything needed: parties, court (from the prefix in parentheses), case number, and full date in `DD/MM/YYYY` or `DD.MM.YYYY` format.
2. Remove the two-step "שלב 1 / שלב 2" framing and the instruction to follow the link into the individual case page.
3. Keep the requirement that `date` be returned in `DD.MM.YYYY` format (normalize from `DD/MM/YYYY` if needed).
4. Keep the fallback to `nevo.co.il` and `supreme.court.gov.il` if תקדין doesn't have the case.
5. Leave everything else (JSON schema, party-name rules, domain filter, model `sonar`) unchanged.

**Files touched**

- `supabase/functions/case-law-search/index.ts` — replace the system prompt block (roughly lines 91–97).

**Expected effect**

Faster, more reliable date extraction: the model reads parties + date straight from the search-results card instead of navigating into the case page, which eliminates the "only year returned" failure mode.