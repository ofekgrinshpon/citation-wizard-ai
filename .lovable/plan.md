## Goal
Hint Perplexity, across every caselaw lookup in the platform, that **`lite.takdin.co.il/search-results`** is a high-yield source that exposes most fields we need for citation (parties, court, docket, decision date, פד"י publication info, judges).

## Why this helps
Today our Perplexity calls list trusted domains (`nevo.co.il`, `supreme.court.gov.il`, `takdin.co.il`, `psakdin.co.il`, …) but the prompts never tell the model that `lite.takdin.co.il`'s public search-results page already renders, on a single page, almost every metadata field we need (party names, docket, court, date, פד"י citation when published). Currently the model often goes to Nevo (paywall snippet) or Supreme Court PDFs and comes back with partial data → first-name hallucinations, missing פד"י volume, etc.

## Changes (all server-side, no UI work)

### 1. `supabase/functions/legal-qa/index.ts` — TRUSTED_LEGAL_DOMAINS
Add `lite.takdin.co.il` explicitly. (Subdomain is already covered by `takdin.co.il` for matching, but listing it explicitly in `search_domain_filter` strengthens Perplexity's preference for it.)

```ts
"takdin.co.il",
"lite.takdin.co.il",   // public, indexable search-results page — best metadata yield
```

### 2. `supabase/functions/_shared/partyLookup.ts`
- Add `lite.takdin.co.il` to `TRUSTED_LEGAL_DOMAINS` (local copy in this file).
- Append to the system prompt one sentence: *"לאיתור מהיר של שמות הצדדים, התאריך והפרסום, חפש קודם ב-`https://lite.takdin.co.il/search-results` — הדף הציבורי מציג את כל פרטי התיק במקום אחד."*

### 3. `supabase/functions/citation-chat/index.ts`
For each of the **7 Perplexity calls** in this file (case-law branch A by docket, branch B by parties, secondary פד"י verifier, party-name search, legislation, regulations, books, articles — caselaw branches only), do two things:
- Add `search_domain_filter: TRUSTED_LEGAL_DOMAINS` (currently missing on most of them — they call Perplexity without any domain filter at all).
- Append to the caselaw system prompts: *"כדי לחסוך חיפושים — ב-`https://lite.takdin.co.il/search-results` תמצא בעמוד תוצאה אחד את שמות הצדדים, מספר התיק, בית המשפט, תאריך פסק הדין, ופרסום בפד"י (אם קיים). העדף לאתר את התיק שם."*

This piggy-backs on the existing "hard override" logic: when Perplexity returns parties from `lite.takdin.co.il`, the downstream party-lock prompt already forces the drafter to use them verbatim (Rule 18.4).

### 4. `supabase/functions/case-law-search/index.ts`
- Add `search_domain_filter` (it's missing today).
- Add the same takdin-lite hint to the system prompt.

### 5. `supabase/functions/verify-case-fulltext/index.ts`
- Add `lite.takdin.co.il` to its inline `search_domain_filter` array.
- One-line hint in the system prompt.

### 6. `supabase/functions/bibliography-lookup/index.ts` (caselaw entries only)
- Same hint, gated to source_type=caselaw.

### 7. Memory
Add a new memory under `mem://logic/perplexity-takdin-lite-hint` describing the hint and the domain, and reference it from `mem://index.md`.

## Out of scope
- No scraping or direct API calls to takdin (their full DB is paywalled). We only **hint** Perplexity to read the public `lite.takdin.co.il/search-results` HTML — Perplexity's crawler already indexes it.
- No UI changes.
- No DB / RLS / migrations.

## Test
After deploying, run the same `רבינאי נגד מן שקד` query and a docket-only query (e.g. `ע"א 158/77`) and confirm:
1. Edge function logs show citations from `lite.takdin.co.il` in Perplexity's `citations` array.
2. Final citation has correct parties (no hallucinated first names) and full פד"י publication.
