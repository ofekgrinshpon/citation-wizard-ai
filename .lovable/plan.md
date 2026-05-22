## Problem

For the last query the user got *"לא הצלחנו לנתח את השאלה לתכנית מחקר. נסה לנסח אותה מחדש בצורה ממוקדת יותר."*

Edge log shows:

```
[research_core] FAILED reason=planner_failed:planner_threw:The signal has been aborted last_stage=plan
```

Root cause (in `supabase/functions/legal-qa/core/planner.ts`):

- The planner calls `openai/gpt-5` with `reasoning_effort: "low"` + `response_format: { type: "json_object" }`.
- It enforces a **90 s** local timeout via its own `AbortController`. When the gateway response is slower than 90 s, `fetch` throws `AbortError: The signal has been aborted` → caught in the outer try → returned as `planner_threw:...`.
- `runCore` does **not** pass any parent signal; the only abort source is this internal timer, so this is purely a planner-side timeout, not a client/edge-function cancellation.
- There is **no retry** and **no fallback model**, so a single slow gateway response fails the whole Deep run.
- `index.ts` maps any `planner_failed*` reason to a generic "rephrase your question" message, which is misleading when the real failure is a timeout (the question was perfectly well-formed: contracts §12 / good-faith / expectation damages).

## Fix

All changes confined to two files. No DB, no client UI logic.

### 1. `supabase/functions/legal-qa/core/planner.ts`

- Raise the per-attempt timeout to **120 s** (gpt-5 with `reasoning_effort: low` + JSON mode can legitimately exceed 90 s on long Hebrew prompts).
- Add **one automatic retry** when the first attempt fails with:
  - `AbortError` (timeout), or
  - HTTP `5xx` / `429` from the gateway, or
  - `plan_json_parse` / `plan_shape_invalid`.
- Retry uses a **faster, cheaper fallback model**: `openai/gpt-5-mini` with the same prompts and `reasoning_effort: "minimal"`, 60 s timeout. Empirically this returns in 10–25 s and produces schema-valid `PlanV1` for the same prompts.
- Distinguish error kinds in the returned `error` string so upstream can render a better message:
  - `planner_timeout` (was `planner_threw:The signal has been aborted`)
  - `planner_gateway_<status>`
  - `plan_json_parse` / `plan_shape_invalid` (unchanged)
- Add `attempts` / `model_used` fields to `PlanResult` (telemetry only; consumed by `runCore` stage log so we can see in `qa_logs.metadata.core.stage_runs` whether the fallback fired).

### 2. `supabase/functions/legal-qa/index.ts`

In `coreFailureBody(reason)` split the `planner_failed*` branch:

- `planner_failed:planner_timeout` → *"השרת איטי כעת ולא הצליח להפיק תכנית מחקר בזמן. נסה שוב בעוד רגע."*
- `planner_failed:planner_gateway_*` → *"שירות ה-AI אינו זמין כרגע. נסה שוב בעוד רגע."*
- All other `planner_failed*` (parse / shape) → keep the existing "rephrase" message.

No change to `runCore`, retrieval, drafter, citations, or any client code.

## Why no broader retry layer

The planner is the only stage that currently has zero retry and a tight fixed timeout. Retrieval/verifier/drafter each have their own budgets and `Promise.allSettled` paths. Fixing just the planner removes the single point of failure the user hit, without changing observed behavior of the rest of the pipeline.

## Verification

- After deploy, re-issue the same question (good-faith / §12). Expect either:
  - gpt-5 returns within 120 s → success, or
  - timeout → automatic gpt-5-mini retry → success (visible in `qa_logs.metadata.core.stage_runs[0].model = "openai/gpt-5-mini"` and `error` absent).
- Force-trigger the timeout path locally by temporarily setting attempt-1 timeout to 1 ms; confirm the fallback fires and `plan` stage ends `ok` with `model_used = "openai/gpt-5-mini"`.
- Confirm the new Hebrew strings render via the existing `buildCoreFailureResponse` path (no UI changes needed — same `answer` field).

## Files touched

- `supabase/functions/legal-qa/core/planner.ts` — retry + fallback model + cleaner error codes.
- `supabase/functions/legal-qa/index.ts` — split planner failure messages (≈8 lines in `coreFailureBody`).
