---
name: factual-anchor-retrieval
description: Planner emits factual_anchor_terms (subjects) + concept_anchor_terms (doctrinal phrases) lifted from question; retrieveForPlan pre-pass runs FTS+vector on both and injects hits into every claim. Vector floor lowered to 0.35. defaultEmbed instrumented as embed_health in qa_logs metadata.
type: feature
---

# Anchor retrieval pre-pass + vector path hardening

## What

`retrieveForPlan` runs a single FTS+vector pre-pass over question-derived anchor terms BEFORE per-claim retrieval, then injects the results into every claim's candidate pool. Two complementary anchor types:

- **`factual_anchor_terms`** — concrete subjects from the question ("דמי חסות", "פרוטקשן", "החברה הערבית"). Surfaces factual reports (Knesset MMM, gov briefs) that doctrinal `search_targets` would miss.
- **`concept_anchor_terms`** — doctrinal key phrases from the question ("מחדל חקיקתי חלקי", "חובה לחוקק"). Surfaces academic articles/monographs whose titles use a synonymous framing of the doctrine (e.g. "סעד החובה לחוקק" reachable from "חובה לחוקק" even when claims only mention "מחדל חקיקתי").

Both are MANDATORY in the planner prompt (rules 12 and 13). Combined cap: 10 unique terms.

## Vector path fixes

`core/retrieval.ts` `localVector` — `match_threshold` lowered from **0.55 → 0.35**. At 0.55, 9/10 recent runs returned `local_vector_count=0` across all claims because text-embedding-3-small@768d on Hebrew typically scores 0.30-0.55. The 0.55 quality gate still applies downstream at `assembleSourcePack` for core-tier promotion.

`runCore.ts` `defaultEmbed` replaced with `makeInstrumentedEmbed(health)` — captures `{ calls, ok, failed, missing_key, last_status, last_error, total_latency_ms }` into `qa_logs.metadata.core.embed_health` so we can diagnose 0-vector runs immediately (missing key vs 429 vs no-match).

## Perplexity scholarship allowance

`approvedWeb` accepts `allowScholarship=true` when `claim.required_evidence` includes `scholarship` or `doctrinal_definition`. The system prompt then adds `source_type:"scholarship"` to the allowed enum with a whitelist hint (lawjournal.huji.ac.il, law.tau.ac.il, mishpatim.tau.ac.il, idclawreview.com). TIER_A domain filter already permits these hosts.

## Files

`core/types.ts` (`PlanV1.concept_anchor_terms`), `core/prompts.ts` (rule 13 + schema), `core/retrieval.ts` (anchor merge, vector floor 0.35, approvedWeb signature), `core/runCore.ts` (instrumented embed + embed_health metadata).

## Verification signals in qa_logs

- `metadata.core.embed_health.ok > 0` — vector path actually firing
- `metadata.core.retrieval.per_claim[*].local_vector_count > 0` — HNSW returning hits
- `plan.concept_anchor_terms` non-empty for any doctrinal question
