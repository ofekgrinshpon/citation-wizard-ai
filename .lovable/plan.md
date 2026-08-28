# doctrinal_candidate_pool_stabilization_v1

Goal: make promising doctrinal/secondary candidates reach body acquisition and doctrinal eligibility consistently, so doctrinal and academic questions stop swinging between a real answer and `insufficient_sources_limitation`. No sufficiency threshold is relaxed, and no source type is upgraded without an acquired body plus source-integrity evidence.

## What changes

### 1. Listing/index suppression before budget is spent
In the secondary-acquisition candidate selection, candidates that source-integrity already marks as `index_or_listing` / `not_citable` / listing-shaped URLs (search result pages, court listing rows, category pages) are dropped from the selection list before they consume any local-lookup or web-fetch slot, and recorded as `listing_suppressed` with a reason. Selection ordering then favours verifier direct/partial doctrinal candidates. This reallocates the existing budget; it does not raise any cap.

### 2. Conservative doctrinal candidate reconsideration (pre-sufficiency, no new retrieval)
Candidates currently rejected by selection only because their initial `source_type` is imperfect are reconsidered when they are verifier direct/partial **and** carry doctrinal evidence (law-review / כתב עת / book chapter / treatise / commentary / academic host / academic-legal or doctrinal analysis signals, or a title or snippet that names the doctrine asked about). Reconsidered candidates enter the same existing acquisition path (local corpus → verified cache → secondary cache → one bounded web fetch). Never reconsidered: unrelated case law, index/listing/search pages, metadata-only pages with no path to a body, news/PR pages, snippet-only items with no substantive legal content, verifier-`unrelated` items. Uses existing candidates only — no broad search, no Perplexity rerun, no LLM call.

### 3. Post-acquisition typing coverage
Type re-mapping to a doctrinal/secondary type happens only after a body is acquired and source-integrity passes, driven by evidence in the acquired body (law-review/journal shape, chapter/treatise, commentary, academic or doctrinal analysis, Hebrew legal journal, substantive legal discussion). Listing, search-result, metadata-only, unrelated case law, news/PR, and body-less institutional pages are never re-mapped. Existing non-`other` types and primary-law types are still never overwritten.

### 4. Light recovery floor before insufficiency
A bounded recovery pass runs only when **all** hold: the planned task is `doctrinal_explanation`, `broad_research`, `academic_research`, `literature_map` or `seminar_planning`; the pool would enter sufficiency with fewer than 2 acquired eligible doctrinal sources; there are verifier direct/partial candidates skipped as `not_doctrinal_type` or `no_body_acquisition_attempted`; and the run budget allows it. Recovery: at most 3 candidates, local/cache first, at most 2 extra local/cache attempts, at most 1 web fetch (2 in deep/academic mode), hard added wall-clock cap 10s (15s deep/academic). On exceedance it stops, does not retry, records `recovery_budget_exhausted`, and the normal insufficiency branch proceeds.

Recovery never runs for `case_holding`, exact/fabricated docket, statute-only or `specific_case_or_statute` runs, and never when the pack already satisfies sufficiency.

### 5. Pre-sufficiency candidate-pool telemetry
For the doctrinal/academic task intents, a `candidate_pool_stabilization` telemetry block is persisted before sufficiency with: total candidates; verifier direct/partial; secondary/commentary/institutional typed; blocked by `not_doctrinal_type`; skipped as `no_body_acquisition_attempted`; secondary local lookups; cache hits; web attempts; acquired bodies; doctrinal eligible; institutional eligible; `index_or_listing` / `not_citable` counts; `listing_suppressed` count; skipped by budget; and recovery fired / reason / added ms.

## Safety (unchanged)
Sufficiency thresholds, claim-source-match, `claimSourceRebinding`, drafter prompts, judgment identity validation, docket limitation, statute authority rules, found-only claim-support prohibition, secondary-as-primary prohibition and footnote rendering are all untouched.

## Technical notes
- New stage `stages/doctrinalCandidateStabilization.ts`: deterministic listing suppression, reconsideration predicate, pre-sufficiency pool metrics, and the recovery trigger predicate. Pure/deterministic parts are unit-testable.
- `stages/secondaryBodyAcquisition.ts`: selection filters out suppressed listings, admits reconsidered candidates, and re-orders by (verifier verdict, doctrinal evidence). Body-evidence typing tightened in the existing `remapSecondaryType` path; no new limits.
- `index.ts`: after the existing secondary-acquisition stage, evaluate the recovery predicate; if it fires, run one bounded second pass with its own reduced budget and record added ms; then persist the telemetry block under `metadata.drafter.candidate_pool_stabilization`.
- `stages/doctrinalSourceTyping.ts`: eligibility unchanged in strictness; only reads the improved types.
- New tests in `src/test/doctrinalCandidateStabilization.test.ts` using frozen funnel fixtures.

## Validation (staged)
- **Stage 1 — fixtures only:** D1 legal articles become doctrinal only after body + integrity evidence; B8 administrative-law scholarship reaches eligibility; listing/index stay suppressed; unrelated case law stays unrelated; metadata-only stays ineligible; found-only still cannot support claims; R02/P02 fixtures unchanged.
- **Stage 2 — mini live smoke:** B8, D1, and one of P02/R02 as safety control. Accept when B8 reaches ≥3 acquired bodies and ≥2 eligible doctrinal sources (or logs exact per-candidate failures), D1 reaches ≥2 acquired bodies and ≥1 eligible doctrinal source (or logs exact failures), neither falls to insufficiency solely because promising direct/partial candidates were skipped, the refusal control is unchanged, added latency is within budget, and no stale jobs/CPU kills/stubs/orphans appear. Stop here on failure.
- **Stage 3 — full 10-query sweep once, only after Stage 2 passes:** ACADEMIC, NATION-STATE-ACADEMIC, PAYWALL, MMM, B8, D1, D3, DARKPATTERNS, R02, P02, reporting before/after pool counts, lookups, cache hits, web attempts, acquired bodies, eligible doctrinal/institutional, `not_doctrinal_type`, `no_body_acquisition_attempted`, `listing_suppressed`, recovery fired/why/ms, sufficiency branch, `claim_match_ran`, footnotes, runtime and safety controls.

Report to `reports/doctrinal-candidate-pool/ACCEPTANCE_REPORT.md` with an accepted / conditional / not-accepted verdict.
