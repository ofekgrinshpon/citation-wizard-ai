
# Legal QA Pipeline Simplification Plan

## Target Architecture (6 stages)

```text
Question
  → Claim Planner            (existing planner, trimmed)
  → Research Query Planner   (Phase B output becomes load-bearing)
  → Retrieval (Local DB ∥ Perplexity, role-aware)
  → Verifier                 (source-claim alignment + citation shape)
  → Drafter                  (Hebrew memo)
  → Citation Cleanup         (regex/format only, merged from enrichment+CQ)
```

Everything else becomes telemetry, optional, or merged.

## Component Classification

| Component | Decision | Notes |
|---|---|---|
| planner | **Keep core** | Trim to: claims + factual_anchor_terms. Drop SR-coupled fields. |
| doctrineClassifier | **Optional shortcut + telemetry** | Already gated at 0.85. Keep `hint_only` logging. No retrieval/SR effect unless `applied`. |
| sourceRequirements | **Telemetry only** | Stop driving retrieval. Compute and log for analysis; do not inject. |
| SR injection (`SR_INJECT_RETRIEVAL`) | **Remove** | Replaced by researchQueryPlanner queries. |
| protected candidates (`SR_PROTECT_CANDIDATES`) | **Remove** | Verifier becomes the only gatekeeper. |
| researchQueryPlanner | **Promote to core** | Becomes the sole retrieval driver (DB + Perplexity). |
| local DB retrieval | **Keep core** | Driven by research_queries[role]. Keep factual_anchor pre-pass. |
| Perplexity retrieval | **Keep core** | Role-aware structured queries from planner. |
| verifier | **Keep core** | Single gate: shape + role match + URL allowlist. Absorbs candidate protection logic. |
| ledger | **Merge into verifier telemetry** | Persist `candidate_ledger[]` as verifier output, not a separate stage. |
| drafter | **Keep core** | Unchanged. |
| citation enrichment | **Merge into citation cleanup** | One pass: enrich + format + validate. |
| citation_quality | **Merge into citation cleanup** | Same pass. Drop separate stage. |
| partial-answer guard | **Keep core (lightweight)** | Move inside drafter post-check; not a stage. |
| telemetry | **Keep, expand** | stage_runs, doctrine_hint, sr_shadow, candidate_ledger, perplexity_drops. |

## What to Disable First (safe, reversible)

1. **`SR_INJECT_RETRIEVAL=0`** — stop SR roles from mutating retrieval queries.
2. **`SR_PROTECT_CANDIDATES=0`** — verifier decides alone.
3. **DoctrineClassifier**: keep only `applied` (≥0.85 + exact match) path active; `hint_only` already telemetry-only.
4. Collapse `enrich_citations` + `citation_quality` stages into one `citation_cleanup` stage (no logic change, just merged invocation + single stage_run entry).
5. Mark `ledger` as a sub-field of verifier output; stop emitting it as an independent stage.

## What to Keep Unchanged (this phase)

- Planner prompt/contract for claims + factual_anchor_terms.
- Local DB retrieval internals (FTS + vector + HNSW + factual anchor pre-pass).
- Drafter prompt and contracts.
- Citation regex/format library, Hebrew year prefix, Rule 8.3/2.8 validators.
- UI, SSE streaming, sidebar, history, subscription limits, RLS.
- DB schema.

## Risks

1. **Coverage regression on known doctrines** — disabling SR injection may hurt the 3–4 doctrines the catalog handled well. Mitigation: keep `applied`-tier doctrine shortcut, monitor those questions in validation set.
2. **Verifier overload** — becomes the only gate. Mitigation: keep current rules; add candidate_ledger telemetry to spot over-rejection.
3. **Research Query Planner is young** — Phase B only ran in shadow. Risk of weak queries for niche topics. Mitigation: fallback to a generic claim-text query per role when planner returns empty.
4. **Stage_runs / dashboards** depend on current stage names. Mitigation: keep names in telemetry even when stages are merged (alias).
5. **Latency** — removing protected candidates could mean more Perplexity drops → empty roles. Mitigation: verifier soft-accept when DB hits ≥1 for the role.

## Phased Rollout

- **S1 (flags only, no code paths removed)**: flip `SR_INJECT_RETRIEVAL=0`, `SR_PROTECT_CANDIDATES=0`. Validate.
- **S2**: promote researchQueryPlanner to drive retrieval (`used_by_retrieval: true`). SR computed but ignored.
- **S3**: merge `enrich_citations` + `citation_quality` → `citation_cleanup`. Merge `ledger` into verifier.
- **S4**: delete dead code paths for SR injection / protected candidates after 2 clean validation runs.

DoctrineClassifier stays in S1–S4 as a high-confidence shortcut only.

## Validation (5 questions, run after each step)

Mix of catalog and non-catalog:

1. דוקטרינת ההבטחה המנהלית — non-catalog, tests research planner.
2. אחריות רשות ציבורית במחדל — non-catalog, previously misclassified.
3. השתק פלוגתא (issue estoppel) — non-catalog, previously missed.
4. עילת חוסר סבירות — catalog doctrine, should still work via `applied` shortcut.
5. פיצויים מוסכמים §15 לחוק החוזים (תרופות) — statute-heavy, tests local DB + factual anchor.

Pass criteria per question:
- Completes (no `core_running` timeout).
- ≥1 role-matched citation from DB **or** Perplexity per planner claim with `expected_source_type`.
- Zero protected SR candidates injected for Q1–Q3, Q5.
- Q4 still surfaces the doctrine via `doctrine_classifier.applied`.
- `metadata.core.research_queries.by_claim` populated and non-empty.
- `metadata.core.candidate_ledger[]` shows `drop_reason` for every rejected source.

Aggregate target: ≥4/5 graded ≥7/10 on answer quality and source appropriateness; zero misclassification-driven SR injection.

## Out of Scope

- Verifier rule rewrite.
- Drafter prompt redesign.
- DB schema migrations.
- UI changes.
- New models or new Perplexity tiers.

Approval requested for the classification table and the S1 flag flip as the first concrete step.
