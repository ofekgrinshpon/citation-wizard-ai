# Wire Research Core into legal-qa (Deep only, 3 pilots, gated)

## Goal

Run the full Core pipeline (Planner → Retrieval → Verifier → Ledger → Drafter → Citations → Footnotes → QualityPass) inside `supabase/functions/legal-qa/index.ts` for **Deep research** on the 3 pilot topics, gated by `RESEARCH_PIPELINE=core`. V4/V3/V2 stay intact as the rollback path. Fast and academic are untouched. No UI changes. No shared-core extraction.

## What exists

- Core modules already shipped (D1–D6) under `supabase/functions/legal-qa/core/`:
  `retrieval.retrieveForPlan`, `verifier.verify`, `ledger.buildLedger`, `drafter.draft`, `citations.buildCitationsForLedger`, `footnotes.buildFootnotes`, `citation_quality.runCitationQuality`. Planner = the existing V3 `LegalResearchPlan` (same anchor V4 uses); we don't add a second planner.
- Deep dispatch lives at `index.ts` lines 2477–2633 with `RESEARCH_PIPELINE` resolved by `researchPipelineMode()` (today returns only "v4" | "v3"). `qa_logs` upsert + SSE `emitStage` are already there.

## Changes

### 1. New runner: `supabase/functions/legal-qa/core/runCore.ts`

Thin orchestrator, no logic of its own. Mirrors V4's signature so dispatch is symmetric.

```ts
export interface RunCoreArgs {
  question: string;
  adminClient: SupabaseClient;
  drafterTimeoutMs: number;
  forceDrafterModel?: string;
  onStage: (name: string, status: "active" | "complete" | "error", meta?: any) => void;
}
export interface RunCoreResult {
  ok: boolean;
  answer: string;
  footnotes: Footnote[];
  citations: string[];          // marker→footnote map flattened (for buildResponse)
  metadata: Record<string, unknown>;
  fallbackReason?: string;
}
export async function runCore(args: RunCoreArgs): Promise<RunCoreResult>;
```

Steps inside:
1. `planner` — reuse V3 `legalResearchPlanner` (same call V4 makes); convert its output to `PlanV1`. Emit stage `plan`.
2. `retrieval` — `retrieveForPlan({ plan, adminClient })`. Emit `retrieval`.
3. `verifier` — `verify({ plan, candidates })`. Emit `verify`.
4. `ledger` — `buildLedger({ plan, verifierResult })`. Emit `ledger`. If `enough_for_drafting=false` for the answer → `ok:false, fallbackReason:"ledger_insufficient"`.
5. `drafter` — `draft({ plan, ledger, drafterTimeoutMs, forceDrafterModel })`. Emit `draft`. No citation text generated.
6. `buildCitationsForLedger(ledger.sources)`.
7. `runCitationQuality({ answer: draft.answer, ledger, citations })`. Emit `post_processing`.
8. If quality `status="insufficient_verified_sources"` or `"needs_review"` → `ok:false, fallbackReason:"quality_<status>"`.
9. Return `{ ok:true, answer: q.rendered_answer, footnotes: q.footnotes, citations: q.marker_to_footnote.map(m => m.footnote_text), metadata: { core: { plan_id, ledger_summary, citation_summary, removed_citations, flagged_footnotes, stage_durations_ms } } }`.

Acceptance asserts (cheap, in-runner; fail → ok:false):
- `!/\[cite:LS\d+\]/.test(answer)` — no leftover markers.
- Every superscript in `answer` resolves to one footnote in `footnotes`.
- No footnote text equals `(ציטוט חסר)` unless its source has `citation_quality="partial"` AND `placeholder_accepted=true`.

### 2. Pipeline gate: `researchV4Pipeline.researchPipelineMode`

Extend the union to `"core" | "v4" | "v3"`:

```ts
export function researchPipelineMode(): "core" | "v4" | "v3" {
  const raw = (Deno.env.get("RESEARCH_PIPELINE") ?? "").trim().toLowerCase();
  if (raw === "core") return "core";
  if (raw === "v3") return "v3";
  return "v4";
}
```

No other change to V4.

### 3. Pilot-topic guard: `supabase/functions/legal-qa/core/pilotGate.ts`

