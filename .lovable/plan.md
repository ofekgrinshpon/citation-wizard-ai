## Goal

Add a new task mode **חיפוש מקורות** (subtitle: *חיפוש מקורות אקדמיים למחקר משפטי*) that runs the existing `legal-research-v1` pipeline through the verifier and returns grouped, ranked sources — **no drafter, no footnotes, no Hebrew prose answer**.

## Backend

### Option chosen: same edge function + `mode` flag

Keep all reuse of analyzer/planner/retrieval/candidate-pool/verifier inside `supabase/functions/legal-research-v1/index.ts`. Branch only at two points:

1. **Skip drafter** when `mode === "sources_only"`.
2. **Build a `sources_only` payload** from `verifier.usable` + `pool.candidates` + retrieval meta, and write it to `legal_research_jobs.result`.

#### Request shape
```ts
POST /functions/v1/legal-research-v1
{
  question: string,
  project_id?: string,
  mode?: "answer" | "sources_only",   // default "answer" — fully backward compatible
  // attachments / use_as_source remain accepted but ignored for sources_only v1
}
```

Validate `mode` with the existing input checks. Reject unknown values with 400.

#### Pipeline branching

In `runPipeline()`:
- Stages `attachments → analyzer → planner → retrieval → verifier` run unchanged.
- After `markStage("verifier")` completes:
  - If `mode === "sources_only"`:
    - Skip `runDrafter` entirely.
    - Replace the `markStage("drafter")` / `markStage("finalize")` calls with `markStage("ranking")` then `completeAllStages()`.
    - Build `sources_only_payload` (see below).
    - Write telemetry with `task_mode: "legal_source_search"` and `metadata.pipeline_mode = "sources_only"`; set `telemetryBase.answer` to empty string and `footnotes` to `[]`.
    - Return 200 with the sources payload.
  - Otherwise: behavior is exactly today's `legal-research-v1`.

The background-wrap/`legal_research_jobs` polling model is unchanged.

#### `sources_only_payload` builder (new helper inside `index.ts` or `lib/sourcesOnly.ts`)

For each `usable` entry, look up the matching `pool.candidates[i]` (by `candidate_id`) and produce:

```ts
type SourceResult = {
  rank: number;                 // assigned after grouping/sort
  title: string;
  url: string | null;
  source_type: string;          // candidate.source_type
  role: SourceRole;             // candidate.role
  origin: "local_db" | "perplexity";   // mapped from candidate.origin
  support: "direct" | "partial";       // verifier best_support
  role_match: boolean;
  reason: string;               // verifier verdict reason for the top supported claim
  supported_claim_ids: string[];// verdict_claim_ids
  snippet: string | null;
  display_citation: string | null;
};
```

**Do not** include internal `candidate_id` in the user-facing array. Keep IDs only inside `debug`.

#### Grouping + ranking

Group `SourceResult[]` into:

```
primary_statute, binding_case_law, persuasive_case_law,
scholarship, legislative_history, government_report, other
```

Map verifier `role` → group:
- `primary_statute`, `regulation` → `primary_statute`
- `binding_case_law` → `binding_case_law`
- `persuasive_case_law` → `persuasive_case_law`
- `scholarship` (and `secondary_literature` if present) → `scholarship`
- `legislative_history` (knesset/explanatory memorandum) → `legislative_history`
- `government_report` → `government_report`
- everything else → `other`

Within each group sort by: `support` (direct → partial) → `role_match` (true → false) → `origin` (`local_db` → `perplexity`) → preserve verifier order (stable). Assign global `rank` across the flattened, grouped list.

**Do not drop sources for weak URLs.** Keep `url: null` when absent; the UI shows the card without an external link.

#### Response shape (`200`)

```jsonc
{
  "mode": "sources_only",
  "question": "...",
  "run_id": "...",
  "sources": [/* flattened grouped + ranked */],
  "groups": { "primary_statute": [...], ... },
  "summary": {
    "total_candidates": number,    // pool.candidates.length
    "verified": number,            // verifier.candidates_verified
    "usable": number,              // verifier.candidates_usable
    "dropped": number,             // verifier.candidates_dropped
    "local_count": number,         // among usable
    "perplexity_count": number     // among usable
  },
  "debug": {/* run_id, stage_runs, planning, retrieval, verifier, dropped_sources */}
}
```

### Database / RLS / config

- No new tables. `legal_research_jobs.result` already accepts arbitrary `jsonb`.
- `qa_logs.task_mode` is `text`; store `"legal_source_search"` for these runs.
- No `config.toml` change. No migrations.

### Validation

Add `scripts/legal-research-v1-sources-only-validate.ts` that runs L1–L6 (and S1–S5) with `mode: "sources_only"` and checks:
- job completes without drafter stage (`stage_runs` has no `drafter.*`),
- response has `mode === "sources_only"`,
- every source in `sources` corresponds to a `usable` candidate,
- `summary.usable === sources.length`,
- `dropped` ≥ 0 and verifier counts match,
- median total time noticeably lower than the drafter-included baseline.

## Frontend

### Task mode

`src/components/LegalQAChat.tsx`:
- Add `"legal_source_search"` to the `TaskMode` union.
- Add to `TASK_MODES` (replacing the previous slot order where `pleading_analysis` used to live):
  ```ts
  { id: "legal_source_search",
    label: "חיפוש מקורות",
    description: "חיפוש מקורות אקדמיים למחקר משפטי",
    placeholder: "הזן שאלה משפטית או נושא למחקר…",
    icon: BookMarked }   // or Library / FileSearch — pick from lucide-react
  ```
