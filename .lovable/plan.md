## What happened

You were on the academic wizard's last chapter ("סיכום ומסקנות" → `write_conclusion`). The system was streaming it. You clicked the profile avatar, which navigated to `/profile` and **unmounted `LegalQAChat`**, which:

1. Aborted the in-flight `fetch` via the component's `AbortControllerRef`.
2. Cleared local React state — including the `question` input (it is local-only, never persisted to `academic_sessions`).

When you came back to `/app`, the wizard rehydrated from `academic_sessions` (chapters, outline, `researchQuestion`, `wizardStep`, `currentChapter`), but the `question` textbox started empty.

Clicking "כתוב פרק זה" calls `handleAcademicSubmit("write_conclusion")`. The guard at `LegalQAChat.tsx:1259` is:

```ts
if (!q && academicStep !== "write_chapter") {
  toast.error("יש להזין טקסט.");
  return;
}
```

`write_conclusion` and `write_introduction` aren't whitelisted, so an empty `question` field aborts — even though the function would happily fall back to `researchQuestion` (line 1288: `question: q || researchQuestion`).

## Fix — Part A (the actual bug)

`src/components/LegalQAChat.tsx` ~line 1259:

```ts
const isLongFormWrite =
  academicStep === "write_chapter" ||
  academicStep === "write_introduction" ||
  academicStep === "write_conclusion";
if (!q && !isLongFormWrite) {
  toast.error("יש להזין טקסט.");
  return;
}
// Defensive: long-form needs *something* to write about.
if (isLongFormWrite && !q && !researchQuestion) {
  toast.error("לא נמצאה שאלת מחקר. חזור לשלב 'שאלה' או הקלד אותה כאן.");
  return;
}
```

Pure presentation/state fix. Unblocks the current session immediately.

## Fix — Part B: Option 2 — Server-side completion + resume on remount

Cheaper than lifting state to a context provider, and also survives full page reloads + cross-device handoff (matches the existing `cross-device-resume` memory).

### Backend side — already works

`legal-qa` finishes the run regardless of whether the client is listening. Output lands in `qa_logs`. No edge-function changes needed.

### DB migration

Add three nullable columns to `academic_sessions`:

```sql
ALTER TABLE public.academic_sessions
  ADD COLUMN current_run_id uuid,
  ADD COLUMN current_run_step text,
  ADD COLUMN current_run_chapter_idx integer;
```

No new RLS — existing user-scoped policies cover them.

### Client side (`LegalQAChat.tsx`)

1. **On stream start** (`handleAcademicSubmit`, long-form path): write `{current_run_id, current_run_step, current_run_chapter_idx}` to `academic_sessions` as soon as we have a `qa_log` id (need backend to emit `run_id` in the first SSE event — verify; `legal-qa-status` already keys off `qa_logs.id`, so the id must already exist).
2. **On `final` or error**: clear those three columns alongside the chapter content save.
3. **On `LegalQAChat` mount**: if `academic_sessions.current_run_id` is set, call `legal-qa-status?runId=…`:
   - `completed` → drop `answer`/`footnotes` into the matching chapter, `setResult`, clear marker, surface a small "הפרק הושלם ברקע" sonner.
   - `running`/`queued` → render `StageProgressList` in a "מסתנכרן…" state and poll via the existing `pollLegalQaStatus` helper until terminal.
   - `failed` → clear marker, show inline error card.
4. Keep live SSE for the foreground case. Resume only kicks in when SSE was interrupted.

### Navigation warning (revised per your direction)

Non-blocking, informational, branched on whether the run marker was persisted.

In `LegalQAChat`, while `loading && isAcademicChapterRun`:

- **If `current_run_id` is persisted in `academic_sessions`** — show a one-time, non-blocking `toast.info` the first time the user clicks any nav target:

  > "הפרק עדיין נכתב ברקע. אם תעבור עמוד, ההתקדמות החיה תיעצר כאן, אבל תוכל לחזור ולטעון את התוצאה כשהכתיבה תסתיים."

  No `useBlocker`, no confirm dialog, navigation proceeds normally. On return to `/app` the resume effect above picks up the result.

- **If `current_run_id` has NOT been persisted yet** (rare: the run started but the marker write hadn't landed before navigation) — use `useBlocker` with a confirm:

  > "הפרק עדיין נכתב, וההפקה לא נשמרה עדיין לשחזור ברקע. אם תעבור עמוד עכשיו, התוצאה עלולה ללכת לאיבוד. להמשיך?"

- **Never** say "ההפקה תתבטל" / "the generation will be cancelled" once Option 2 is live. The backend keeps going.

Implementation note: a tiny `runPersistedRef` boolean inside `LegalQAChat`, flipped to `true` after the DB write in step 1 above, drives the branch.

## Scope

- **In:** Part A (toast bug), Option 2 (DB migration + resume effect + marker writes), revised non-blocking navigation toast / conditional blocker.
- **Out:** Lifting streaming state to an App-level context (Option 1), backend pipeline changes, SSE schema changes, multi-tab live mirroring.

## Recommended order

1. Part A (5-line edit) — ship immediately.
2. DB migration for the 3 marker columns.
3. Marker write on stream start + clear on finalize/error.
4. Resume-on-mount effect using `legal-qa-status` + `pollLegalQaStatus`.
5. Non-blocking nav toast (with the rare-case `useBlocker` branch).

Confirm and I'll implement.
