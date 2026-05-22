# Fix: Planner Timeout (90s) on Research Queries

## What happened

The last query failed with:
> "לא הצלחנו לנתח את השאלה לתכנית מחקר. נסה לנסח אותה מחדש בצורה ממוקדת יותר."

`qa_logs` for run `5d411a87` shows the **plan** stage aborted after exactly **90,002 ms** — it hit our own `TIMEOUT_MS` ceiling. The planner is calling `openai/gpt-5` with `reasoning_effort: "low"`, which on long Hebrew questions can routinely exceed 90s of reasoning before producing the first token.

This is unrelated to the A+B+C+D+E retrieval changes — the request never reached retrieval.

## Why it regressed

Project memory (`stage-telemetry`) records that the planner is supposed to run on a **fast, low-latency** profile:
> "planner timeouts bumped to 30s/45s with reasoning_effort minimal/low"

The current `planner.ts` is on the heavier `openai/gpt-5` model with `reasoning_effort: "low"`. Per `decomposition-and-claim-map` memory, the planner was specified as **`gpt-5-mini`**. The drafter is the model that should be `gpt-5`, not the planner.

## Fix (planner-only, scoped)

Edit **only** `supabase/functions/legal-qa/core/planner.ts`:

1. `MODEL = "openai/gpt-5-mini"` (was `openai/gpt-5`).
2. `reasoning_effort: "minimal"` (was `"low"`).
3. Keep `TIMEOUT_MS = 90_000` as a hard safety ceiling, but expected wall-time drops to ~5–15s.
4. On `AbortError` from our own timeout, return a clearer error string (`planner_timeout_90s`) so future telemetry distinguishes "model too slow" from upstream aborts.

## Out of scope

- No changes to retrieval, ledger, citation_quality, drafter, verifier, footnotes, UI.
- No DB migration.
- No prompt edits (`PLANNER_SYSTEM` / `PLANNER_USER` untouched).
- No changes to the drafter model (stays on `openai/gpt-5`).

## Validation

After deploy, re-run the same question:
> "האם כישלון מערכתי באכיפת עבירת גביית דמי חסות (פרוטקשן) יכולה להוות מחדל חקיקתי חלקי בהגנה על הזכות לחיים וביטחון?"

Acceptance:
- `qa_logs.metadata.core.stage_runs[plan].status = "ok"`.
- `duration_ms` for the plan stage well under 30s.
- Pipeline proceeds to retrieval / verifier / drafter and returns an answer (so we can then evaluate the A+B+C+D+E retrieval results as originally intended).
