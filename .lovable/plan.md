## Problem

The progress bar in `StageProgressList` jumps to ~96% almost immediately and doesn't reflect real backend progress. Two root causes:

1. **Stage-name mismatch.** Today the live pipeline (`supabase/functions/legal-qa/core/runCore.ts`) emits stages named `plan`, `retrieval`, `verify`, `ledger`, `draft`, `enrich_citations`, `post_processing`. But `EXPECTED_STAGES` in `StageProgressList.tsx` lists the *old* names (`frame`, `decompose`, `retrieve`, `rerank`, `source_pack`, `claim_map`, `drafter`, `anchor_pass`, `coverage_gap`, `statute_completion`, `footnote_validate`). No actual stage matches the expected list, and there are no Hebrew labels for the new names either — so the user sees raw English stage IDs.
2. **Hard 95% floor.** `if (postProcessingLabel) percent = Math.max(percent, 95)`. The dedicated `post_processing` SSE event (emitted by `emitPostProcessing("מאמת הערות שוליים")` in `index.ts:10355`, plus the `onStage("post_processing", …)` from runCore) fires early in the tail of the pipeline and slams the bar to 95–96%, regardless of how much real work remains.

## Plan

All changes are frontend-only (UI presentation). No backend pipeline changes.

### 1. `src/components/StageProgressList.tsx` — rebuild progress logic

- **New stage manifest.** Replace `EXPECTED_STAGES` with a per-mode ordered list that matches what the backend actually emits today, each entry carrying:
  - `id` (matches backend `stage` event name)
  - `label` (Hebrew, user-facing)
  - `weight` (rough share of total wall-time, summing to 1.0)
  - `subtitle` (one short sentence shown next to the spinner explaining what's happening)

  Example for `research_deep` (using runCore order):
  ```
  plan             0.08  "מבין את השאלה ובונה תכנית מחקר"
  retrieval        0.22  "מאחזר פסיקה, חקיקה ומקורות אקדמיים"
  verify           0.10  "מסנן ומדרג את המקורות לפי רלוונטיות"
  ledger           0.05  "בונה מיפוי טענות-מקורות"
  draft            0.30  "כותב את התשובה ומשלב הערות שוליים"
  enrich_citations 0.15  "מאמת ומשלים פרטי ציטוטים"
  post_processing  0.10  "בדיקת איכות סופית ועיגון מקורות"
  ```
  Fast / academic_chapter get their own manifests (academic keeps existing override labels; fast collapses to a shorter list).

- **Weighted percent.** Compute `percent = Σ(weight) over completed stages + 0.5·weight of running stage`, clamped to 1–99 until the `final` event arrives (then 100). Drop the `postProcessingLabel → max(_, 95)` floor entirely; the post-processing row contributes its real weight like any other stage.

- **Smooth animation.** Maintain a `displayedPercent` in state that eases toward the target via `requestAnimationFrame` (≤2% per frame, slower when within 5% of target). This avoids visual jumps when several events arrive back-to-back, and gives a "still working" feel between events.

- **Idle creep.** When the current running stage hasn't progressed in >3s, allow `displayedPercent` to creep up to *but not past* the midpoint of that stage's allotted band (so the user always sees motion without lying about completion). Reset on the next event.

- **Unknown stages.** If the backend emits a stage we don't know about, append it after the known ones with a default weight that scales the manifest down proportionally — never let unknown stages break the math or labels.

### 2. Spinner + current-state caption

- Above the stage list, render a compact "current state" header:
  - Large spinner (`Loader2`) + the **running stage's `label`** as the headline.
  - One-line **subtitle** from the manifest (`subtitle`) so the user understands what the % means right now.
  - When between stages (e.g., just after a `complete` and before the next `running`), keep the last running stage's text and append "…מסיים" so the spinner never looks frozen.
  - On `isComplete`, replace with a `CheckCircle2` and "הושלם".

- Per-row spinners (existing `<Loader2>` on running rows) stay, but the row label gets a tiny **percent-band hint** on the right (e.g., `8–30%`) so users can map the bar position to a pipeline stage at a glance.

### 3. Wire-up touch in `LegalQAChat.tsx`

- No prop changes needed; `StageProgressList` already receives `stages`, `postProcessingLabel`, `draftText`, `mode`, `isComplete`.
- Keep `postProcessingLabel` forwarded (it still shows as the footnote-validation row), but it no longer drives a special % floor — it's just another labeled row.

### 4. Verification

- Run a Deep query in the preview and confirm:
  - Bar starts near 4–8% on `plan running`, climbs to ~30% after `retrieval complete`, ~75% after `draft complete`, 95–99% during `post_processing`, 100% on `final`.
  - Headline + subtitle change as each `stage running` arrives.
  - No jump straight to 96%.
- Run a Fast query and academic chapter write to confirm their manifests behave the same way.
- Test an artificial slow stage by throttling the network — confirm the idle creep behavior and that the bar never regresses.

## Files touched

- `src/components/StageProgressList.tsx` (main rewrite)
- (No backend changes; no other component changes required.)
