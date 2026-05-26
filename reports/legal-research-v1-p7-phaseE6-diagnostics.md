# P7 Phase E.6 — LLM-Stage Latency Diagnostics (L1–L6)

Diagnostics only. No code changed. Raw per-fixture JSON in
`reports/legal-research-v1-p7-phaseE6-diagnostics.json`. Based on the
E.5 baseline runs.

## Per-fixture table

All times in ms. `init` = `drafter.initial`. `esc` = escalated. `repair` = marker validation deterministic repair fired. `words` = answer word count.

| Fx | total | analyzer (model) | planner (ms / claims / queries) | perplexity (wall / sum / N / slowest) | verifier (wall / batches / esc) | drafter (init / wall / esc, init→final) | sources passed→used→footnotes | marker.ok / repair / leak / missing / unused | answer words |
|----|------:|---|---|---|---|---|---|---|---:|
| L1 | 184,988 | 24,716 (gpt-5-mini) | 41,774 / 5 / 12 | 36,885 / 36,876 / 6 / 9,089 | 39,484 / 1 / 0 | 41,999 / 42,006 / no, mini→mini | 6 → 6 → 6 | ✓ / no / no / 0 / 0 | 476 |
| L2 | 221,521 | 26,366 (gpt-5-mini) | 57,842 / 4 / 10 | 50,182 / 50,176 / 10 / 9,264 | 42,533 / 1 / 0 | 44,443 / 44,448 / no, mini→mini | 11 → 9 → 9 | ✓ / **yes** / no / 0 / 0 | 670 |
| L3 | 253,325 | 20,921 (gpt-5-mini) | 54,791 / 4 / 11 | 38,711 / 38,697 / 6 / 12,733 | 68,188 / 1 / **1** | **24,722 / 70,599 / yes, mini→gpt-5** | 3 → 3 → 3 | ✓ / no / no / 0 / 0 | 460 |
| L4 | 179,454 | 23,743 (gpt-5-mini) | 38,811 / 4 / 10 | 48,481 / 48,472 / 6 / 17,930 | 20,174 / 1 / 0 | 48,139 / 48,144 / no, mini→mini | 3 → 3 → 3 | ✓ / no / no / 0 / 0 | 341 |
| L5 | 189,170 | 22,344 (gpt-5-mini) | 48,139 / 5 / 13 | 33,903 / 33,897 / 6 / 7,563 | 40,905 / 2 / 0 | 43,736 / 43,741 / no, mini→mini | 15 → 9 → 9 | ✓ / **yes** / no / 0 / 0 | 598 |
| L6 | 249,892 | **47,243 (gpt-5)** | 43,461 / 5 / 10 | 59,344 / 59,335 / 10 / 8,023 | 42,458 / 1 / 0 | 57,283 / 57,287 / no, mini→mini | 11 → 9 → 9 | ✓ / no / no / 0 / 0 | 773 |

## Key findings

**1. Perplexity is sequential.** On every fixture `wall ≈ sum_of_per_query_ms` (delta < 0.1 %). Six to ten Perplexity queries are issued back-to-back at 4–18 s each. This is the single biggest safe latency lever in the pipeline.

| Fx | wall | sum_per_query | wall ≈ sum? |
|----|------:|------:|---|
| L1 | 36,885 | 36,876 | ✓ sequential |
| L2 | 50,182 | 50,176 | ✓ sequential |
| L3 | 38,711 | 38,697 | ✓ sequential |
| L4 | 48,481 | 48,472 | ✓ sequential |
| L5 | 33,903 | 33,897 | ✓ sequential |
| L6 | 59,344 | 59,335 | ✓ sequential |

Theoretical wall under full parallel = max per-query (7.5–17.9 s). Practical wall under bounded concurrency = a small multiple of slowest. Expected save: **20–45 s per fixture**.

**2. Drafter escalated only on L3.** All other fixtures stayed on `gpt-5-mini` and succeeded first try.
- L3 initial draft on `gpt-5-mini` took 24.7 s and was rejected; final run on `gpt-5` brought wall to 70.6 s. **Escalation cost on L3 ≈ +46 s.**
- L2 and L5 used **deterministic repair** (no LLM re-run) — repair ran without escalation; this is the desired path. Cost is negligible.

**3. Planner is a flat 38.8–57.8 s on `gpt-5-mini`, never escalates, never truncates.**
- Output sizes are small: 10–13 queries, 4–5 claims.
- Planner latency does **not** correlate cleanly with question length, claim count, or query count (L2: 4 claims / 10 queries = 57.8 s slowest; L4: same shape = 38.8 s fastest). Variance is dominated by model latency, not prompt size.

