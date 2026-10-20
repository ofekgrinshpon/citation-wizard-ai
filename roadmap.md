# Roadmap — research → memo → draft handoff (legal-research-v2)

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
- [ ] Stage C — waits for owner's independent verification and separate start
