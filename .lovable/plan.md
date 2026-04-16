

# Academic Writing (Seminar Wizard) Mode — Updated Plan

This is the same plan as previously approved, with one addition: **session persistence and navigation guard** for the wizard state.

## Addition: Wizard State Persistence & Exit Warning

### localStorage persistence (`LegalQAChat.tsx`)
- Store the wizard's accumulated state in `localStorage` under a key like `relex_academic_session_{projectId}`:
  - `wizardStep`, `currentChapter`, `chapters` (array of title + content), `researchQuestion`, `outline`
- On mount in `academic_writing` mode, check for a saved session and restore it (skip the init screen, jump to the last active step)
- Clear the saved session when the user completes or explicitly discards the paper
- Use `safeStorage` (from `src/lib/safeStorage.ts`) instead of raw `localStorage` to handle the Word Add-in iframe environment

### Navigation/refresh guard
- Add a `beforeunload` listener when `wizardStep` is past `"init"` and at least one chapter has content — shows the browser's native "unsaved changes" warning
- Remove the listener when the session is completed or discarded
- Optionally show an in-app confirmation dialog if the user tries to switch modes while a wizard session is in progress

### Debounced saves
- Save to `safeStorage` after each chapter is written/approved (not on every keystroke) to avoid performance issues with large accumulated text

## All Other Details
Everything else from the previously approved plan remains unchanged:
- Mode setup, multi-file upload, wizard state machine, academic engine prompt, sub-mode routing, history sidebar updates, edge function changes

## Files to Change
- `src/components/LegalQAChat.tsx` — wizard state machine, multi-file, new mode, **localStorage persistence + beforeunload guard**
- `supabase/functions/legal-qa/index.ts` — academic prompt, sub-mode routing, multi-file context
- `src/components/QAHistorySidebar.tsx` — label update
- `src/pages/Index.tsx` — type update

