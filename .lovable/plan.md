# Remove pilot gate — Core is the default Deep pipeline (no auto-fallback)

## Goal

When `taskMode === "research"` and `depth === "deep"`, always run **Research Core**. If Core fails, return a clear error response from Core and persist a diagnostic `qa_logs` row with `pipeline_used="core_failed"`. Do **not** auto-fallback to V4/V3/V1. Manual rollback stays available via `RESEARCH_PIPELINE=v4` (or `v3`).

Fast, academic, and the V4/V3/V2 modules are untouched.

## Routing matrix (after change)

| `RESEARCH_PIPELINE` env | Deep dispatch                                            |
|-------------------------|----------------------------------------------------------|
| unset / `core` (new default) | **Core only.** Success → return Core. Failure → return Core failure response; write `pipeline_used="core_failed"`. |
| `v4`                    | Existing V4 → V3 → V1 chain (unchanged).                |
| `v3`                    | Existing V3 → V1 chain (unchanged).                     |

Fast mode, academic chapters, and `evalForceLegacy` keep their current paths.

## Code changes

### 1. `supabase/functions/legal-qa/researchV4Pipeline.ts`

Flip the default in `researchPipelineMode()` from `"v4"` to `"core"`:

```ts
export function researchPipelineMode(): "core" | "v4" | "v3" {
  const raw = (Deno.env.get("RESEARCH_PIPELINE") ?? "").trim().toLowerCase();
  if (raw === "v3") return "v3";
  if (raw === "v4") return "v4";
  return "core"; // new default
}
```

### 2. `supabase/functions/legal-qa/core/pilotGate.ts`

Delete the file. Remove the import from `index.ts`. (We keep `corePilotLabel` only if other modules use it — `rg` shows only `index.ts`, so it goes too.)

### 3. `supabase/functions/legal-qa/index.ts` (lines ~2486–2758)

Replace the Stage-0/Stage-A/Stage-B dispatch block with this shape:

```ts
const pipelineMode = researchPipelineMode();
const deepDispatchEligible = /* unchanged */;

if (deepDispatchEligible) {
  const asyncRunId = typeof body?._asyncRunId === "string" ? body._asyncRunId : null;
  const deepQaLogId = asyncRunId ?? crypto.randomUUID();
  emitStage("frame", "complete");

  const persistSuccess = /* unchanged */;

  // ── Core path (default, and when RESEARCH_PIPELINE=core) ────────────
  if (pipelineMode === "core") {
    const coreCtx: Record<string, unknown> = { core_attempted: true };

    // Pre-insert "core_running" row (unchanged behavior).
    await adminClient.from("qa_logs").upsert({ …, metadata: { ...coreCtx, pipeline_used: "core_running" } }, { onConflict: "id" });

    try {
      const core = await runCore({ question, adminClient, drafterTimeoutMs: modeProfile.drafterTimeoutMs, forceDrafterModel, onStage: emitStage });

      // Extract diagnostics (stage_runs, last_stage, acceptance_errors, partial) — same logic as today.
      hydrateCoreCtx(coreCtx, core);

      if (core.ok) {
        await persistSuccess("core", core, coreCtx);
        return buildResponse(core.answer, core.footnotes, core.citations, { footnotes_count: core.footnotes.length });
      }

      // Failure: persist diagnostic row and return Core failure response. NO fallback.
      coreCtx.core_fallback_reason = core.fallbackReason ?? "core_ok_false";
      await adminClient.from("qa_logs").upsert({
        id: deepQaLogId, user_id: user.id, question: question.substring(0, 500),
        answer: null, footnotes: [], task_mode: taskMode,
        local_footnotes_count: 0, perplexity_footnotes_count: 0, total_footnotes: 0,
        metadata: { ...(core.metadata ?? {}), ...coreCtx, pipeline_used: "core_failed", duration_ms: Date.now() - t0 },
      }, { onConflict: "id" });

      return buildCoreFailureResponse(coreCtx, core.fallbackReason);
    } catch (coreErr) {
      const errMsg = (coreErr as Error)?.message ?? String(coreErr);
      coreCtx.core_error_message = errMsg;
      coreCtx.core_error_stack = (coreErr as Error)?.stack ?? null;
      coreCtx.core_fallback_reason = `core_threw:${errMsg}`;
      if (!coreCtx.core_last_stage) coreCtx.core_last_stage = "unknown_throw";

      await adminClient.from("qa_logs").upsert({ …, metadata: { ...coreCtx, pipeline_used: "core_failed", duration_ms: Date.now() - t0 } }, { onConflict: "id" });

      return buildCoreFailureResponse(coreCtx, coreCtx.core_fallback_reason as string);
    }
  }

  // ── Manual rollback: RESEARCH_PIPELINE=v4 or v3 ─────────────────────
  // Existing Stage A (V4) + Stage B (V3) blocks remain exactly as today,
  // minus the `pipelineMode === "core"` ORs (those become unreachable here).
  // …
}
```

`buildCoreFailureResponse(coreCtx, reason)` returns a `buildResponse(...)`-shaped payload with:
- `answer`: a clear Hebrew message — e.g. `"לא הצלחנו להפיק תשובה מאומתת. סיבה: <reason>. נסה לנסח מחדש או פנה לתמיכה."` (use existing "insufficient verified sources" phrasing when `reason` starts with `quality_insufficient_verified_sources` / `ledger_insufficient`).
- `footnotes: []`, `citations: []`
- HTTP 200 (so the client doesn't treat it as a network error), with `metadata.core_failed: true` echoed in the response body for the UI.

### 4. Required metadata on failure (already covered by `coreCtx`, just ensure all are written)

- `core_attempted: true`
- `core_last_stage` (from last `stage_runs` entry)
- `core_stage_runs`
- `core_fallback_reason` **or** `core_error_message`
- `core_acceptance_errors` (when present)
- `core_partial` (= `metadata.core` from runCore, when present)
- `pipeline_used: "core_failed"`

### 5. UI

No changes required. `MessageBubble` / `LegalQAChat` already render `answer + footnotes`, so the failure response shows as a normal assistant message containing the failure text. (Optional follow-up, not in this plan: add an inline error card when `metadata.core_failed` is true.)

## Out of scope

- No changes to Fast mode, academic mode, V4/V3/V2/V1 code.
- No new tables / migrations.
- No removal of V4/V3 files — kept for manual rollback.
- No new UI for the failure card.

## Validation after deploy

1. Confirm `RESEARCH_PIPELINE` env is **unset** (or `core`) so default routes to Core.
2. Run the 3 pilots in Deep mode via the app. Expect:
   - Each `qa_logs` row has `pipeline_used` ∈ {`core`, `core_failed`} — never `v4`/`v3`/`v4_fallback`.
   - No row has `answer = null` AND `pipeline_used = core`; failures use `core_failed` with the answer field carrying the Hebrew failure message.
   - On failure: `core_attempted=true`, `core_last_stage`, `core_stage_runs`, and either `core_fallback_reason` or `core_error_message` are present.
3. Run one non-pilot Deep question to confirm Core now runs for every Deep query (no pilot gate).
4. Manually set `RESEARCH_PIPELINE=v4`, redeploy, rerun one pilot, confirm legacy V4→V3 chain executes (rollback works).

## Touch list

- **Edit**: `supabase/functions/legal-qa/researchV4Pipeline.ts` (default mode → `"core"`).
- **Edit**: `supabase/functions/legal-qa/index.ts` (dispatch rewrite; add `buildCoreFailureResponse`).
- **Delete**: `supabase/functions/legal-qa/core/pilotGate.ts` and its imports.
