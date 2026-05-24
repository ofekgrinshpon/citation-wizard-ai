**P6.5 — Claim Analyzer escalation: retry on transient failure (analyzer-only)**

**Problem recap**

Your last query hit this exact failure mode:
- `claim_analyzer.initial` (gpt-5-mini): 19.5s, returned a degenerate tool payload (empty `claims`, missing `legal_area`/`answer_type`, non-finite `confidence`).
- `claim_analyzer.escalated` (gpt-5): **279ms, ok:false** — that's a transient upstream/network failure from the AI gateway, not a real model run.
- Pipeline short-circuits at P2 and returns the P2 stub answer (`"[stub] התשובה תיווצר בשלב P5…"`).

Today the escalation runs **exactly once**. One blip kills the whole job.

**Scope (very narrow)**

Change only the escalation path inside `supabase/functions/legal-research-v1/stages/claimAnalyzer.ts`. Nothing else.

**Changes**

1. In `runClaimAnalyzer`, wrap the existing gpt-5 escalation `callOpenAIJsonTool(...)` in a small retry helper:
   - **Max 2 attempts** total for the escalation (i.e. 1 retry after the first failure).
   - **Retry condition**: only when the call returns no usable `data` AND the elapsed time is clearly a transient failure (e.g. `ms < 2000`), OR the call throws. Do NOT retry on a real schema-invalid response from the model (that's a content issue, not a transport issue).
   - **Backoff**: 800ms fixed delay between attempts (no exponential, no jitter — keep it boring).
   - **No new timeout logic, no new network code** beyond the retry loop.

2. Record both attempts in `stage_runs`:
   - `claim_analyzer.escalated` (attempt 1) — as today.
   - `claim_analyzer.escalated_retry` (attempt 2, only if it happened) — with `model: MODEL_FULL`, its own `ms`, `ok`, `escalated: true`.

3. The final `validated` value is taken from whichever attempt succeeded last (same as today, just over the retry result).

4. `escalation_reasons` returned unchanged.

**Out of scope (do not touch)**

- `claim_analyzer.initial` behavior (no retry on mini).
- Query planner, retrieval, verifier, drafter, marker validator, footnotes, citation engine.
- `legal-qa/*`, write_chapter, pleading_analysis (still offline).
- `LegalResearchV1Panel.tsx` and any other frontend file.
- Source quality, Perplexity admission, ranking, verifier batching/prompt, drafter prompt.
- No new env flags, no config.toml changes, no schema changes.

**Risk**

Effectively zero on the happy path: when the first escalation succeeds, behavior is byte-identical to today. The only added cost is one extra gpt-5 call in the rare case the first escalation fails transiently — and in that case today's behavior is a hard 422 + stub answer, so any successful retry is strictly better.

**Validation**

- Deploy `legal-research-v1`.
- Re-run the failing query from the UI; expect either a real P5 answer or, if the model genuinely cannot analyze, a `planning_error` with the analyzer escalation showing **two** stage_runs (`escalated` + `escalated_retry`) — not a 279ms one-shot.
- Spot-check 1–2 fixtures from `eval/legal-research-v1/fixtures.json` via the existing P6.3 runner pattern (no new runner needed) to confirm no regression on the happy path. Acceptance: same `marker_validation.ok`, same `used_sources ⊆ verifier.usable`, no change in word counts beyond noise.
- No full 6-fixture smoke required (change is isolated to a transient-error branch that doesn't fire on the happy path).

**Technical detail**

```text
runClaimAnalyzer
├── initial call (mini or full per pre-escalation)         [unchanged]
├── if initial on gpt-5 → return                            [unchanged]
├── if post-checks ok → return                              [unchanged]
└── escalation block:
    ├── attempt 1: callOpenAIJsonTool(gpt-5, reasoning:medium)
    │     push stage_run "claim_analyzer.escalated"
    ├── if attempt 1 has no usable data AND (threw OR ms < 2000):
    │     wait 800ms
    │     attempt 2: callOpenAIJsonTool(gpt-5, reasoning:medium)
    │     push stage_run "claim_analyzer.escalated_retry"
    │     validated = validateAnalyzer(attempt 2.data)
    │     raw_text_final = attempt 2.raw_text
    └── else: validated = validateAnalyzer(attempt 1.data)   [unchanged]
```

**Stop condition**

If the retry attempt itself also fails or returns invalid schema → fall through to the existing `planning_error` path. No further retries, no fallback to mini, no behavior change downstream.
