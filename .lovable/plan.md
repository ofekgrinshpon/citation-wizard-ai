## Goal
Add a live percentage progress bar to the legal-qa loading UI (StageProgressList), reflecting the actual streamed pipeline state. Frontend-only change — no backend, no new events.

## Why this works
The backend already emits SSE `stage` events with `running`/`complete` for every step of the pipeline (frame → decompose → retrieve → rerank → source_pack → claim_map → drafter → anchor_pass → coverage_gap → statute_completion → footnote_validate), plus an optional `post_processing` row and a terminal `final` event. The frontend already consumes these into `stageEvents`, `postProcessingLabel`, `streamingDraft`. We just need to render a percentage from them.

## Approach

1. **Define expected stage sequences per mode** in `StageProgressList.tsx`:
   - `research_fast`: `["frame","decompose","retrieve","rerank","source_pack","drafter","anchor_pass","footnote_validate"]`
   - `research_deep`: full set including `claim_map`, `coverage_gap`, `statute_completion`
   - `academic_chapter`: same as deep
   These mirror the actual `emitStage` calls in `supabase/functions/legal-qa/index.ts`.

2. **Compute percentage** inside `StageProgressList`:
   - `completed` = count of dedup'd stages with `status === "complete"`
   - `running` = a stage currently `running` contributes +0.5
   - `denominator` = `max(expectedStages.length, seenStagesCount)` (so unexpected extra stages do not push us past 100%)
   - `percent = clamp(round((completed + 0.5 * runningFraction) / denominator * 100), 1, 99)`
   - When `postProcessingLabel` is active → cap at 95%
   - Accept a new optional prop `isComplete?: boolean` — when true, force 100% (used by the parent on the `final` event).

3. **Render** a `<Progress />` (existing `src/components/ui/progress.tsx`, Radix-based) directly under the header, with the numeric percent label next to it (RTL, e.g. `42%`). Smooth transition is already built into the component.

4. **Parent wiring** in `LegalQAChat.tsx`:
   - Pass `isComplete` derived from whatever already signals run completion (e.g. when result is set or the SSE handler resolves). Minimal: just pass `false` while loading region is visible; the component unmounts on completion so reaching 100% momentarily is enough — alternatively add a tiny `runComplete` boolean flipped in the `final` handler before unmount.

5. **No behavior changes** to:
   - SSE consumption
   - backend
   - existing checklist rows, post-processing row, draft preview, caret

## Files to change
- `src/components/StageProgressList.tsx` — add stage-sequence map, percent calc, render `<Progress>` + label, accept `isComplete` prop.
- `src/components/LegalQAChat.tsx` — pass `isComplete` prop (optional; can be omitted if we accept the 99→unmount behavior).

## Out of scope
- Backend changes / new SSE event types
- Per-stage weighting beyond uniform + half-credit for the currently running stage
- Touching `ResearchProgress` (fallback before any SSE event arrives)
