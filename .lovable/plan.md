# discovery_precision_and_listing_suppression_v1

Goal: raise candidate precision in the pool build, before the verifier and before any acquisition budget is spent, so listing/index/search/category pages stop dominating doctrinal pools. No sufficiency threshold, claim-source-match, rebinding, recovery logic, identity validation, docket limitation, statute authority rule, found-only rule, drafter prompt or footnote rule is touched. No new network calls, no Perplexity rerun, no new LLM call.

## Current state (verified)

- `stages/candidatePool.ts` already runs `classifySourceIntegrity` on every raw candidate before dedupe, stores it at `metadata.source_integrity`, and drops only candidates where integrity sets `reject`. Everything else — including `authority_tier: "index_or_listing"` and `citable_as: "not_citable"` — is admitted and competes for the `CAPS.MAX_CANDIDATES` slots on tier + score alone.
- Listing status is used in exactly one narrow place: `isTrustedPerplexity` refuses a reserved slot to listing/not-citable Perplexity items. They still enter through Pass B.
- Listing suppression today happens late, inside secondary body acquisition (`suppress_listings`), i.e. after listings already consumed pool slots and verifier slots. This matches the D1-SWEEP telemetry: 21/30 admitted candidates carried `index_or_listing` and `not_citable`.

## What changes

### 1. Discovery classification (new stage)
New `stages/discoveryPrecision.ts` computes a deterministic `discovery_class` per candidate from signals already on hand — URL path shape, title shape, existing `source_integrity`, snippet presence/length, list-likeness of the snippet, host class:

`citable_candidate` | `possible_body_page` | `index_or_listing` | `search_result_page` | `category_page` | `metadata_only` | `not_citable`

The class plus the matched signals are written to `metadata.discovery_precision` so downstream stages and telemetry can read it without recomputing.

### 2. Conservative suppression inside pool build
`buildCandidatePool` suppresses only `index_or_listing`, `search_result_page` and `category_page` classes. Protected and never suppressed: official statute pages, judgment body pages, article/report landing pages with a plausible PDF/body/download path, candidates with an acquired substantive body, and high-confidence exact-source / exact_authority candidates. Suppressed candidates are logged with a new `discovery_listing_suppressed` drop reason and their reason string, and are kept in a separate diagnostics list rather than deleted from the record.

### 3. Budget protection
Because suppression happens at pool build, suppressed candidates never reach the verifier, secondary body acquisition, doctrinal recovery selection, or the drafter pack. The existing late `suppress_listings` path in `secondaryBodyAcquisition.ts` stays as a second net; it simply finds fewer listings to drop.

### 4. Backfill
Each suppressed candidate frees one slot. The pool build then walks the already-sorted remainder and admits the next eligible candidate under the existing dedupe rules, with a diversity guard so backfill does not fill every freed slot from one origin (local retrieval / nomination / official / secondary each keep representation). No new retrieval of any kind.

### 5. Ranking adjustment
Within the existing tier/score ordering, a bounded deterministic adjustment: promote candidates with doctrine-matching substantive titles, article/report/judgment/statute identity, a body/PDF path or known citable host, and jurisdiction fit; demote generic archives, duplicate mirrors, tag/category/search pages, and low-instance unrelated case law when the planned task is doctrinal. The adjustment is a capped delta on the existing score so it can reorder within a tier but cannot promote a non-citable page above a real authority.

### 6. Telemetry
New `metadata.discovery_precision` block per run: candidates before suppression, class histogram, suppressed count with reasons and ids, backfilled count with origins, final pool size, `index_or_listing` ratio before/after, verifier direct/partial, acquired bodies, doctrinal/institutional eligible, sufficiency branch, footnote count, and runtime delta for the classification step.

## Validation (staged, stop on failure)

- **Stage 1 — unit/fixture tests** (`src/test/discoveryPrecision.test.ts`): index/listing/search/category fixtures suppressed; article/report landing page with a PDF/body path preserved; official statute page preserved; exact-source judgment candidate preserved; metadata-only demoted but never cited; unrelated low-instance case law demoted in doctrinal mode; backfill preserves diversity; suppression never removes a candidate with an acquired body.
- **Stage 2 — mini live smoke:** D1 twice, B8 once, plus P02 or R02 as safety control. Accept when D1's pool no longer exceeds 50% `index_or_listing` (unless every available candidate genuinely is a listing), D1 reaches ≥2 doctrinal eligible sources or logs exact non-listing acquisition failures, B8 stays normal and is not over-suppressed, and the docket-limitation control is unchanged.
- **Stage 3 — full 10-query sweep, only after Stage 2 passes:** ACADEMIC, NATION-STATE-ACADEMIC, PAYWALL, MMM, B8, D1, D3, DARKPATTERNS, R02, P02. Accept on a material `index_or_listing` drop for doctrinal runs, D1 not failing solely on a listing-dominated pool, B8/D1/D3 stable, no regression on ACADEMIC/NATION/PAYWALL, no harm to MMM/DARKPATTERNS, R02/P02 safe, and minimal runtime increase.

## Technical notes

- New: `stages/discoveryPrecision.ts` (pure/deterministic, unit-testable), `src/test/discoveryPrecision.test.ts`.
- Modified: `stages/candidatePool.ts` — classify → suppress → backfill → ranking delta, plus new drop reason and diagnostics on `PoolResult`; `index.ts` — persist the telemetry block and thread the planned task intent into the pool build for the doctrinal demotion rule.
- Reuses the Stage 2/3 runner pattern of `scripts/legal-research-v1-pool-stabilization-stage2.ts` in a new script for this track.

Report to `reports/discovery-precision/ACCEPTANCE_REPORT.md` with an accepted / conditional / not-accepted verdict.
