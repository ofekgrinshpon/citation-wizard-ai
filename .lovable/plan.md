## Why the bar stays on "מתחבר למנוע המחקר"

After yesterday's fix, Deep polling does translate `qa_logs.metadata.checkpoint` into stage events — but only **two checkpoints are actually written by the backend**:

| Code location | Checkpoint phase emitted |
|---|---|
| dispatcher (`index.ts:11049`) | `queued` (at submit) |
| `writeCheckpoint("decomposition")` (`index.ts:4712`) | after decomposition completes |
| `writeCheckpoint("claim_map")` (`index.ts:5448`) | after claim_map completes |

The other checkpoint names referenced in `legalQaPolling.ts` / `deepCheckpointToStages.ts` (`legal_issue_router`, `open_web_discovery`, `retrieval`, `claim_verification`, `drafting`, `anchor_pass`) are SSE-only `emitStage()` calls and are **never persisted to `qa_logs.metadata`**, so the polled snapshot never sees them.

Result for a typical Deep run:

```text
0 → ~25–35s : checkpoint="queued"      → deepCheckpointToStages → []  → starter row, 1–2 %
~25–60s      : checkpoint="decomposition" → plan running           → ~4 %
~60–110s     : checkpoint="claim_map"     → ledger running          → ~32 %
final        : answer arrives             → 100 %
```

The first ~30 s — the loudest user-visible symptom — is entirely the starter phase, because `queued` maps to `[]`.

## Fix

Two coordinated, minimal changes. Keep async dispatch and the existing SSE path untouched.

### 1. Frontend: never sit on starter once polling is alive

`src/lib/legalQa/deepCheckpointToStages.ts`

- Map `queued` and `running` to `plan running` (instead of `[]`). The moment the first poll returns (≤ 2 s after submit), the UI leaves "מתחיל / מתחבר למנוע המחקר" and shows "תכנון מחקר…" with the plan band's idle creep — matching what's actually happening server-side.
- Keep `legal_issue_router`, `decomposition`, `open_web_discovery`, `retrieval`, `claim_verification`, `drafting`, `anchor_pass`, `completed` mappings as-is (they'll start working once step 2 lands).

### 2. Backend: persist three more checkpoints so polling has real data points

`supabase/functions/legal-qa/index.ts`, mirror the existing `writeCheckpoint(...)` pattern (fire-and-forget upsert into `qa_logs.metadata.checkpoint`). Extend the phase union to:

```ts
"decomposition" | "retrieval" | "claim_map" | "drafting_started" | "anchor_pass"
```

Add calls at:

- `retrieval` — right after the round-1 local source pack is assembled and before claim_map starts (between current `writeCheckpoint("decomposition")` and `writeCheckpoint("claim_map")`).
- `drafting_started` — at the moment the drafter call is dispatched (search for the drafter invocation that follows `writeCheckpoint("claim_map")`).
- `anchor_pass` — right before the anchor/citation-enrichment pass runs at the tail of the pipeline.

No new metadata keys, no changes to the row schema, no change to retrieval/verifier/drafter logic, no change to SSE for Fast/academic.

### 3. Smoke-check after deploy

- Submit one Deep question. Watch the bar transition through `plan → retrieval → ledger → draft → enrich_citations → post_processing → 100%` instead of jumping plan → ledger → done.
- Confirm Fast and academic SSE progress is unchanged (no code path they share is touched besides the helper, which keeps existing mappings).

## Out of scope

- Q5 timeout investigation (still separate).
- True per-stage telemetry/SSE for Deep — explicitly avoided because Deep must stay async (150 s gateway cap).
- Reducing wall-clock time of the pipeline.
