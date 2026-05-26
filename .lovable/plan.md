## Goal
Delete the "בקרה למסמכים משפטיים" (`pleading_analysis`) task mode from the Legal QA task picker. The mode is currently offline (MaintenanceCard) and serves no purpose to users. Leave the working "בדיקת מסמך" tool (FootnotesSection → DocumentCheckPage) and Landing page copy untouched.

## Scope
Frontend / presentation only. No backend, no edge function changes, no DB changes.

## Files to edit

### `src/components/LegalQAChat.tsx`
- Remove `pleading_analysis` from the `TaskMode` union (line 149) and from `FILE_RELEVANT_MODES` (line 151).
- Remove the `pleading_analysis` entry from `TASK_MODES` (line 155).
- Remove the two constants `PLEADING_OFFLINE_TITLE` and `PLEADING_OFFLINE_MESSAGE` (lines 42–43) and their imports if unused.
- In `handleSubmit` (lines 1929–1976): drop the `pleading_analysis` early-return toast, the file-only branch, and the `effectiveQuestion` special-case. Keep the `research` offline guard as-is.
- Remove the MaintenanceCard render block for `pleading_analysis` (lines 2954–2958) and simplify the sibling empty-state condition (line 2959) to drop the `pleading_analysis` exclusion.
- Simplify the submit button's `disabled` / `title` (lines 3196–3206) to drop the `pleading_analysis` branches.
- Drop `FileSearch` from the lucide-react import if it becomes unused after removing the TASK_MODES entry.

### `src/components/QAHistorySidebar.tsx`
- Remove the `pleading_analysis` entry from the icon/label map (line 38) and drop `FileSearch` from the lucide-react import if no longer used.

### `src/pages/Profile.tsx`
- Remove the `pleading_analysis: "עוזר משפטי – ביקורת מסמך"` label entry (line 65).

### `src/pages/Index.tsx`
- Narrow the two inline `TaskMode` unions (lines 133 and 1208) from `"research" | "pleading_analysis" | "case_summary" | "academic_writing"` to drop `"pleading_analysis"`.

## Out of scope (intentionally NOT touched)
- `FootnotesSection` / `DocumentCheckPage` / `useDocumentCheck` / `supabase/functions/document-check` — the actual document-checking tool stays.
- `src/pages/Landing.tsx` hero copy and chips ("בקרה למסמכים").
- Backend, DB, RLS, credits, edge functions.
- Memory note about offline modes — will be updated separately if/when all offline modes are removed.

## Acceptance
- The task picker in Legal QA shows three modes: מחקר משפטי, סיכום פסיקה, כתיבה אקדמית.
- No reference to `pleading_analysis` remains in `src/`.
- Build/typecheck pass; no dead imports.
- History sidebar still renders correctly for the three remaining modes; any pre-existing history rows tagged `pleading_analysis` will fall back gracefully (verify the lookup handles a missing key — add an `|| { label: taskMode, icon: ... }` fallback if needed).