Returns true only for the three approved topics. Used because `RESEARCH_PIPELINE=core` alone would route every Deep query through Core; we want the env flag flipped on but only the pilots actually entering Core.

```ts
const PILOT_PATTERNS: RegExp[] = [
  /צו\s*מניעה\s*זמני/,
  /אי[\s\-]?הפעלת\s*סמכות\s*מנהלית/,
  /(אפרופים|סעיף\s*25\b)/,
];
export function isCorePilot(question: string): boolean {
  return PILOT_PATTERNS.some(re => re.test(question));
}
```

### 4. Dispatch in `index.ts` (around line 2484)

Insert a **Stage 0** block in front of the existing V4/V3 chain. Pure addition; no edits to Stage A/B/V1.

```ts
const pipelineMode = researchPipelineMode();
const deepDispatchEligible = /* unchanged */;

// ── Stage 0: Research Core (gated) ──
if (deepDispatchEligible && pipelineMode === "core" && isCorePilot(question)) {
  emitStage("frame", "complete");
  const deepQaLogId = (typeof body?._asyncRunId === "string" ? body._asyncRunId : null) ?? crypto.randomUUID();
  try {
    console.log(`[research_core] dispatch — pilot question`);
    const core = await runCore({
      question, adminClient,
      drafterTimeoutMs: modeProfile.drafterTimeoutMs,
      forceDrafterModel,
      onStage: emitStage,
    });
    if (core.ok) {
      await persistSuccess("core", core);  // extend persistSuccess union: "core"|"v4"|"v3"|"v2"
      return buildResponse(core.answer, core.footnotes, core.citations, {
        footnotes_count: core.footnotes.length,
      });
    }
    console.warn(`[research_core] fallback reason=${core.fallbackReason} — trying V4`);
    // fall through: existing V4→V3→V1 chain handles it.
  } catch (coreErr) {
    console.error("[research_core] threw — falling through to V4:", coreErr);
  }
}

// ── Existing Stage A (V4) and Stage B (V3) unchanged ──
```

Tiny edit to `persistSuccess`: widen the `which` parameter type to include `"core"`. Metadata already records `pipeline_used: which`, so `qa_logs.metadata.pipeline_used === "core"` and `qa_logs.metadata.core` (set inside `runCore`) will both be present.

### 5. Env

Set `RESEARCH_PIPELINE=core` in Supabase Edge Function env. Non-pilot Deep queries still hit V4 because of `isCorePilot` gate. To roll back instantly: set `RESEARCH_PIPELINE=v4`.

## Out of scope (explicit)

- No citation review UI.
- No refactor of `BatchFootnoteBuilder` / `FootnoteReviewCard`.
- No shared citation core extraction.
- No changes to Fast, academic, V4, V3, V2, V1.
- No new DB tables, no migrations.

## Validation plan (after deploy)

Use `supabase--curl_edge_functions POST /legal-qa` for each of the 3 pilots with `{ question, taskMode: "research", depth: "deep" }`. For each, then `supabase--read_query` against `qa_logs` by id and report:

- `pipeline_used` (must be `"core"`)
- `answer` (text)
- `footnotes` (final numbered list)
- `metadata.core.citation_summary.status`
- Repeated-citation behavior — list footnotes where `is_repeated=true` and their `repeated_citation_text`
- Regex assertions: no `[cite:LS` in answer; no `(ציטוט חסר)` unless source marked partial/needs_review
- Claim-leakage check: every paragraph maps to a kept (supported/hedged) ledger claim
- `duration_ms` from metadata
- `metadata.core` present

If any pilot returns `ok:false`, report `fallbackReason` and which downstream pipeline (V4/V3/V1) served the final answer.

## Code touch list

- **New**: `supabase/functions/legal-qa/core/runCore.ts`, `supabase/functions/legal-qa/core/pilotGate.ts`.
- **Edited**: `supabase/functions/legal-qa/researchV4Pipeline.ts` (extend `researchPipelineMode` union), `supabase/functions/legal-qa/index.ts` (Stage 0 block + `persistSuccess` union widening).
- **Env**: set `RESEARCH_PIPELINE=core`.
