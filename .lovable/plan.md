
## Phase 1 — Chat-like turns in `LegalSourceSearchPanel` (frontend only)

No backend, prompt, scoring, or `citation-chat` changes. No `prior_turn` payload.

## Existing state that gets replaced or wrapped

In `src/components/LegalSourceSearchPanel.tsx` today:

- `result: SourcesOnlyResponse | null`
- `error: string | null`
- `jobId: string | null`
- `loading: boolean`
- `currentStage`, `completedStages`, `elapsed` (live progress for the in-flight job)
- `RESUME_STORAGE_KEY = "legal-source-search:active_job"` (sessionStorage)
- `externalResult` prop hydration effect

After Phase 1:

- New canonical state:
  ```ts
  type TurnStatus = "running" | "done" | "error";
  type Turn = {
    id: string;             // job_id when known, else local uuid placeholder
    question: string;
    status: TurnStatus;
    result?: SourcesOnlyResponse;
    error?: string;
    startedAt: number;
  };
  const [turns, setTurns] = useState<Turn[]>([]);
  ```
- `result`, `error`, `jobId`, `loading` are removed as independent state. They are derived from the last turn:
  - `activeTurn = turns[turns.length - 1]`
  - `loading = activeTurn?.status === "running"`
  - `jobId = activeTurn?.status === "running" ? activeTurn.id : null`
- `currentStage`, `completedStages`, `elapsed` stay as-is — they describe the single in-flight job, which is always the tail turn. They reset whenever a new running turn is appended.
- `question` (composer textarea) stays as a separate input-only state; it is cleared after submit so the user bubble shows it instead.

## Polling / resume with the turns array

`pollJob(jid)` updates the tail turn instead of top-level state:

- On status `done`: `setTurns(prev => prev.map(t => t.id === jid ? { ...t, status: "done", result } : t))`, stop timers, clear sessionStorage tail-job marker.
- On status `error`: same shape with `status: "error", error`.
- Stage updates (`current_stage`, `completed_stages`) keep updating the existing refs/state; they always describe the tail running turn.

`handleSubmit`:

1. Push a placeholder turn `{ id: tempId, question, status: "running", startedAt: now }`.
2. Call `legal-research-v1`. On success, replace the placeholder's `id` with `data.job_id`. On invoke error, flip the placeholder to `status: "error"`.
3. Clear the composer textarea after the turn is pushed (so the bubble shows the query, not the input).

Resume-on-mount:

- Read the new key (see below). If the persisted tail turn is `running`, restore the full `turns` array, call `startProgress(turn.startedAt)`, and `pollJob(turn.id)`.
- If the tail turn is `done`/`error`, just restore `turns` for display, no polling.

`handleCancel`: flips the tail turn from `running` to `error` with the existing cancel message; stops timers; clears the sessionStorage key. Other turns are untouched.

## sessionStorage key + migration

- New key: `legal-source-search:turns`.
- Value: JSON array of `Turn`, capped to the last 5 entries (FIFO drop).
- Written on every `setTurns` via a single `useEffect([turns])`.
- Migration from old key `legal-source-search:active_job` (one read, then delete):
  - On mount, if new key is empty and old key holds `{ jobId, startedAt }`, synthesize a single running turn `{ id: jobId, question: "", status: "running", startedAt }` and resume polling. Question text is unknown for legacy in-flight jobs; the bubble renders an em-dash placeholder until poll resolves (then we discard the bubble's question or leave it blank — acceptable for one-time migration).
  - Always `sessionStorage.removeItem(old key)` after the read, regardless of whether it was used.

## UI rendering structure

Inside the existing scroll container (`flex-1 min-h-0 overflow-y-auto`):

```
{turns.map(turn => (
  <div key={turn.id} className="space-y-2">
    <UserQueryBubble question={turn.question} />        // right-aligned RTL pill
    {turn.status === "running" && <StageTracker ... />} // existing stages + skeleton
    {turn.status === "error"   && <ErrorCard text={turn.error} />}
    {turn.status === "done"    && turn.result && (
       <SourceResultsView result={turn.result} debug={turn.result.debug ?? {}} />
    )}
  </div>
))}
<div ref={bottomRef} />
```

- `UserQueryBubble` is a small local component (no new file) using existing tokens (`bg-primary/10`, `rounded-2xl`, `px-3 py-2`, `text-sm`, `max-w-[80%]`, `ms-auto`).
- Stage tracker, skeleton, error card, and `SourceResultsView` are the existing JSX, just moved inside the per-turn map and bound to the tail running turn for live state.
- Auto-scroll: `useEffect(() => bottomRef.current?.scrollIntoView({ block: "end" }), [turns, currentStage, completedStages, elapsed])`.
- Composer position, send/cancel/clear buttons, send-disabled logic: unchanged.
- `handleClearAll`: `setTurns([])`, clears composer, clears new sessionStorage key, plus existing `setError(null)` removal (no longer needed since error lives on the turn).
- `externalResult` effect: sets `turns` to `[{ id: uuid, question: externalResult.question, status: "done", result: externalResult.payload, startedAt: Date.now() }]`. Same single-panel feel as today.

## Risks

- Stale-closure bugs in `pollJob`: today the poller closes over `setResult`. We need `setTurns(prev => ...)` updaters and to read the tail turn via functional updates so concurrent renders don't drop status transitions.
- `currentStage` / `completedStages` reset timing: if a new turn is submitted while the previous is still running (shouldn't happen because send is disabled, but the cancel-then-submit path exists), make sure the stage refs are cleared in `startProgress` before the new poll starts.
- Legacy resume key with unknown question text: the migration turn shows an empty bubble for one cycle. Acceptable; documented above.
- sessionStorage size: 5 turns × full `SourcesOnlyResponse` could be large. Mitigation: when persisting, store the full `result` only for the tail turn; for older turns persist `result` minus `debug` (debug can be heavy). If still oversized, drop the oldest turn until under ~1 MB.
- Auto-scroll fighting the user scrolling up to read older results: scroll to bottom only when the user is already near the bottom (threshold check on `scrollTop + clientHeight` vs `scrollHeight`), otherwise skip.
- History sidebar behavior is preserved (single-turn reset), but users may now expect follow-ups after opening a historical run. That's fine — submitting a new query from that state simply appends; nothing about Phase 1 prevents it, and no `prior_turn` is sent yet so semantics are unchanged.

## Out of scope (deferred to Phase 2)

- `prior_turn` payload, queryPlanner-only prompt change, feature flag, analyzer changes, verifier/ranker changes, `citation-chat` changes, DB schema changes.
