## Goal
Make the short academic-search steps (`propose_outline`, `suggest_topics`, `validate_question`) resumable after the user navigates away (e.g. clicks the Profile icon) and comes back — same UX guarantee that long-form chapter writes already have.

## Root cause recap
- These steps don't use SSE; the client just `await fetch(...)` on `legal-qa`.
- Navigating to `/profile` unmounts `LegalQAChat`, aborting the fetch. The backend keeps running and writes to `qa_logs`, but the client has no `run_id` to poll on remount → result appears lost.
- Long-form writes already work because SSE emits `run_id`, the client persists an academic marker, and `legal-qa-status` polling reconciles on remount.

## Approach (Option B)
Client generates the `runId` (UUID) *before* the request, persists the marker, and passes the id to the backend in the request body. Backend inserts a `qa_logs` row immediately with that id, runs the step, then updates the same row. On remount we poll `legal-qa-status` exactly like chapter writes do.

## Changes

### Backend — `supabase/functions/legal-qa/index.ts`
1. Accept optional `runId` in the request body (validate UUID v4 shape). If absent, generate one (preserves backward compat).
2. For the three short academic steps (`propose_outline`, `suggest_topics`, `validate_question`):
   - Insert a `qa_logs` row up-front with `{ id: runId, user_id, project_id, question, task_mode: 'research', answer: null, metadata: { checkpoint: 'running', academic_step } }`.
   - After the AI call completes, `UPDATE qa_logs SET answer=..., footnotes=..., metadata=jsonb_set(metadata,'{checkpoint}','completed') WHERE id = runId`.
   - On failure, set `metadata.checkpoint='failed'` + `error_message`.
3. Return `runId` in the JSON response body so the client can confirm.
4. No change to streaming write paths — they already emit `run_id` over SSE.

### Frontend — `src/components/LegalQAChat.tsx`
1. Add a tiny helper that, for the three short academic steps, does:
   - `const runId = crypto.randomUUID();`
   - `setAcademicRunMarker({ runId, step, chapterIdx: -1 });` *before* `fetch`.
   - `fetch('legal-qa', { body: JSON.stringify({ ..., runId }) })`.
   - On success → clear marker and apply payload via the existing per-step success handlers.
   - On `AbortError`/network failure → leave the marker so the resume effect can take over.
2. Extend the existing resume effect (around lines 905–964) to branch on `marker.step`:
   - `write_chapter | write_introduction | write_conclusion` → unchanged.
   - `propose_outline` → reuse the outline success branch (set `outline`, advance `wizardStep` to `"outline"`).
   - `suggest_topics` → reuse topics success branch.
   - `validate_question` → reuse validation success branch.
   Extract each success branch into a small local helper so the resume effect and the normal success path stay in sync.
3. Step-aware reattach toast: `"השאילתה הושלמה ברקע ונטענה מחדש"` for the three short steps; keep chapter-specific toast unchanged.
4. `chapterIdx: -1` for non-write steps so the existing "apply to chapter slot" branch is guaranteed to be skipped.

### No-op / out of scope
- `legal-qa-status` edge function — already returns `answer` + `footnotes` when `checkpoint === 'completed'`; no changes needed.
- `academic_sessions` schema, RLS, `qa_logs` schema — unchanged.
- Non-academic Legal QA — separate path, can be addressed later.

## Verification
1. Start `propose_outline` in academic mode → click Profile mid-request → return. Expect: poll fires, outline appears, toast `"השאילתה הושלמה ברקע ונטענה מחדש"`, wizard advances to "outline".
2. Repeat for `suggest_topics` and `validate_question`.
3. Hard refresh mid-request (different from #1 — kills JS): expect the marker (already in `localStorage` + `academic_sessions.current_run_id`) to drive the same polling on next mount.
4. Regression: chapter write resume continues to work; finished short steps that complete before unmount still clear the marker and don't double-toast.

### Files touched
- `supabase/functions/legal-qa/index.ts`
- `src/components/LegalQAChat.tsx`
