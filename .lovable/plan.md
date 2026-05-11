## Goal

Replace today's **static** LLM rerank (fixed prompt, fixed thresholds caselaw≥5 / non-caselaw≥3, fixed top-N) in `rerankLocalMatches()` with a **dynamic** ranker that adapts to the query (branch of law, intent, depth mode, source-pool composition) and uses multiple complementary signals — with safe rate-limit handling.

## Why this is worth doing

Current pain points in the middle of the pipeline (between retrieval and the critic):

1. **One-shot LLM scoring** of the full doc list — drops nuance when 15+ docs compete.
2. **Hard-coded thresholds** (`>= 5` caselaw, `>= 3` non-caselaw) — too strict for narrow corpora, too loose for broad ones.
3. **No diversity control** — top-N can be 6 chunks of the same landmark case.
4. **No structural branch-of-law gating** — relies on the LLM to enforce it.
5. **No reuse of earlier signals** — vector similarity, text-rank, action-verb bonus, and ClaimMap intent exist but aren't combined.

## High-level design

```text
candidates (≤ ~40 chunks / ~15 docs)
        │
        ▼
[1] Query Profiler  ──── branch(es) of law, intent (define / compare / apply / criticize),
                          depth (Fast/Deep), expected source mix
        │
        ▼
[2] Signal Layer    ──── per-doc feature vector:
                          • vector_sim (max chunk)
                          • text_rank (max chunk)
                          • llm_rerank (0–10, batched in groups of 8, branch hint in prompt)
                          • branch_match (0 / 0.5 / 1 vs query profile)
                          • source_type_fit (per intent)
                          • recency_bonus (caselaw + legislation)
                          • action_verb_bonus (existing)
        │
        ▼
[3] Dynamic Scorer  ──── weighted sum; weights chosen by Query Profile + Depth
        │
        ▼
[4] Adaptive Gate   ──── pool-relative floor: max(absolute_min, p75 − Δ)
        │
        ▼
[5] Diversity Pass  ──── MMR over chunk embeddings (already in memory)
        │
        ▼
ranked SourcePack (core / supporting / secondary unchanged)
```

## Intent-aware weights — special rule for `comparative`

The weighting profile is keyed on the **intent** detected by the Query Profiler. The `comparative` intent is the one explicit exception users asked to call out:

| Intent | vector | text | llm | branch | recency |
|---|---|---|---|---|---|
| `define` | 0.25 | 0.15 | 0.45 | 0.10 | 0.05 |
| `apply` | 0.25 | 0.15 | 0.45 | 0.10 | 0.05 |
| `criticize` | 0.20 | 0.15 | 0.50 | 0.10 | 0.05 |
| **`comparative`** | **0.30** | **0.20** | **0.45** | **0.00** | **0.05** |

For `comparative`, `branch_match.weight = 0` **and** the branch-mismatch hint is removed from the rerank LLM prompt — comparing contract law to family law remedies is a legitimate cross-branch question, and the gate must not punish it. The remaining 0.10 is redistributed to `vector` and `text` so total = 1.

Implementation: a single `INTENT_WEIGHTS` map in `dynamicRerank.ts`, normalized at load. No code branching per intent — just a table lookup.

## Rate limits — parallel batches must not 429

Plan calls for batching the LLM rerank into groups of 8 docs and firing them in parallel. Without guardrails, ~5 concurrent calls in the same ms can trip the Lovable AI Gateway rate limit (429). Mitigations:

1. **Bounded concurrency** — use a small `pLimit`-style semaphore (`MAX_RERANK_CONCURRENCY = 3`, env-overridable). Even with 24 docs (3 batches), this means 3 in flight, never 5+.
2. **Jittered staggered start** — before each batch fetch, `await sleep(randomInt(0, 120))`. Spreads the burst over ~120ms so the gateway's per-second bucket doesn't see them as simultaneous.
3. **429 / 402 handling per batch**:
   - On 429: exponential backoff `[400ms, 1200ms, 3000ms]` with jitter, max 3 retries. Honor `Retry-After` header if present.
   - On 402 (credits): fail fast, no retry, surface upstream as today.
   - On other 5xx: 1 retry with 800ms backoff, then give up that batch.