- Add to `FILE_RELEVANT_MODES`? **No** for v1 (attachments out of scope per spec).
- In the empty-state render block: when `taskMode === "legal_source_search"` render `<LegalSourceSearchPanel />` (new), mirroring the existing `taskMode === "research"` branch that renders `<LegalResearchV1Panel />`.
- Submit/disable logic: route through the new panel's internal state, like Research v1 does. The chat's top-level `handleSubmit` should bail when `taskMode === "legal_source_search"` (panel owns its own submit).

`src/pages/Index.tsx`: widen the two inline `TaskMode` unions to include `"legal_source_search"`.

`src/components/QAHistorySidebar.tsx`: add a `MODE_LABELS` entry `legal_source_search: { label: "חיפוש מקורות", icon: BookMarked }`. When a history row of this mode is clicked, the parent should route it to the new panel (see History section).

`src/pages/Profile.tsx`: add `legal_source_search: "עוזר משפטי – חיפוש מקורות"` to the ledger label map.

### New panel: `src/components/LegalSourceSearchPanel.tsx`

Closely mirrors `LegalResearchV1Panel.tsx` (queue + poll model, same `legal_research_jobs` row, same stage UI), but:

**Stage list:**
```
analyzer  → מנתח את השאלה
planner   → מתכנן חיפושים
retrieval → מחפש מקורות
verifier  → מאמת רלוונטיות
ranking   → מסדר מקורות
```
(No `drafter` / `finalize`.)

**Submit:**
- Invokes `legal-research-v1` with `body: { question, project_id, mode: "sources_only" }`.
- Reuses the same 202 → poll → `legal_research_jobs.result` flow.

**Loading UI:**
- Same stage checklist + elapsed timer + cancel as Research v1.
- No "ghost answer" card. Instead show a small **source-list skeleton** (3–5 placeholder source cards with shimmer).

**Result UI** (`SourceResultsView` sub-component):
- Top summary line: `נמצאו {usable} מקורות רלוונטיים` · `מתוכם {direct} ישירים` · `{local} מהמאגר המקומי, {perplexity} חיצוניים`.
- For each non-empty group render a section header (Hebrew labels: *חקיקה ראשית ותקנות*, *פסיקה מחייבת*, *פסיקה משכנעת*, *ספרות אקדמית*, *הליכי חקיקה*, *דוחות ממשלתיים*, *אחר*) followed by source cards.
- **Source card:**
  - Title (Hebrew, RTL).
  - Chips: role (Hebrew label), origin (`מאגר מקומי` / `Perplexity`), support (`ישיר` / `חלקי`).
  - Reason (verifier explanation, 1–2 lines, muted text).
  - Snippet (if present, collapsed by default, "הצג עוד" expander).
  - External link button (`פתח מקור`) only when `url` is non-null.
  - Rank number (subtle).
- Use semantic Tailwind tokens (`bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, accent chips with `bg-primary/10 text-primary`, etc.) — no hardcoded colors.

**Debug panel:**
- Same collapsible `<Collapsible>` as Research v1, gated to admin / dev mode using existing checks. Renders `debug.verifier`, `debug.retrieval`, `debug.planning`, `debug.dropped_sources`.

### History

- The new panel writes to `legal_research_jobs` (status flow already shared with Research v1) and the existing `qa_logs` row via the edge function's `writeTelemetry`. Task mode stored: `"legal_source_search"`.
- `QAHistorySidebar.onLoadResult` already passes `(question, result, taskMode)` upward. In `Index.tsx`, when `taskMode === "legal_source_search"` route the result into a new external-result slot consumed by `LegalSourceSearchPanel` (mirroring how `qaExternalResult` is consumed today, but with a typed `SourceResultsResponse`). Simplest path: extend the existing `qaExternalResult` state to include the new task mode, and have the panel accept an optional `externalResult` prop.

### Files added / modified

**Backend:**
- `supabase/functions/legal-research-v1/index.ts` — input parsing, drafter bypass, payload builder integration.
- `supabase/functions/legal-research-v1/lib/sourcesOnly.ts` *(new)* — `buildSourcesOnlyPayload(verifier, pool, retrievalMeta)` + role-group mapping + ranking.
- `scripts/legal-research-v1-sources-only-validate.ts` *(new)* — validation harness.

**Frontend:**
- `src/components/LegalSourceSearchPanel.tsx` *(new)*.
- `src/components/legal-source-search/SourceCard.tsx` *(new)*.
- `src/components/legal-source-search/SourceResultsView.tsx` *(new)*.
- `src/components/LegalQAChat.tsx` — add task mode, render branch.
- `src/components/QAHistorySidebar.tsx` — label entry.
- `src/pages/Index.tsx` — widen TaskMode union, route external result.
- `src/pages/Profile.tsx` — ledger label entry.

## Out of scope (v1, per spec)

No drafter answer · no footnotes / Rule 37 · no bibliography / Bluebook formatting · no Word/PDF export · no manual source editing · no attachments handling in this mode · no retrieval / verifier strictness changes · no model changes.

## Acceptance

- Submitting in **חיפוש מקורות** mode runs the pipeline, skips the drafter stage entirely, and renders grouped source cards with summary counts.
- Every rendered source ⊆ `verifier.usable`; dropped sources never appear in the main UI (only in admin debug).
- `summary.local_count + summary.perplexity_count === sources.length` (modulo unknown origins → counted as their actual bucket).
- `legal_research_jobs.result` contains the new `sources_only` payload; clicking the matching history row re-renders the source list.
- Existing `mode === "answer"` (default) behavior is byte-identical to current Research v1.
- Average wall-time noticeably lower than full Research v1 on L1–L6.
