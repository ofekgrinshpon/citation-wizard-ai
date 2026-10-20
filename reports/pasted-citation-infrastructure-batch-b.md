# Pasted-citation infrastructure — batch B (shared planner / typed resolver)

Baseline: `04d63631617bc3c7f73d87b5746d371a91e33fb0`. Offline only: no deployment, DB, auth, billing, settings or live provider/model calls. Daily Build cap and per-run checkpoint untouched. Batch C not started.

## What changed
- New pure module `src/lib/citationPlanner.ts` (no IO, no telemetry, no request ids, no storage):
  1. `planCitationEvidence(raw, manualChoice)` — batch A evidence contract + terminal preserve (conflict / unsupported / foreign docket / bare numeric). Runs before cache and classifier in both hosts.
  2. `planLocalCitation(input, caps)` — terminal local outcomes, in order: pasted local render → existing local formatters (US unreported, unpublished/thesis, periodical, book) → [runner only] deterministic foreign renderer → statute local/mismatch.
  3. `planTypedRequest(input, caps)` — the existing bound typed request (case > statute > article/other) or a declared `legacy` handoff (Israeli/generic path).
  4. `resolveCitationResponse(plan, data, caps)` — discriminated result: `terminal` (safety, case, statute, disambiguation, article, merge), `reject` (EMPTY_RESPONSE), or `legacy`. A terminal outcome never reaches generic model content. Identity/source kind is never switched from a response (reuses `readPastedCitationSafety`, `renderPastedCaseResponse`, statute/article adapters).
  `planForeignLookup` / `extractForeignCaseName` moved here; still re-exported from `runCitation`.
- `src/pages/Index.tsx` `callAPI` (initial send and manual regeneration both go through it) uses the planner with `CHAT_HOST`.
- `src/lib/runCitation.ts` uses the planner with `RUNNER_HOST`; BatchFootnoteBuilder and BibliographyGenerator reach it only through `runCitation` (unchanged callers).

## Responsibility boundaries (unchanged owners)
| Concern | Owner |
|---|---|
| Transport (`invokeFunction`/`retryCitationFunction`), request ids, prepared body reuse | Index `execute` / runner `invokePrepared` |
| Usage/refund handling (`handleRefundResponse`), telemetry, diagnostics | hosts |
| Verified-source cache, classifier, pinpoint hint | runner |
| Stale checks, retry offers, UI state, history | hosts / components |
| Server raw binding, recomputation before cache/usage/provider | `_shared/pastedCitation.ts` + `citation-chat` (untouched) |
| Planning and typed response resolution | `citationPlanner.ts` (pure) |

## Declared host capability differences (deferred to batch C)
| Capability | Chat (`CHAT_HOST`) | Runner (`RUNNER_HOST`) |
|---|---|---|
| pasted local waits for opinion-format formatter | no | yes |
| book formatter defers complete input to deterministic renderer | no | yes |
| generic deterministic foreign renderer | no | yes |
| typed request builder | article fields only (+statute/case) | `planForeignLookup`: article, **book, chapter**, case |
| article incomplete fallback render | yes | no (falls to legacy) |
| case disambiguation list | no | yes |
| grounded merge of matched fields (book/chapter/case) | no | yes |
| reject matched case with no identity fields | no | yes |

Book/chapter typed completion therefore exists only in the runner (Batch/Bibliography); chat books are local-or-legacy. This is represented, not unified. Equal inputs with equal capabilities produce equal plans/resolutions (tested); end results are not claimed identical across differing capabilities.

## Parity evidence
- `src/test/citationPlannerBatchB.test.ts` (301 tests): frozen baseline runner (`src/test/fixtures/legacyRunCitation.baseline.ts`, test-only copy of `04d6363`) vs refactored runner on identical mocks — 28 fixtures (ten partially supported foreign types incl. US/UK case & statute, article, DOI article, book, chapter ambiguous/labelled, manuscript, thesis, newspaper, periodical ambiguity, generic foreign, unsupported manual; Israeli full/bare/manual; German BVerfG; bare `400/51`; unknown suffix; markers/HTML; manual book-on-case; Hebrew article) × 10 responses (generic, case success/partial/conflict, unmatched, disambiguation, article success/conflict, safety mismatch, empty). Asserts equal text, status, labels, source type, warnings, `pastedCitation` provenance/conflicts/unknown spans, equal request bodies (minus random request id) and classifier call counts. Plus transport error parity.
- Required behaviours: German preserved with zero classifier/cache/provider; bare numeric preserved; manual book-on-case zero requests; incomplete Brown one bound typed request; stale-after-response no apply/no second request; server retry descriptor reused with no new invoke or re-planning.
- Pure contract: determinism/no IO; complete Brown local in both capabilities; case/statute/article terminal outcomes never legacy and never show generic content; bound raw retained; Israeli is legacy handoff.
- Actual hosts: `foreignStatuteChatHost` (Index initial + manual regeneration) asserts `chat` planner + resolver use; `stageCBatchHost` (BatchFootnoteBuilder regeneration) asserts `runner` planner use; `citationRowRetry` (Bibliography + footnotes mounted, real runner) asserts runner planner + resolver use. `legacyArticleAdapter` evaluates the actual Index `callAPI` source with the real planner injected.

## Results
- Focused: 14 citation files 383 passed / 1 skipped before new tests; new file 301 passed.
- Full offline suite: 188 files, 3,727 passed / 1 skipped.
- App TypeScript (`tsgo -p tsconfig.app.json`): 0 errors.
- Production build: automatic harness build after the source edits reported `build OK` (2026-10-20T23:24:13Z). No separate manual `vite build` was run.

## Deferred (batch C)
Reconcile or intentionally keep the capability table above (book/chapter typed completion in chat, disambiguation, merge, article fallback, deterministic renderer); retire the baseline snapshot fixture once parity is no longer needed.
