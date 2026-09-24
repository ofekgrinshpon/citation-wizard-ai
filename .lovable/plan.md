# Milestone 2B — Foreign Source Lookup (fill in missing details)

## Goal
A partial foreign citation (for example "Capitol Records, LLC v. ReDigi Inc. (2d Cir. 2018)") is completed through a web lookup, confirmed against real sources, then built by the same fixed Bluebook formatter. Unconfirmed details stay [חסר: …]. Nothing is guessed.

## Core principle — search broadly, accept narrowly
The preferred-domain lists are **Tier 1 discovery hints, not an allowlist**. Foreign legal and academic material lives across thousands of courts, publishers, journals, repositories, DOI pages and archives — a closed filter would create false negatives.

```text
local parser → Tier 1 (preferred domains) → at most one Tier 2 open-web retry
→ strict identity + field-level grounding → accepted fields only → deterministic formatter
```

## Scope (existing families only)
- US cases: volume, reporter, first page, court, year; or Westlaw/Lexis identifier + docket + date.
- UK cases: neutral citation and/or law report (year, series, page, court).
- Foreign journal articles: authors, title, volume, journal, first page, year.
- Foreign books and book chapters: authors, title, edition, year; chapters also editors, book title, first page.
- US statutes and the US Constitution stay local only.

Out of scope: C.F.R., legislative materials, EU/international sources, Word Add-in work, new source families, Israeli citation changes.

## Behaviour rules
- The local fast path always runs first; the lookup runs only when the local formatter declines.
- The lookup returns **structured candidate fields only** — never a formatted citation. The renderer in `src/data/bluebook/` owns all punctuation, italics and small caps.
- **Tier 2** fires once when Tier 1 cannot ground enough fields — no domain filter. It exists to discover legitimate sources (journal sites, university repositories, publishers, DOI pages, official court domains) not on the initial list. No ever-expanding hard-coded domain lists.
- **Trust is an acceptance rule, not just a hostname rule.** Strong evidence: official court source, recognized legal database, publisher/journal page, institutional repository, bibliographic metadata page identifying the same work. A random secondary page aids discovery but cannot alone ground a field.
- **Identity matching is mandatory.** Cases: normalized party names must match; user-supplied court/year must not conflict; docket/reporter used as anchor when available. Works: strong title identity, authors corroborate; DOI is a strong anchor when independently returned. No inherited or manufactured identity fields. A conflict discards the lookup (not just a field).
- **Field-level grounding:** each field is independently accepted or rejected; grounded fields render, ungrounded fields stay [חסר]. Not all-or-nothing.
- **Grounding evidence:** may come from the result title, snippet, URL identity, structured metadata, or one bounded fetch of a promising identity-matched result. The full citation string (e.g. "910 F.3d 649") is NOT required to appear literally in a snippet.
- **Bounded:** parser → Tier 1 → ≤1 Tier 2 → ≤1 inspection of the best match → grounding → formatter. No recursive loops.
- Repeat citations keep Rule 37; verified sources keep priority; the credit cost stays at one citation.

## Technical details
- **citation-chat:** new `foreign_lookup` branch, taken when the classified type is `foreign_*` and the request asks for a lookup. Perplexity sonar-pro with a JSON-schema response per family. Tier 1 `search_domain_filter` per family (US cases: courtlistener.com, law.cornell.edu, justia.com, supremecourt.gov, uscourts.gov, govinfo.gov; UK cases: bailii.org, supremecourt.uk, nationalarchives.gov.uk; works: publisher/SSRN/JSTOR/HeinOnline/university/Google Books). Reuse the existing tier-2 open-web fallback (no filter). Optional: one bounded fetch of the best identity-matched result URL for field extraction.
- **Response:** `{ foreignLookup: { kind, jurisdiction, fields, grounded: Record<field, boolean>, sources[] } }` alongside today's `content`.
- **runCitation.ts:** after `renderForeignCitation` declines on a foreign type, call citation-chat with `foreignLookup: true`; merge user fields with grounded fields (user identity wins; conflict → discard); call `renderForeignDetection`; missing grounded fields render as [חסר: field] with the existing כלל 36.4 warning; lookup failure → today's behaviour.
- **No second formatter** on the Deno side — extraction only.
- **Tests (bluebookM2B.test.ts, mocked Perplexity):** partial US case completes and renders; ungrounded field stays [חסר]; party mismatch discards; court/year conflict discards; UK neutral filled; article journal abbreviation only from the table; book edition/year filled; complete input never calls the lookup; Tier 2 fires when Tier 1 is empty and a legitimate off-list source can still ground fields; regression: Rule 37, parity, Israeli citations, small caps.
- **Live acceptance (at least 20 records):** 6 US cases (incl. ReDigi), 4 UK cases, 4 articles, 3 books, 2 chapters, 1 nonexistent case (negative). Per record save: input, family, Tier 1 queried, Tier 1 candidate sources, Tier 2 fired, Tier 2 candidate sources, identity anchors, candidate fields, accepted grounded fields, rejected fields, conflicts, final citation, warnings. Totals: tier1_completed, tier2_fired, tier2_rescued, identity_mismatch_rejected, fields_grounded, fields_left_missing — diagnostic only; no optimizing for Tier 1 hit rate.
- **Success invariant:** legitimate sources outside the initial domain list are still discovered; a source being off-list is never a rejection reason; ungrounded details remain missing.
- **Report:** `reports/final-acceptance/bluebook22-foreign-citation-engine-m2b/REPORT.md` + ACCEPTANCE_RECORDS.txt, SHIP / PARTIAL / HOLD verdict.
