# Roadmap — research → memo → draft handoff (legal-research-v2)

- [ ] 1. Durable quote references (memo evidence may cite `quote_id`; server resolves to stored text)
- [ ] 2. Quote catalog in the rolling research state (survives compaction)
- [ ] 3. Coverage reflection: non-binding summary of unused read sources + available quotes
- [ ] 4-7. Agent-owned drafting brief (memo field → drafter), soft target length
- [ ] 8. Academic quality without `academic_context` (brief-driven)
- [ ] 9. Chapter role passed through (introduction/conclusion/abstract/body)
- [ ] 10. Telemetry (quotes, source utilization, brief, draft result)
- [ ] 11. Regression tests T1–T12
- [ ] 12. Acceptance run (Astra, same question) vs baseline 9d8998c1

## Status (handoff track)
- [x] Parts 1-11 implemented; 1196 tests + typecheck pass; legal-research-v2 deployed.
- [ ] Part 12 acceptance run — BLOCKED: run fb436e14 stopped with AI credits 402 (agent + drafter). Re-run once credits are topped up.
