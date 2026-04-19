

## Goal
When the user clicks an **academic_writing** entry in the history sidebar, jump back into the Seminar Wizard at its **last progress** (current chapter, outline, all written chapters, current step) — instead of dumping the single chapter text into the read-only result pane.

## Current behavior (verified)
- `qa_logs` stores **one row per academic step** (e.g., each `write_chapter` call). The `answer` is just that one chapter's text — not the full wizard state.
- The full wizard state (`wizardStep`, `currentChapter`, `chapters[]`, `outline`, `researchQuestion`, `proposedQuestions`, `maxReachedStep`) lives in **localStorage** at `relex_academic_session_{projectId}` (`saveAcademicSession` in `LegalQAChat.tsx:149`).
- Clicking any history item runs `QAHistorySidebar.handleClick` → `onLoadResult(question, result, taskMode)` → `Index.tsx` sets `qaExternalResult` → `LegalQAChat`'s `externalResult` effect (line 338) sets `question`, `result`, `taskMode`. It does **not** touch wizard state, so the user lands on the academic mode default screen with the result text floating outside the wizard.

## Plan

### 1. `src/components/QAHistorySidebar.tsx`
- When rendering each log button, if `task_mode === "academic_writing"`, show a small "המשך עבודה אקדמית" hint badge and use a `GraduationCap` icon (already in the labels map) — visual cue that clicking resumes a session.
- No change to the `onLoadResult` signature; the resume logic lives downstream so behavior stays uniform.

### 2. `src/pages/Index.tsx` (around line 1156)
- In the `onLoadResult` callback, branch on `taskMode`:
  - If `"academic_writing"`: ensure the `LegalQAChat` is in academic mode and trigger a **resume signal** (e.g., set a new state `academicResumeSignal` = a counter or timestamp) instead of stuffing into `qaExternalResult`. Pass that signal to `LegalQAChat` as a new prop `academicResumeSignal?: number`.
  - For all other modes: keep current `setQaExternalResult` behavior unchanged.

### 3. `src/components/LegalQAChat.tsx`
- Add a new prop `academicResumeSignal?: number`.
- Add a new `useEffect` that watches `academicResumeSignal`:
  1. Force `taskMode = "academic_writing"`.
  2. Call `loadAcademicSession(projectId)`.
  3. If a saved session exists (`wizardStep !== "init"`):
     - Restore all state: `wizardStep`, `maxReachedStep`, `currentChapter`, `chapters`, `researchQuestion`, `outline`, `proposedQuestions`, `lastAcademicAction`.
     - Set `currentChapter` to the **last chapter with content** (or the first chapter without content, whichever is further along) so the user lands precisely on their last progress point.
     - Clear any `result`/`error` left over from a previous research view.
     - Toast: `"חזרת לעבודה האקדמית — פרק נוכחי: {title}"`.
  4. If no saved session exists for this project (e.g., user cleared localStorage or switched device):
     - Toast: `"לא נמצאה התקדמות שמורה לפרויקט זה. ההיסטוריה מציגה רק תוצאות פרקים קודמים."`
     - Fall back to the current behavior: load the clicked log's answer into `result` so the user at least sees the chapter text.

### 4. Edge case — multi-project history
The history sidebar is already filtered by `projectId` (see `QAHistorySidebar` query: `eq("project_id", projectId)`), and academic sessions are also keyed by `projectId`, so a clicked log will always match the currently loaded session. No cross-project resolution needed.

### 5. Out of scope
- Persisting wizard state to the database (would let users resume from another device — separate, larger feature).
- Showing per-chapter history items (each `qa_logs` row currently doesn't say *which* chapter it belongs to; would require a follow-up to record chapter index in the log).
- Editing or rewriting old chapters from history.

## Files to change
- `src/components/QAHistorySidebar.tsx` — minor visual hint for academic items.
- `src/pages/Index.tsx` — branch in `onLoadResult` to dispatch `academicResumeSignal` for academic logs.
- `src/components/LegalQAChat.tsx` — add `academicResumeSignal` prop + resume effect that restores wizard state from localStorage and lands on last progress.

## Expected outcome
Clicking any academic_writing entry in the history sidebar takes the user straight back into the Seminar Wizard at the chapter and step they last reached — with the outline, written chapters, and proposed questions all intact. If no local session exists, a clear toast explains why and the chapter text is still shown as fallback.

