## Why the academic query "stopped" when you visited Profile

### What's happening today
- `/app` and `/profile` are sibling routes in `src/App.tsx`. Clicking the profile icon unmounts `Index → LegalQAChat`, which orphans the in-flight `fetch` to `legal-qa`. The backend keeps running and still writes its result to `qa_logs`, but the frontend has no way to find it again.
- A resume mechanism already exists (`src/components/LegalQAChat.tsx` lines 905‑964 + `setAcademicRunMarker`/`pollLegalQaStatus` + `legal-qa-status` edge function), but `onRunId` only persists the marker when:
  ```
  academicStep === "write_chapter" | "write_introduction" | "write_conclusion"
  ```
  (see the `isLongFormWriteGuard` block at line 1612).
- The "academic search" actions that build the outline / suggest topics / validate the research question (`suggest_topics`, `validate_question`, `propose_outline`) go through the same streaming `legal-qa` endpoint and the backend already emits `run_id` for them, but the client throws that id away. So when you come back, there is nothing to poll → the UI shows an empty state and it looks like the query was cancelled.

### Fix plan (frontend-only, ~30 lines)

1. **Persist the run marker for every meaningful academic step**
   - In `LegalQAChat.tsx` widen the marker-persistence guard so the same `setAcademicRunMarker` write fires for `propose_outline`, `suggest_topics`, and `validate_question`, not just the three long-form writes.
   - Concretely: add `const isResumableAcademicStep = isLongFormWriteGuard || ["propose_outline","suggest_topics","validate_question"].includes(academicStep);` and use that flag in the `onRunId` callback (line 1611‑1620) and in the post-stream cleanup at line 1739 that clears the marker.

2. **Teach the resume effect how to apply non-write results**
   - The existing resume effect (line 910‑964) assumes the recovered payload is a chapter body and writes it into `chapters[marker.chapterIdx]`. Extend it to branch on `marker.step`:
     - `write_chapter | write_introduction | write_conclusion` → keep current behavior.
     - `propose_outline` → call the same handler that consumes a successful outline response today (sets `outline`, advances `wizardStep` to "outline"). Find the existing success path around line 1674 (`else if (academicStep === "propose_outline")`) and refactor it into a small helper, then reuse it from the resume effect.
     - `suggest_topics` / `validate_question` → reuse their corresponding success branches the same way.

3. **Surface a non-alarming toast on remount**
   - Replace the chapter-specific `"הפרק הושלם ברקע ונטען מחדש"` with a step-aware label, e.g. `"השאילתה הושלמה ברקע ונטענה מחדש"` for outline/topics/validation. No behavior change beyond the string.

4. **Tighten the marker schema (no DB migration)**
   - `setAcademicRunMarker` already takes `{ runId, step, chapterIdx }`. For non-write steps `chapterIdx` is meaningless — pass `-1` so the resume effect's "apply to chapter slot" branch is guaranteed to be skipped. No backend or schema change needed.

### Out of scope
- Non-academic Legal QA (regular research). It does not have a resume mechanism at all; we can address it separately if you want, but you described the academic path so I'm keeping the change focused.
- Backend (`supabase/functions/legal-qa/index.ts`) — it already persists qa_logs and emits `run_id` for every step. No change needed.
- No DB schema or RLS changes; `academic_sessions.current_run_id` is already in use.

### Files touched
- `src/components/LegalQAChat.tsx` only.

### How to verify after implementation
- Start `propose_outline` in academic mode, click the profile icon mid-stream, come back. Expect: progress reattaches, finishes, outline appears, toast "השאילתה הושלמה ברקע ונטענה מחדש".
- Repeat for a chapter write (already works today) to confirm no regression.