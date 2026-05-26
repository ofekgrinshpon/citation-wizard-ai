## Goal

Replace the current time-based single progress bar in the academic legal research panel with:
1. A vertical checklist of stages — each stage shows a live spinner while running and a check icon when actually complete (driven by real backend signals, not a timer).
2. A blurred "ghost" answer area beneath the checklist that animates as if text is being written, then resolves into the real answer when the job finishes.

## Current state (for context)

`src/components/LegalResearchV1Panel.tsx` currently:
- Shows one `<Progress>` bar driven by a `setInterval` timer (`STAGE_BUDGET_MS = 25s` per stage).
- Polls `legal_research_jobs` for `status` ∈ `running | done | error` only.
- Has no per-stage signal from the backend — stage labels advance purely by elapsed time.

`supabase/functions/legal-research-v1/index.ts` already tracks `stage_runs[]` internally and goes through a deterministic sequence: `attachments.extract → claim_analyzer → query_planner → retrieval(local+perplexity) → verifier → drafter → finalize`. It only writes `status` and final `result` to the DB.

## Plan

### 1. Backend: emit per-stage progress to the job row

- Migration: add two nullable columns to `public.legal_research_jobs`:
  - `current_stage text` — short key (e.g. `analyzer`, `planner`, `retrieval`, `verifier`, `drafter`, `finalize`).
  - `completed_stages text[]` default `'{}'` — stages already finished, in order.
- In `supabase/functions/legal-research-v1/index.ts`, add a small `markStage(stage)` helper that updates the job row at the start of each major stage and pushes the previous stage into `completed_stages`. Insert calls at the existing stage boundaries (analyzer start, planner start, retrieval start, verifier start, drafter start, finalize).
- No changes to retrieval/verifier/drafter logic, models, prompts, or scoring. Pure telemetry write.
- RLS: existing "Users can read own research jobs" policy already covers the new columns.

### 2. Frontend: stage checklist UI

In `LegalResearchV1Panel.tsx`:
- Replace the single `<Progress>` block with a vertical list (one row per stage) using the existing Hebrew `STAGES` labels mapped to backend stage keys:
  - `מנתח את השאלה` → `analyzer`
  - `מתכנן חיפושים משפטיים` → `planner`
  - `מחפש מקורות` → `retrieval`
  - `מאמת את המקורות` → `verifier`
  - `כותב תשובה` → `drafter`
  - `מסדר הערות שוליים` → `finalize`
- Each row renders one of three states based on poll data:
  - **done** → `Check` icon (success color), label in `text-foreground`.
  - **active** → `Loader2` spinner, label bold, subtle pulse.
  - **pending** → empty circle, label in `text-muted-foreground`.
- Driven by `current_stage` + `completed_stages` from the poll query (extend the `.select(...)` and the `pollJob` handler). The existing elapsed timer stays for the small `mm:ss` display and the soft-notice messages at 3 min / 5 min.
- Keep Cancel button and resume-on-mount behavior unchanged.

### 3. Frontend: blurred "being written" answer preview

- Below the checklist, while `loading` is true, render a `GhostAnswer` block:
  - 6–8 stacked `<div>` lines with varying widths (e.g. `w-11/12, w-10/12, w-9/12, w-11/12, w-8/12 …`) styled with `bg-muted` + `rounded` + Tailwind `blur-sm` + `animate-pulse`.
  - A second group of "footnote-like" shorter lines beneath, to mimic the eventual answer + footnotes layout.
  - Uses semantic tokens only (`bg-muted`, `text-muted-foreground`).
- When `status === "done"`, the ghost block unmounts and the existing real answer + footnotes block renders in its place with a `animate-fade-in` transition (utility already in tailwind config).
- No changes to the answer/footnotes/debug rendering itself.

### 4. Out of scope (explicit)

- No changes to the pipeline (analyzer/planner/retrieval/verifier/drafter), prompts, models, scoring, or admission rules.
- No changes to attachments upload, auth, project selection.
- No changes to debug panel.
- No new toasts.

## Technical details

**Migration sketch**
```sql
alter table public.legal_research_jobs
  add column if not exists current_stage text,
  add column if not exists completed_stages text[] not null default '{}';
```

**Edge function helper sketch**
```ts
async function markStage(stage: string) {
  await admin.from("legal_research_jobs")
    .update({ current_stage: stage })
    .eq("id", jobId);
}
// and on stage completion:
await admin.from("legal_research_jobs")
  .update({ completed_stages: [...done, stage] })
  .eq("id", jobId);
```
(Implementation will use the existing admin client / `setJobStatus`-style helper already in `index.ts` to avoid a new client.)

**Poll query change**
```ts
.select("status, result, error, current_stage, completed_stages")
```

**Stage row component (semantic tokens only)**
- `done`: `<Check className="w-4 h-4 text-primary" />`
- `active`: `<Loader2 className="w-4 h-4 animate-spin text-primary" />`
- `pending`: `<div className="w-4 h-4 rounded-full border border-border" />`

**Ghost answer block**
```tsx
<div className="space-y-2 rounded-lg border border-border bg-card p-4 animate-fade-in">
  {widths.map((w, i) => (
    <div key={i} className={`h-3 ${w} rounded bg-muted blur-[2px] animate-pulse`} />
  ))}
</div>
```

## Acceptance

- Each stage row transitions spinner → check exactly when the backend advances, not on a timer.
- If the backend stalls on a stage, that stage keeps its spinner (no false "completed" state).
- Ghost answer is visible the whole time the job is running and is replaced by the real answer on `done`.
- No regression in cancel, resume-on-mount, error display, attachments upload, or debug panel.
- No backend pipeline behavior changes; only two new DB columns and progress writes.