4. **Per-batch fallback, not pipeline failure** — if a batch ultimately fails after retries, its docs fall back to `llm_score = vector_sim * 10` (so they're scored on retrieval signals alone, not dropped). This keeps the request alive at degraded quality.
5. **Single shared limiter across all stages** — `dynamicRerank.ts` exports a module-level limiter so that if another stage (critic, revision) is also calling the gateway, total concurrency stays bounded. Other stages opt-in by importing it.
6. **Telemetry** — log per-request `rerank_v2.batches = { total, retried_429, retried_5xx, failed_fallback }` in `qa_logs.metadata` so we can tune `MAX_RERANK_CONCURRENCY` from real data.

The existing pipeline does not have a global rate limiter today, so this also benefits the critic pass and Perplexity-completion stages indirectly (those can import the same limiter later if needed).

## Concrete changes

### File: `supabase/functions/legal-qa/dynamicRerank.ts` (new, ~300 LOC)

- `profileQuery(question, taskMode, depthMode, claimMap?) → QueryProfile`
  - Cheap heuristic + 1 `gemini-2.5-flash-lite` call (subject to limiter), cached per request, returning `{ branches[], intent, preferredTypes, recencyMatters }`.
- `INTENT_WEIGHTS` table (see above) with normalization helper.
- `scoreCandidates(matches, profile, llmScores) → ScoredMatch[]` — pure function.
- `adaptiveGate(scored, profile) → ScoredMatch[]` — pool-relative floor.
- `mmrSelect(scored, k, lambda=0.7) → ScoredMatch[]` — uses in-memory chunk embeddings.
- `runBatchedRerank(docs, question, profile) → Map<docId, number>`:
  - Splits docs into groups of 8.
  - Submits via shared `limiter(MAX_RERANK_CONCURRENCY=3)` with jitter + retry/backoff.
  - Per-batch fallback to `vector_sim * 10` on terminal failure.
- `limiter` — small dependency-free semaphore exported at module scope.

### File: `supabase/functions/legal-qa/index.ts`

- Refactor `rerankLocalMatches()` to delegate to `dynamicRerank.ts`.
- Remove hard floors at lines ~1693–1770; replace with `adaptiveGate` + `mmrSelect`.
- Pass `branchHint` from `QueryProfile` into the rerank prompt **only when intent ≠ comparative**.
- Add `qa_logs.metadata.rerank_v2` with: `profile`, `signal_breakdown` per kept doc, `gate_floor`, `mmr_picks`, `batches` telemetry.

### File: `supabase/functions/legal-qa/modeProfiles.ts`

Add a `rerank` block per mode (Fast / Deep) — controls `k`, `mmr.lambda`, and per-mode multiplier on `llm` weight. Intent weights stay in `dynamicRerank.ts`.

### Feature gate + rollout

- `DYNAMIC_RERANK_ENABLED` env, default `false` initially.
- `MAX_RERANK_CONCURRENCY` env, default `3`.
- Shadow A/B via existing `shadowAbLogger.ts` for ~3 days; flip default to `true` after metrics pass.

## Out of scope (follow-ups)

- Cross-encoder model (`bge-reranker` etc.) — not on Lovable AI Gateway today.
- Learned weights from `qa_logs` history — collect via shadow A/B first.
- Re-ranking Perplexity completions — needs its own pass.

## Telemetry & success metrics

In `qa_logs.metadata.rerank_v2`:

- `profile.branches`, `profile.intent`, `weights_applied` (so we can verify branch=0 for comparative)
- Per kept doc: `{ vector, text, llm, branch, recency, final_score, mmr_picked }`
- `gate_floor`, `dropped_count`, `dropped_reasons`
- `batches: { total, retried_429, retried_5xx, failed_fallback, p95_ms }`

Success = on the academic + research eval sets:

- Critic `claims_supported` ratio ≥ baseline
- Distinct documents per chapter ≥ baseline + 1
- Zero off-branch citations in non-comparative spot-checks; **non-zero acceptance of cross-branch in comparative spot-checks**
- 429 retries < 5% of batches; `failed_fallback` < 1%
- p95 latency within +1.5s of baseline
