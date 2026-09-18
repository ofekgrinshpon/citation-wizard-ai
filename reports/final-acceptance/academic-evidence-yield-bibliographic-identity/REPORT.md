# Academic Evidence Yield + Bibliographic Identity — implementation report

Scope: V2 only. No new research mode, source quota, classifier, planner or
Drafter model was added. Verification remains body-only and fail-closed.

## A. Academic evidence yield

1. **Canonical document text** (`shared/academicText.ts`, wired into
   `EvidenceStore.append`). One representation is stored, hashed, quoted and
   verified: invisible bidi/zero-width controls, soft hyphens and exotic
   spaces removed, whitespace collapsed, repeated page furniture dropped. The
   previous mismatch (raw body stored, cleaned window served) could make a
   genuine quote fail the verbatim span check.
2. **Text-quality + extraction classification** — every source now records
   `extraction_status` (`usable` / `sparse` / `empty` / `failed`) and quality
   metrics, so "read but unusable" is distinguishable from "not acquired".
3. **Hebrew-aware in-document location** (`locateTerm`) — whitespace and
   punctuation insensitive, with Hebrew prefix stripping, so a paraphrased
   agent search still lands on the literal sentence.
4. **Bounded later-page continuation** — `fetch({ want: "pdf_page_range" })`
   re-reads the NEXT bounded page window of an already-acquired PDF
   (20 pages / 90k chars / existing deadline) and appends it append-only, so
   every earlier verified span still matches. Long law-review articles whose
   argument sits past the first page bound are now reachable.
5. **Malformed URL repair** (`shared/urlNormalize.ts`) — backslash path
   separators, duplicated slashes, broken scheme separators and wrapping
   punctuation are repaired before fetching. Safety checks are unchanged and
   still run on the repaired URL.
6. **Per-source yield accounting** (`evidence/academicYield.ts`) — for each
   source the run now records where it stopped contributing:
   `NOT_ACQUIRED`, `UNUSABLE_EXTRACTION`, `READ_NO_QUOTE_REQUESTED`,
   `QUOTE_REQUESTED_NO_WINDOW`, `WINDOW_SERVED_NOT_MEMOED`,
   `MEMOED_SPAN_NOT_FOUND`, `MEMOED_SUPPORT_FAILED`, `VERIFIED`, plus
   stage-to-stage yield ratios. Diagnostic only — nothing gates on it.

## B. Bibliographic identity

1. **Parsing** (`shared/bibliographic.ts`): repository/journal `citation_*`
   and Dublin Core meta tags, embedded PDF document info, and discovery
   metadata. Values are filtered for producer junk; the check is Unicode-aware
   so Hebrew titles and author names are never discarded.
2. **Repository landing page → article PDF**: when a landing page declares
   `citation_pdf_url`, the PDF is fetched once under the same identity, giving
   a readable body plus the landing page's strong citation metadata.
3. **Deterministic merge**: strongest basis wins per field
   (`repository_page` > `html_meta` > `pdf_metadata`/`pdf_header` >
   `search_metadata` > `body_text`); weaker sources only fill gaps; provenance
   is retained in `metadata_basis`.
4. **Citation rendering**: `drafting/render.ts` renders
   `Author, "Title" Journal Volume (Year), locator` when structured identity
   exists, instead of a page title plus a raw URL. With no metadata the prior
   citation shape is unchanged. Metadata is never evidence and never a
   precondition for a source being usable.

## Telemetry added

`academic_discovered`, `academic_fetch_attempted`, `academic_acquired`,
`academic_extracted_usable`, `academic_quotes_served`,
`academic_sources_memoed`, `academic_sources_span_verified`,
`academic_sources_support_verified`, `academic_sources_final_pack`,
`academic_yield_ratios`, `academic_source_yield[]`,
`bibliographic_sources_with_metadata`, `bibliographic_sources_with_authors`,
`bibliographic_citations_rendered`, `repository_pdf_followed`,
`pdf_continuation_reads`, `urls_repaired`.

## Validation

- `src/test/academicEvidenceYield.test.ts` — 11 new tests covering canonical
  text, URL repair, metadata parsing/merging/rendering, append-only body
  continuation and per-source yield staging.
- Full suite: 84 files / 995 tests passing.
- Typecheck clean; `legal-research-v2` deployed.
- V1 untouched; attachment (user document) path untouched.

Status: IMPLEMENTED AND DEPLOYED — live literature-review acceptance rerun not
executed in this task.
