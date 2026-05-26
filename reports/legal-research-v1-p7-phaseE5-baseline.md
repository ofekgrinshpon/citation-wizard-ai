# P7 Phase E.5 — Fresh End-to-End Baseline (L1–L6)

Post-Phase-D / E.1 / E.4a / E.4b. No code changed. Runner:
`scripts/legal-research-v1-p7-phaseE5-baseline.ts`. Per-fixture JSON:
`reports/legal-research-v1-p7-phaseE5-{L1..L6}.json`. Summary:
`reports/legal-research-v1-p7-phaseE5-summary.json`.

All times in ms. `verifier_ms` = wall (batch-parallel); claim/planner/perplexity/drafter from `stage_runs`.

## Per fixture

| Fx | total | analyzer | planner | local | perplexity | verifier (wall / batches / parallel) | drafter | pool | verified | usable/dropped | used | footnotes | foot==used | marker.ok | id leak |
|----|-------|----------|---------|-------|------------|--------------------------------------|---------|------|----------|----------------|------|-----------|-----------|-----------|---------|
| L1 | 184,988 | 24,716 | 41,774 | 2,811 | 36,885 | 39,484 / 1 / true | 42,006 | 9 | 9 | 6/3 | 6 | 6 | ✓ | ✓ | no |
| L2 | 221,521 | 26,366 | 57,842 | 1* | 50,182 | 42,533 / 1 / true | 44,448 | 16 | 16 | 11/5 | 9 | 9 | ✓ | ✓ | no |
| L3 | 253,325 | 20,921 | 54,791 | 2,438 | 38,711 | 68,189 / 1 / true | 70,599 | 19 | 19 | 3/16 | 3 | 3 | ✓ | ✓ | no |
| L4 | 179,454 | 23,743 | 38,811 | 1,939 | 48,481 | 20,174 / 1 / true | 48,144 | 4 | 4 | 3/1 | 3 | 3 | ✓ | ✓ | no |
| L5 | 189,170 | 22,344 | 48,139 | 4,068 | 33,903 | 40,906 / 2 / true | 43,741 | 30 | 30 | 15/15 | 9 | 9 | ✓ | ✓ | no |
| L6 | 249,892 | 47,243 | 43,461 | 2* | 59,344 | 42,458 / 1 / true | 57,287 | 13 | 13 | 11/2 | 9 | 9 | ✓ | ✓ | no |

`*` L2 and L6 reported `local_retrieval.ms` ≈ 1–2 ms. The candidate pool still contains local sources, so the stage executed; the field likely captures a fast-path / pre-cached read. Worth a one-line investigation later, not a blocker.

## Aggregate

- **avg total wall**: **213,058 ms** (≈ 3:33)
- **median total wall**: **205,346 ms** (≈ 3:25)
- **avg local retrieval**: **1,877 ms** (target met; was ~34,000 ms pre-E.4)
- **slowest fixture**: **L3 — 253,325 ms**, dominated by verifier (68.2 s wall) + drafter (70.6 s). Drafter escalated to gpt-5.
- **timeouts**: text=0, vector=0 across all six fixtures ✓
- **stub answers**: none
- **marker_validation.ok**: true on all six
- **internal_id_leak**: false on all six
- **footnote_count == used_sources**: true on all six
- **verifier escalation**: occurred on at least one fixture (`model_final ≠ model_initial`)
- **drafter escalation**: occurred on at least one fixture (gpt-5)

## Stage-share of wall (approx, per fixture)

The pipeline is now LLM-stage-bound, not retrieval-bound. On every fixture, **analyzer + planner + perplexity + verifier + drafter ≈ 95–99 %** of wall. Local retrieval is **< 2 %** on five of six fixtures and 2.1 % on L5.

- planner alone: 38.8 s – 57.8 s
- claim_analyzer: 20.9 s – 47.2 s (L6 outlier)
- perplexity: 33.9 s – 59.3 s
- verifier wall: 20.2 s – 68.2 s
- drafter: 42.0 s – 70.6 s

## Quality

- All six pipelines completed with valid markers, no id leak, no footnote mismatch, no stubs.
- L4 still hits the thin-pool issue (pool=4, used=3). Already on backlog.
- L6 vector candidates still surface scholarship tagged as `binding_case_law` (verifier accepts; drafter filters). Already on backlog.
- No new source-quality regression vs the E.4b spot-check.

## Comparison anchors

| Metric | Phase D / E.2 baseline | E.5 (now) |
|---|---|---|
| Local retrieval avg | ~34,000 ms | **1,877 ms** |
| Text timeouts (sum across L1–L6) | 27 | **0** |
| Vector timeouts (sum across L1–L6) | 15 | **0** |
| Pipeline stage-mix | retrieval-bound | LLM-bound |
| marker.ok across L1–L6 | true | true |

## Next-step candidates (not implemented; for planning only)

The four biggest remaining latency blocks, ranked by share of wall:

1. **Drafter** (42–71 s, often escalated to gpt-5) — investigate prompt length, model choice tiering, or partial streaming.
2. **Planner** (39–58 s, gpt-5-mini) — investigate planner output size / claim count / prompt verbosity.
3. **Perplexity** (34–59 s) — already external; investigate per-claim concurrency and per-query timeout.
4. **Verifier wall** (20–68 s) — the parallel path works; the residual cost is gpt-5-mini reasoning latency, not orchestration.

Backlog (do not implement now, per instruction):
- role-tag accuracy for vector candidates (L6-style scholarship → binding_case_law)
- L4 thin-pool planner issue
- one-line check on `local_retrieval.ms = 1` reporting on L2/L6

Stopping after the baseline as requested.
