# Scholarly Acquisition Resilience — Implementation Report

## 1. Root causes confirmed in the old code
- **Asymmetric identity.** `researchAgent.ts` built the failed original's trusted
  identity from `identityFromSearchResult()` only (title + maybe year/DOI). The
  landing page `fetch.ts` had already parsed (authors, year, journal) sat in the
  EvidenceStore unused, so `isSameWork()` correctly refused title-only matches
  and a legitimate alternate copy could never be proven equivalent.
- **Narrow landing discovery.** Only `citation_pdf_url` was followed.
- **Early stop.** 1 query, 6 results, and the first accepted candidate was
  fetched once; if that copy failed, the work was abandoned.

## 2. Files changed
- `shared/bibliographic.ts` — `documentLinksFromHtml()` + `MAX_LANDING_DOCUMENT_CANDIDATES`.
- `tools/fetch.ts` — tries up to 3 landing document candidates (citation_pdf_url first); telemetry.
- `tools/sameWorkRecovery.ts` — `buildTrustedWorkIdentity()`, `buildSameWorkQueries()`,
  multi-query / multi-candidate loop with an `acquire` callback, new telemetry.
- `agent/researchAgent.ts` — uses the trusted builder with the stored landing
  metadata; acquisition runs through the ordinary `runFetch` inside recovery.
- Tests: `src/test/scholarlyAcquisitionResilience.test.ts` (new); two existing
  assertions updated for the new explicit caps (query cap 1→3; trust-boundary T6
  now inspects the whole query ladder).

## 3. New recovery flow
```text
failed URL (HTTP error or unusable body)
 -> trusted identity = discovery + DOI-in-URL + stored landing metadata
    (only repository_page / html_meta / search_metadata field bases)
 -> query ladder (DOI | "title" author year pdf | "title" year pdf | "title" pdf), deduped, <=3
 -> per candidate: dedupe URL, dead-URL skip, pirate-host skip,
    isSameWork (unchanged) + bounded identity enrichment
 -> equivalent candidate -> ordinary runFetch (document check, EvidenceStore, verification)
 -> readable document? done : next equivalent candidate (<=3 attempts)
 -> terminal reason
```
Later queries run only if earlier ones produced no acquired copy.

## 4. Hard limits
| Limit | Old | New |
|---|---|---|
| Rediscovery queries per work | 1 | 3 |
| Results per query | 6 | 6 |
| Equivalence-proven candidate fetches per work | 1 | 3 |
| Landing-page document candidates tried | 1 | 3 |
| Enrichment candidates per work | 2 | 2 (unchanged, shared across queries) |
Global agent/fetch/search budgets unchanged; each recovery fetch still consumes
the ordinary fetch budget and stops when it is exhausted. Recovery still runs once per work.

## 5. Invariants preserved
Search results, snippets, Crossref/OpenAlex and landing-page metadata are identity
only, never evidence. `isSameWork()` unchanged. Model `work_identity` is still a
search hint only. Embedded PDF metadata never joins trusted identity. Every
recovered body passes the ordinary fetch/document/EvidenceStore/verification
path. No login/CAPTCHA/paywall bypass; pirate hosts still refused; no domain allowlist.

## 6. Tests
New file: 10 tests (T1–T7 plus chrome/dedupe/cap, weak-metadata exclusion, query ladder).
In T1/T2 the followed document is served as readable text (the PDF parser has its own
coverage and does not run under the test environment).
Full suite: **1176 passed / 99 files**. Typecheck clean. `legal-research-v2` deployed.

## 7. Telemetry added
`same_work_original_fields_before/after`, `same_work_original_field_provenance`,
`landing_document_candidates/attempted`, `same_work_equivalent_candidates`,
`same_work_candidate_fetch_attempts`, `same_work_candidate_fetch_failures`
(failure_class per attempt), per-round `queries[]`, and the terminal reason
`equivalent_copies_failed_acquisition`. `same_work_recovery_query_count` now counts real queries.

## 8. Not solved on purpose
- Works with no public copy anywhere (paywalled only).
- Landing pages that need JavaScript to show the document link.
- Candidates whose discovery record and enrichment still give title only.
- Scanned PDFs without a text layer.
- Live yield not measured yet — needs a live acceptance run.

VERDICT: IMPLEMENTED / LIVE VALIDATION PENDING
