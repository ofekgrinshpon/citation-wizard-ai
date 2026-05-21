
## Goal

Recover bare-reporter caselaw citations from the LedgerSource itself (metadata → text regex → official page fetch) **before** Perplexity. When Perplexity is finally called, send the **full verified-source context** and ask it to verify (not infer) the case, returning structured fields. No bare-reporter relaxation, no GPT-memory inference.

## Scope (Research Core only)

Edit:
- `supabase/functions/legal-qa/core/citationCleanup.ts`
- `supabase/functions/legal-qa/core/runCore.ts`
- `supabase/functions/_shared/partyLookup.ts` (prompt + request shape only; no looser validation)
- New: `supabase/functions/legal-qa/core/officialSourceFetcher.ts`

Do NOT touch: `BatchFootnoteBuilder`, `FootnoteReviewCard`, `citation-chat`, `src/components/**`, Planner / Retrieval / Verifier / Ledger / Drafter.

## New enrichment pipeline

For every citation flagged `failed_bare_reporter`, run passes in order; stop at first success:

```text
Pass A  metadata short-circuit       (existing — keep)
Pass B  text regex extraction        (NEW — local, deterministic)
Pass C  official-URL fetch + parse   (NEW — verified source only)
Pass D  partyLookup w/ full context  (HARDENED — verify, don't infer)
```

### Pass B — Text regex extraction

In `citationCleanup.ts`:
- Loosen `PARTIES_CAPTURE_RE` to tolerate Hebrew typographic quotes (`״ ׳`), ASCII (`" '`), `בע"מ`, parenthesised role suffixes, and `נ׳ / נ' / נ"` separators. Sanity check: both sides ≥ 2 chars, ≥ 1 Hebrew letter.
- Add `extractCaseFieldsFromLedgerSource(ls)` combining `title + citation + snippet + url` and returning `{ prefix, docket, party1, party2, year, fullDate }` per field.

In `runCore.ts`, after Pass A: if Pass B yields `{docket, party1, party2}`, call `enrichBareReporterCitation`. Counters: `text_regex_attempted/recovered`. Log `pass: "text_regex"` in attempts.

### Pass C — Official-URL fetch + parse

New `officialSourceFetcher.ts`:
- Host allowlist: `supreme.court.gov.il`, `supremedecisions.court.gov.il`, `versa.cardozo.yu.edu`, `nevo.co.il`, plus any host already trusted by the verified-source layer. Tight, explicit list.
- `fetchOfficialCasePage(url)`: guarded `fetch` with 12s timeout, strip tags / decode entities, run the regex extractors over first ~8 KB + `<title>`. Returns `{docket, prefix, party1, party2, year, fullDate, source_url}` or `null`. In-run URL cache.

In `runCore.ts`, after Pass B: parallel `Promise.allSettled` (cap 5, overall ~20s budget). If parsed fields satisfy `{docket, party1, party2}`, enrich and log `pass: "official_fetch"`. Counters: `official_fetch_attempted/recovered/timeouts`.

### Pass D — Hardened partyLookup (verify-only, full context)

Modify `partyLookup.ts` request:

**Old**: docket-only string passed to Perplexity.

**New** — each item now sends the full verified-source bundle:
```ts
{
  caseNumber, caseTypePrefix,
  reporterCitation,        // e.g. פ"ד לה(1) 421
  title, snippet, url,
  sourceType, courtHint,
  claimContext,            // short paragraph fragment from drafter (optional)
}
```

Updated system prompt (verbatim intent):

> משימה: לאמת תיק משפטי קיים מתוך מקורות מאושרים בלבד. אסור להסיק שדות חסרים מהזיכרון. אם לא ניתן לאמת מתוך מקור מאושר — החזר `no_match`.
> מקורות מאושרים: supreme.court.gov.il, supremedecisions.court.gov.il, nevo.co.il, versa.cardozo.yu.edu, takdin.co.il, מאגרי בתי המשפט הרשמיים.
> קלט: docket, reporter, title, snippet, url, sourceType, court.
> פלט JSON בלבד:
> ```json
> { "status":"verified"|"no_match", "party1":string|null, "party2":string|null,
>   "year":string|null, "fullDate":string|null,
>   "reporterVolume":string|null, "reporterPart":string|null, "reporterPage":string|null,
>   "url":string|null, "sourceUsed":string|null }
> ```
> אם אחד מהשדות לא נמצא במקור מאושר — החזר `null` לאותו שדה. אל תמציא.

Keep: 45s timeout, batch cap 5, JSON `response_format`, `search_domain_filter` (without `lite.takdin.co.il`). Add: `searchAfterDate` left unset; `searchMode: "default"`.

Validation layer stays strict — reject when `status !== "verified"` OR when `{party1, party2}` are null. New extracted reporter fields (`reporterVolume/Part/Page`) are passed through to `enrichBareReporterCitation` so we can rebuild the canonical reporter string deterministically.

### Diagnostic step — prompt-context comparison (BEFORE shipping)

Before editing `partyLookup.ts`, run a one-off `code--exec` script that calls Perplexity (`sonar-pro`) with **4 prompt variants** for the 7 bare-reporter dockets from the last smoke run:

1. docket only
2. docket + reporter
3. docket + reporter + title
4. docket + reporter + title + URL + snippet

For each variant log: status (`verified` / `no_match` / `timeout`), parties returned, source URL used, latency. Aggregate hit-rate per variant and per docket. Output a table.

This decides whether the current 0/7 recovery is a context problem (variant 4 wins) or a model problem (all four lose). Result drives the final prompt shape we commit in `partyLookup.ts`.

## Telemetry

Extend `metadata.core.enrichment` with per-pass counters and `pass: "metadata" | "text_regex" | "official_fetch" | "party_lookup"` on each attempt. New fields when Pass D returns: `verified_source_used`, `reporter_volume/part/page`.

Single complete log line:
```
bare=X meta=A regex=B official=C party=D recovered=R dropped=K
```

## Constraints

- No LLM in Passes B / C.
- No relaxation of the bare-reporter gate. All passes must produce real `{docket, parties}` from real source text/pages.
- Pass D may use rich context to **locate** a source but never to infer missing fields.
- Tight host allowlist for Pass C; failures silent and counted.
- No new dependencies. Pure regex + `fetch`.

## Validation

1. Run the 4-variant Perplexity diagnostic; report which context shape actually verifies parties.
2. Implement Passes B + C and the hardened Pass D using the winning context shape.
3. Re-run `eval/_smoke10_v2.mjs` and report:
   - `text_regex_attempted/recovered`
   - `official_fetch_attempted/recovered/timeouts`
   - `party_lookup_attempted/hits` (expected to fall sharply once B+C work)
   - `bare_reporter_recovered/dropped`, `core_failed`
   - Citation grades for S1, S6, S7, S8, S10 vs prior run
4. Invariants must still hold: 0 null answers, 0 leftover markers, 0 orphan superscripts, 0 bare-reporter footnotes shipped, 0 pipe artifacts, 0 raw `source_type` leaks.
