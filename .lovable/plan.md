## Problem

Clicking a history item in חיפוש מקורות hydrates the panel correctly, but switching to a different project still shows the same result. The Phase 1 per-project reset/hydration works in isolation, but it is being overridden every render by a stale `externalResult`.

## Root cause (three reinforcing bugs)

1. **Parent never clears `qaExternalResult`.** `src/pages/Index.tsx` sets `qaExternalResult` when a history item is clicked (lines 1225/1227) but never resets it. When the user clicks another project, the value is still in state.

2. **`onConsumeExternalResult` is not wired.** `LegalSourceSearchPanel` calls `onConsumeExternalResult?.()` after hydrating, but `LegalQAChat` (line 2946) does not pass that prop, so the call is a no-op. Index's `qaExternalResult` therefore stays truthy indefinitely.

3. **New object identity on every render re-triggers the hydration effect.** `LegalQAChat` builds a fresh literal `{ question, payload: externalResult.sourcesPayload }` inline (lines 2947–2951). The child's effect has deps `[externalResult]`, so it fires on every parent render and re-applies the stale historical turn — which is exactly what clobbers the project-switch reset.

Net effect: project-switch effect in the panel clears turns → parent re-renders with a new-identity `externalResult` literal → child effect re-hydrates the old historical turn → user sees the previous project's history item under the new project.

## Fix (frontend only, scope: 3 files)

### `src/pages/Index.tsx`
- Add a `useEffect` keyed on `currentProject?.id` that calls `setQaExternalResult(null)` whenever the active project changes. Use a ref to skip the very first run so the initial project id resolution does not wipe a value set by the same click.
- Pass a new `onConsumeExternalResult={() => setQaExternalResult(null)}` callback down to `LegalQAChat`.

### `src/components/LegalQAChat.tsx`
- Accept `onConsumeExternalResult?: () => void` in `LegalQAChatProps` and thread it through.
- Replace the inline object literal with a `useMemo` so the prop passed to `LegalSourceSearchPanel` keeps stable identity until `externalResult` itself changes:
  ```ts
  const sourceSearchExternal = useMemo(
    () => externalResult && externalResult.taskMode === "legal_source_search"
      ? { question: externalResult.question, payload: externalResult.sourcesPayload }
      : null,
    [externalResult],
  );
  ```
- Pass `onConsumeExternalResult` through to `LegalSourceSearchPanel`.

### `src/components/LegalSourceSearchPanel.tsx`
- Add an `appliedExternalRef = useRef<unknown>(null)` and, inside the existing `externalResult` effect, early-return when `externalResult === appliedExternalRef.current`. Set the ref to the current `externalResult` right before calling `setTurns(...)` and `onConsumeExternalResult?.()`. This makes the effect idempotent against accidental identity churn from any future parent change.
- Order guarantee: the project-id effect (which resets turns) and the external-result effect can both fire in the same render; the ref guard plus the parent's clear-on-project-change ensure the historical turn does not get re-applied to the new project.

## What stays unchanged

- Backend, payload shape, search/polling logic, turn storage key scheme, UI rendering structure, history sidebar behavior, autocomplete.
- No Phase 2 follow-up-context work.
- No changes to `LegalResearchV1Panel` or non-source-search task modes (the parent's clear-on-project-change applies to all task modes, which is the correct behavior — a project switch already invalidates a stale historical pin regardless of mode).

## Validation

Manual:
1. Click a חיפוש מקורות history item in project A → result shows.
2. Switch to project B from sidebar → panel resets to empty (or to project B's persisted turns), no leftover historical turn.
3. Switch back to project A → project A's persisted turns hydrate normally.
4. Click a history item, then click the same item again → still hydrates (identity changes because parent re-sets state).
5. Run a fresh search in project B after the switch → works, persists under project B's key only.

## Risks

- Clearing `qaExternalResult` on project switch also affects non-source-search task modes (research, case summary, academic). This matches the desired Phase 1 contract ("project switch resets transient hydration"), but worth confirming. If a mode needs to survive a project switch, we'd add a per-mode opt-out later.
- The "skip first run" ref in Index must be set before any effect that could clear `qaExternalResult`; otherwise a history click that also changes `currentProject` could wipe its own payload. The skip-first-render ref handles this.