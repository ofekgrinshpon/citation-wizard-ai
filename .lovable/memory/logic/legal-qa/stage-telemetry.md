---
name: stage-telemetry
description: Per-stage runtime telemetry (StageRun) recorded in qa_logs.metadata.stage_runs for the Legal Research pipeline; models_used now distinguishes success from timeout/error.
type: feature
---

The Legal Research pipeline now records honest per-stage runtime data so admins can distinguish "model X actually completed" from "model X was configured but timed out".

**`StageRun` shape** (defined in `aiProvider.ts`):
```ts
{
  stage: "decomposition" | "claim_map" | "drafting",
  provider: "openai" | "gemini",
  model: string,
  reasoning_effort?: "minimal" | "low" | "medium" | "high",
  started_at: ISO,
  completed_at: ISO,
  duration_ms: number,
  status: "success" | "timeout" | "http_error" | "parse_error" | "no_tool_call" | "no_api_key" | "error",
  http_status?: number,
  error_message?: string,
}
```

**Stored at**:
- `qa_logs.metadata.stage_runs` — full array, one entry per stage attempted
- `qa_logs.metadata.models_used.{decomposition,claim_map,drafting}` — reduced to `{ provider, model, status, duration_ms }` where `model` is `null` if the stage didn't succeed

**Timeouts/reasoning** (set in `decomposition.ts`):
- decomposition: 30000 ms, `reasoning_effort: "minimal"` (gpt-5* only)
- claim_map: 45000 ms, `reasoning_effort: "low"` (gpt-5* only)
- drafting: 90000 ms (no reasoning override)

**`callPlannerJSON` returns** `{ data, run }` — never throws. Callers (`decomposeAndPlan`, `buildClaimMap`) push `run` to `stageRuns`.

**Legacy aliases** kept under `models_used.planner` and `models_used.drafter` for back-compat with existing dashboards but now suffixed `(failed:<status>)` when the stage didn't succeed.

**Diagnostic query**:
```sql
SELECT created_at,
       metadata->'stage_runs' as runs,
       metadata->'models_used'->'decomposition'->>'status' as decomp_status,
       metadata->'models_used'->'claim_map'->>'status' as claim_status,
       metadata->'drafting_path' as path
FROM qa_logs
WHERE task_mode = 'research'
ORDER BY created_at DESC
LIMIT 20;
```
