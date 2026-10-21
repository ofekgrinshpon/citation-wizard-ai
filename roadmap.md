# Roadmap — research → memo → draft handoff (legal-research-v2)

## Unified pasted-citation infrastructure batch A (offline only)
- [x] Narrow C2 JSONB binding correction at de9f47d9: recursive canonical v2 checksum, exact-v1 compatibility; five fail-before/pass-after vertical/history cases; 615 focused / 4,028 full passed, 1 skipped; automatic compilation OK, explicit TS/Vite unrun; no deployment/live/DB changes.
- [x] Focused C2 authoritative book/chapter replay at 58231607: shared pure server/client rendering; authenticated, version/input/request-bound existing-content replay; 599 focused / 3,994 full passed, 1 skipped; automatic compilation OK, explicit TS/Vite unrun; no deployment/live/DB changes.
- [x] Narrow C2 retention-envelope correction at 1ce326a0: trusted source snippet projection; real UsageGuard → endpoint/API → history; 17 new / 416 focused / 3,969 full passed, 1 skipped; explicit TS/Vite remain external gates; no live/deployment/DB changes.
- [x] Final bounded C2 recovery correction at be955a5b: exact raw reparse and wire/manual checks; original year/publisher/section retained; focused 317 / full 3,952 passed, 1 skipped; automatic compilation OK; explicit TS/Vite independent gate and pre-existing retention-envelope compatibility remain documented; no D/live/deployment.
- [x] Narrow C2 wire correction at 2e4b11a6: complete local fields/exact spans separate from raw-bound wire; actual-handler/four-host gates; focused 432 / full 3,941 passed, 1 skipped; automatic compilation OK; explicit TS/Vite remain independent blockers; no D/live/deployment.
- [x] Narrow C2 correction at a66d3c56: edition presentation with exact evidence, distinct chapter/collection donors, unsupported-only missing fields local; focused 408 and full 3,915 passed / 1 skipped; report; no D/live/deployment.
- [x] Bounded C2 at 3d11a3e4: eligible existing book/chapter completion unified across chat/runner; actual-host semantic parity; 3,879 passed / 1 skipped; report and automatic compilation OK; no expansion D/deployment.
- [ ] C2 independent gate: separate explicit app TypeScript/Vite commands blocked by environment prohibition; report records automatic compilation and offline coverage, awaiting independent QA.
- [x] C1 independent gate supplied by user: 3,899 passed / 4 skipped, 64 probes, app TypeScript and explicit Vite build passed on reviewed baseline.
- [x] C1 correction at 4f34e462: terminal server book/chapter outcomes, independently rendered US partials, jurisdiction evidence conflicts, transient host metadata; full offline 3,766 passed / 1 skipped; automatic compilation OK. Report records separate explicit TS/Vite gate limitation; no C2/deployment.
- [x] Infrastructure C1 implementation/offline regression: shared strict partial acceptance and local/resolution parity; 3,752 passed / 1 skipped; report records compatibility limits. No C2 or deployment.
- [ ] C1 independent QA: separate explicit app TypeScript/Vite gate evidence unavailable under manual-command prohibition; review unbound historical recovery compatibility branch.
- [x] Narrow correction: effective-family conflicts and canonical lookup/response binding; actual-host/handler gates passed, full offline suite 3,426 passed / 1 skipped; no batch B. Separate app TypeScript/production-build evidence still blocked by harness visibility.
- [x] Infrastructure batch B: shared pure planner/resolver (`citationPlanner.ts`) used by Index, runCitation (Batch/Bibliography); baseline differential + host tests; full suite 3,727 passed / 1 skipped. Batch C (capability reconciliation) not started.
- [x] Shared versioned supplied-evidence contract, exact raw spans and safe jurisdiction routing.
- [x] Index initial/manual regeneration, runCitation/batch and pre-cache server guard; terminal outcomes never escape to generic providers.
- [x] Offline caller/server regressions and full suite (3,392 passed / 1 skipped); automatic compilation OK; bounded report recorded. Stop before batch B.
- [ ] Independent app typecheck/production-build gate: separate harness results are not exposed and manual commands are forbidden.