**4. Analyzer is 20.9–26.4 s on `gpt-5-mini` on 5/6 fixtures; L6 escalated to `gpt-5` (47.2 s).** Escalation reason not surfaced in `stage_runs.error`. Worth instrumenting.

**5. Verifier orchestration is healthy.**
- Parallel path active on every fixture (`parallel=true`, `concurrency_limit=2`).
- L5 actually used 2 batches: wall=40.9 s vs sum=78.4 s → **~37 s saved by parallel** (the E.1 win held up).
- L3 had `batch_count=1` but verifier wall = 68 s with one batch escalation. The escalation is a single per-batch LLM call cost, not an orchestration issue.

**6. Quality**
- All six: `marker_validation.ok=true`, no `internal_id_leak`, `unused_sources=0`, `missing_sources=0`, no stub.
- Footnote count == used_sources on all six.
- No source-quality regression vs E.4b/E.5 spot-check.

## Stage-share of average wall (avg total = 213,058 ms)

| Stage | Avg ms | Share | Notes |
|---|---:|---:|---|
| Drafter | 51,038 | 24.0 % | L3 outlier (70.6 s, gpt-5 escalation) |
| Perplexity | 44,584 | 20.9 % | **Sequential — biggest safe lever** |
| Verifier (wall) | 42,290 | 19.8 % | Parallel orchestration is fine |
| Planner | 47,470 | 22.3 % | gpt-5-mini, no escalations |
| Analyzer | 27,556 | 12.9 % | L6 escalation outlier |
| Local retrieval | 1,877 | 0.9 % | Solved in E.4 |
| **Sum LLM stages** | **213k** | ~100 % | LLM-bound, as expected |

Stages run sequentially in the pipeline, so these shares add to ~100 %.

## Ranked improvement candidates (do not implement; for decision only)

### Zero-risk telemetry / UI
- T1. Add `drafter.escalation_reason` (which gate triggered escalation — missing_sources, schema, marker, leak).
- T2. Add `analyzer.escalation_reason` and capture the failing condition (L6 escalation cause is opaque).
- T3. Surface `perplexity.per_query` as proper per-claim breakdown in `aggregate` (today only `ms` and list).
- T4. Add streaming/progress UI so the user sees stage transitions; perceived latency improves even without raw-ms changes.

### Low-risk orchestration
- O1. **Parallelize Perplexity per-claim queries** with `Promise.all` + a small concurrency cap (e.g. 4). Pattern is identical to the verifier E.1 pattern. Expected save: **20–45 s per fixture**, no change to admission rules, candidates, prompts, or quality. Single biggest safe win.
- O2. Run **analyzer and planner in pipeline with a single combined call** *only if* they share enough context — skip if it requires prompt changes. Otherwise leave them sequential.
- O3. Verifier already parallel; raise `concurrency_limit` from 2 → 3 only if backend rate limits allow. Marginal; conditional on quota headroom.

### Medium-risk prompt / schema simplification
- P1. Investigate planner prompt length — 40–58 s on gpt-5-mini for 10–13 queries is high. Trimming system prompt or splitting plan generation could cut 10–20 s. Risk: planner output quality (query coverage) — needs A/B.
- P2. Investigate drafter escalation gate on L3 — if the escalation criterion is over-strict (e.g., triggering on a benign signal), tightening it could keep L3 on `gpt-5-mini` and save ~46 s. Risk: source-grounding quality regression.
- P3. Use a smaller verifier model on small batches (1 claim/few candidates). Risk: verifier strictness regression — out of scope per user instruction.

### High-risk source-quality changes
- H1. Drop scholarship-class Perplexity queries on questions where local pool already has strong authority (saves 1–2 Perplexity queries, ~10 s). Risk: changes admission/source mix — explicitly forbidden by instructions.
- H2. Skip analyzer when planner can infer claims directly. Risk: claim quality regression.
- H3. Tighten Perplexity per-query timeout below the current ~18 s observed slowest. Risk: silent admission loss.

## Recommendation

The single best next step is **O1 (parallelize Perplexity)** — it is an orchestration-only change, copy-pastes the verifier E.1 pattern, has no source-selection or admission impact, and would cut average wall by ~20–35 % (from 213 s to ~150–170 s). Everything else is either telemetry, riskier, or marginal.

Stopping after the diagnosis as requested.
