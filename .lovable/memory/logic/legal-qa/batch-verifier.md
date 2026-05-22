---
name: batch-verifier
description: Single-call-per-claim batch verifier in core/verifier.ts replaces legacy chunk-of-8; safe to keep based on smoke validation.
type: feature
---

`supabase/functions/legal-qa/core/verifier.ts` issues **one LLM call per non-empty claim pack** (cap `MAX_BATCH=24`, snippet tiers 1200/700/450 chars by rank) instead of the legacy chunked-at-8 loop. Concurrency stays at 3 across claims. Model: `openai/gpt-5-mini`, `reasoning_effort: "low"`, 60s timeout.

**Safety net:** if the batched call returns coverage < 0.5, malformed JSON, http error, or 0 parseable verdicts, the claim falls back to the legacy chunk-of-8 loop and recovers missing verdicts. Any candidate still missing a verdict is defaulted to `unrelated`.

**Telemetry on `qa_logs.metadata.core.stage_runs[].metadata.verifier`:**
- `verifier_calls_before_estimate` — Σ ceil(candidates/8) (legacy baseline)
- `verifier_calls_naive_per_candidate` / `verifier_candidate_count_total` — Σ candidates (naive upper bound; this is what surfaces the real savings when packs are small)
- `verifier_nonempty_pack_count` — minimum possible call count
- `verifier_calls_after`, `verifier_batch_size_avg`, `verifier_batch_size_max=24`, `verifier_duration_ms`
- Safety counters: `missing_verdict_count`, `malformed_batch_count`, `zero_parseable_verdict_claim_count`, `http_error_count`, `json_parse_error_count`, `batch_fallback_count`
- Token usage: `prompt_tokens` / `completion_tokens` / `total_tokens`

**Validated 2026-05-22** across 5 healthy verify stages (3-question routing check + 3-question telemetry check): 0 missing verdicts, 0 malformed, 0 fallback, 0 http/json errors, citation_quality unchanged, no `[cite:LS#]` leftovers, no `ציטוט חסר`. With packs ≤8 candidates `calls_after == calls_before_estimate(ceil/8)` by construction — this is expected and `naive_per_candidate` is the field to read for actual savings (~8× in observed runs).

**Don't change** prompts, ledger contract, retrieval, drafter, citation engine, or UI when tuning the verifier — telemetry is additive and the verdict schema (`{candidate_id, support, rationale, pinpoint?, confidence?}`) is backward compatible. `confidence` is optional metadata that ledger ignores.
