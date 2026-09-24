# Milestone 2B — Foreign Source Lookup (fill in missing details)

## Goal
When someone types a partial foreign citation (for example "Capitol Records, LLC v. ReDigi Inc. (2d Cir. 2018)"), ReLex searches the web for the missing details, confirms them against real sources, and then builds the citation with the same fixed Bluebook formatter. If a detail can't be confirmed, it's still marked [חסר: …]. Nothing is guessed.

```text
Input
 ├─ complete citation → local parser → Bluebook formatter → done (fast, free, as today)
 ├─ partial / name only → Perplexity lookup → confirmed details → same formatter → done
 └─ lookup can't confirm → [חסר: …] + warning (no guessing)
```

## Scope (existing families only)
- US cases: volume, reporter, first page, court, year. Also Westlaw/Lexis number plus docket and date when there's no printed report.
- UK cases: neutral citation and/or law report (year, series, page, court).
- Foreign journal articles: authors, title, volume, journal, first page, year.
- Foreign books and book chapters: authors, title, edition, year; for chapters, also the editors, the book title and the first page.
- US statutes and the US Constitution stay local only (the input already contains the section).

Out of scope: C.F.R., legislative materials, EU and international sources, Word Add-in work, new source families, and changes to Israeli citations.

## Behaviour rules
- The local fast path always runs first. The lookup runs only when the local formatter declines.
- The lookup returns **structured fields only**, never a formatted citation. ReLex's formatter owns all punctuation, italics and small caps.
- Each field is accepted only if a trusted source backs it and the source's party names or title match the input. Fields without that backing stay missing.
- The case name, court and year the user typed must match what the lookup found. If they conflict, the lookup result is thrown away and the user sees a warning.
- Repeat citations still follow Rule 37 (never Id./supra). Verified sources keep priority.
- The credit cost stays the same as today's single citation.

## Technical details
- **citation-chat:** add a `foreign_lookup` branch, taken when the classified type is `foreign_*` and the request asks for a lookup. It uses Perplexity sonar-pro with a JSON-schema response per family and a trusted-domain filter:
  - US cases: courtlistener.com, law.cornell.edu, justia.com, supremecourt.gov, casetext.com, uscourts.gov, govinfo.gov
  - UK cases: bailii.org, supremecourt.uk, nationalarchives.gov.uk
  - Articles and books: publisher, SSRN, JSTOR, HeinOnline, university and Google Books pages
  - The existing tier-2 fallback runs only when the trusted sources return nothing.
- **Grounding:** the reporter citation (for example "910 F.3d 649") or the title must appear in the snippet or title of at least one trusted citation URL. Party names must match the input using the M1 name normalizer. Each field gets a `grounded: true/false` flag.
- **Response:** `{ foreignLookup: { kind, jurisdiction, fields, grounded, sources[] } }`, alongside the existing `content` fallback.
- **runCitation.ts:** once `renderForeignCitation` declines on a foreign type, call citation-chat with `foreignLookup: true`. Merge the user's fields with the grounded fields (user input wins on identity; a conflict means the result is discarded). Then call `renderForeignDetection`. Grounded fields that are still missing render as [חסר: field] with the existing כלל 36.4 warning. If the lookup fails, use today's behaviour.
- **No second formatter:** the Deno side only extracts. All formatting stays in `src/data/bluebook/render.ts`.
- **Tests (new bluebookM2B.test.ts, using a mocked Perplexity):**
  - A partial US case fills volume, reporter and first page, then renders correctly.
  - An ungrounded field stays [חסר].
  - A party name mismatch discards the lookup result.
  - A court or year conflict discards the lookup result.
  - A UK case gets its neutral citation filled in.
  - An article is completed with a journal abbreviation from the table only.
  - A book edition and year are filled in.
  - A complete input never calls the lookup.
  - Plus regression checks for Rule 37, parity, Israeli citations and small caps.
- **Live acceptance (at least 20 records):** 6 US cases (including ReDigi), 4 UK cases, 4 articles, 3 books, 2 chapters and 1 nonexistent case as a negative control. For each record, save the input, the lookup fields, their grounding, the sources, the final citation and any warnings.
- **Report:** `reports/final-acceptance/bluebook22-foreign-citation-engine-m2b/REPORT.md` plus ACCEPTANCE_RECORDS.txt, with a SHIP / PARTIAL / HOLD verdict.
