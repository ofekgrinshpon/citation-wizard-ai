## Why the bar doesn't appear

`LegalQAChat.tsx` (line 2685–2696) only mounts `StageProgressList` once `stageEvents.length > 0 || streamingDraft.length > 0 || postProcessingLabel`. Until the first SSE `stage` event arrives, the fallback `ResearchProgress` is shown — and that component has no percentage bar. Result: from the user's perspective, "no live progress bar appears" during the initial seconds, and on short/non-streaming runs it never appears at all.

## Fix (frontend-only)

1. **`LegalQAChat.tsx`** — when the run is a streaming mode (`taskMode === "research"` or `academicStep ∈ {write_chapter, write_introduction, write_conclusion}`), render `StageProgressList` from the moment loading starts, not only after the first event. Drop the `hasStreamSignal` gate for those modes; keep `ResearchProgress` only as fallback for the non-streaming modes (case summary, pleading analysis, short academic sub-steps).

2. **`StageProgressList.tsx`** — when `stages` is empty, render the header + `<Progress value={1} />` + a single "מתחיל…" running row so the bar is visible at ~1% immediately. Existing percent math already handles this once events arrive.

3. **Final 100% flash** — pass `isComplete` from `LegalQAChat`: set a local `runComplete` boolean to `true` in the SSE `final` handler (and in the JSON path right before `setResult`) so the bar visibly hits 100% before the loading region unmounts. Reset alongside `stageEvents` in both submits and `handleStop`.

4. **Sanity check on the Progress component** — `src/components/ui/progress.tsx` uses `bg-secondary` track + `bg-primary` fill. Confirm in the running preview that the fill is visible against the card background in the current theme; if contrast is too low, swap the track to `bg-muted` (no token additions, still semantic).

## Out of scope
- Backend / SSE event changes
- New stage weighting
- Touching academic wizard logic, draft preview, caret, or post-processing row