## Authorized book/chapter boundary correction (offline only)
- [x] Reproduce ambiguous comma chapter headings and numeric editor-only/collection titles through real callers (10 pre-fix failures).
- [x] Preserve ambiguous boundaries without inferred authors or pages; retain explicit metadata controls.
- [x] Focused 93/93; full 3,351 passed / 1 skipped; app typecheck and automatic build passed; bounded ledger updated. No next family.

## Stage 5 batch 2 — manuscripts/theses (offline only)
- [x] R17.2.1–17.2.2 parser/renderer, classification route, chat/batch wiring and tests; ledger updated.
- [ ] Remaining Stage 5 family batches (each separately authorized).

## Stage 5 batch 3 (offline only)
- [x] R16.5 nonconsecutive articles and R16.6 print newspapers — see reports/stage5-periodical-coverage.md.

## Current authorized Stage 5 D1a (offline only)
- [x] Extend US database/slip/pending decision preservation, rendering and existing classification axes.
- [x] Prove failing regressions, then exercise real chat and batch/local callers with mocked network.
- [x] Run focused/full checks and record a bounded coverage ledger; no deployment or next batch.

## Current bounded Stage A correction (offline only)
- [x] Restore named preservation fields across caller/recovery validation and rendering.
- [x] Close full-date, UK pinpoint, cached warning, suffix-year and constitutional-list gaps.
- [x] Run regression, focused and full offline checks; report remaining limitations without deployment.

- [ ] 1. Durable quote references (memo evidence may cite `quote_id`; server resolves to stored text)
- [ ] 2. Quote catalog in the rolling research state (survives compaction)
- [ ] 3. Coverage reflection: non-binding summary of unused read sources + available quotes
- [ ] 4-7. Agent-owned drafting brief (memo field → drafter), soft target length
- [ ] 8. Academic quality without `academic_context` (brief-driven)
- [ ] 9. Chapter role passed through (introduction/conclusion/abstract/body)
- [ ] 10. Telemetry (quotes, source utilization, brief, draft result)
- [x] CPU: pass-scoped span-normalization reuse in verifyMemo
- [x] CPU: incremental linear SSE framing in model.ts
- [ ] Budget-reservation feasibility (read-only answer delivered; not implemented)
- [ ] 11. Regression tests T1–T12
- [ ] 12. Acceptance run (Astra, same question) vs baseline 9d8998c1

## Status (handoff track)
- [x] Parts 1-11 implemented; 1196 tests + typecheck pass; legal-research-v2 deployed.
- [ ] Part 12 acceptance run — BLOCKED: run fb436e14 stopped with AI credits 402 (agent + drafter). Re-run once credits are topped up.

## Cost telemetry (citation/footnotes/bibliography)
- [x] Per-attempt provider cost events, mock tests, deployed
- [ ] Live 3+3+3 experiment (max US$5) — BLOCKED: waits for independent code review

- [x] V2 Responses SSE lifecycle fix (terminal-before-EOF, premature EOF fails, split frames)
- [ ] Deferred: checkpoint completed memo before verification + resume consumption
- [ ] Deferred: lease/fencing for common resume before any handoff retry

## Citation case-law lookup
- [x] Court-aware query, party follow-up, Option B (אר״ש) — offline tests pass
- [ ] Deploy citation-chat — waits for owner approval
- [ ] Live re-run of 1477-12-22 and 11487/03 — after deploy

## Foreign-source citations (Stage B corrective)
- [x] Caller-level style/warning/URL preservation (bibliography, batch, chat, research panel), R2.1(a) full-case roman typeface, literal-character escaping — offline tests pass
- [x] Stage C — shared foreign classification, picker in chat/batch/bibliography, local persistence (offline). Stage D/E not started.
- [x] Stage 5 batch 4 — books/chapters (editor-only, contributors, explicit publisher status, volume, pinpoints, italic in) — offline tests pass; `reports/stage5-book-coverage.md`
