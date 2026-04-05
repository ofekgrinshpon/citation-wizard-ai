
Goal: make Word Online footnote insertion wait for real document access instead of assuming any Office shell can insert.

1. Separate “Office add-in” from “Word document ready”
- In `src/hooks/useOffice.tsx`, keep `isOfficeAddin` for compact/add-in UI.
- Add a second capability such as `canUseWordDocument` / `hasDocumentAccess`.
- Compute it only from real insertion signals:
  - `Office.context.document`
  - or `Word.run`
- Do not treat `Office.context.ui` alone as enough for insertion.

2. Make Word readiness detection more robust
- In `src/lib/wordInsertion.ts`, replace the current short readiness check with a dedicated wait that:
  - waits for `Office.onReady`
  - polls longer for `Office.context.document`
  - also treats `Word.run` as a valid usable path even if `document` is late
- Return clearer diagnostics so we can distinguish:
  - Office loaded, no host
  - host exists, document not ready yet
  - Word APIs unavailable entirely

3. Guard the UI until Word APIs are actually ready
- In `src/components/BatchFootnoteBuilder.tsx` and `src/components/MessageBubble.tsx`:
  - keep Word buttons visible in add-in mode
  - but disable them until `hasDocumentAccess` is true
  - show a small “connecting to Word…” hint instead of letting users hit the runtime error
- This matches the current add-in UX while preventing false failures.

4. Fix add-in routing to preserve the real path
- In `src/App.tsx`, stop hardcoding `MemoryRouter` to `"/?addin=1"`.
- Use the actual current path + search as the initial memory entry.
- This avoids breaking add-in subroutes like `/auth-dialog?addin=1`, which can indirectly affect Office initialization/auth flows.

5. Tighten insertion fallback behavior
- Keep the existing insertion order, but make the fallback logic explicit:
  - try `Word.run` first
  - if unavailable, wait/retry once more
  - only then use Common API insertion through `Office.context.document`
- If neither path exists after the wait window, fail with a targeted message instead of the current generic one.

Files to update
- `src/hooks/useOffice.tsx`
- `src/lib/wordInsertion.ts`
- `src/components/BatchFootnoteBuilder.tsx`
- `src/components/MessageBubble.tsx`
- `src/App.tsx`

Technical notes
- Root issue: the app currently knows it is “inside Office”, but insertion needs a narrower condition: document APIs must be ready.
- `Office.context.ui` is enough for dialogs/host shell, but not enough for footnote insertion.
- Word Online is slower/more timing-sensitive than desktop, so readiness must be treated as asynchronous capability detection, not a one-time boolean.

QA to run after implementation
- Regular web and mobile still open in normal web mode.
- Word Online task pane loads without blank screen.
- Login/auth dialog still works in add-in mode.
- Single footnote insertion works.
- “Insert all” works.
- Buttons stay disabled until Word is truly ready, then become enabled.
