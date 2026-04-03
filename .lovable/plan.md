
# Microsoft Word Task Pane Add-in Integration Plan

## Overview
Integrate the existing citation app as a Word Task Pane Add-in while preserving standalone web functionality. The app will detect at runtime whether it's running inside Office and adapt accordingly.

---

## 1. Office.js Loading & Dual-Mode Initialization

**Approach:** Conditional loading — only load Office.js when the app is opened as an add-in.

- Add `office.js` script tag to `index.html` but only when a query param or URL path indicates add-in mode (e.g., `/app?addin=1`).
- Alternatively, always include the script with a `defer` attribute — Office.js is a no-op when not inside Office. This is the simpler approach.
- Update `src/main.tsx` to wrap `createRoot` in an environment check:

```text
if Office.js is present → Office.onReady(() => render(<App />))
else → render(<App />) directly (current behavior)
```

- Create a React context `OfficeContext` that exposes `isOfficeAddin: boolean` and Word API helpers.

**Files:** `index.html`, `src/main.tsx`, new `src/hooks/useOffice.tsx`

---

## 2. Insert Citation as Footnote

**Primary function:** `insertCitationAsFootnote(text: string)`

**Formatting strategy:** Use **OOXML** (not HTML) for reliable bold/italic preservation in footnotes. The citation already uses `**bold**` and `##italic##` markers internally — we'll parse these into OOXML runs.

- Create `src/lib/wordInsertion.ts` with:
  - `insertCitationAsFootnote(text)` — calls `Word.run`, gets selection, inserts footnote
  - `citationToOoxml(text)` — converts `**bold**` / `##italic##` markers to OOXML `<w:r>` runs with `<w:b/>` / `<w:i/>`
- Add an "הכנס להערת שוליים" (Insert as Footnote) button to each assistant `MessageBubble`, visible only when `isOfficeAddin` is true.

**Files:** new `src/lib/wordInsertion.ts`, edit `src/components/MessageBubble.tsx`

---

## 3. UI Adaptation — Compact Mode

**Detection:** When `OfficeContext.isOfficeAddin` is true, activate compact mode automatically.

**Changes:**
- **Hide the sidebar** (`AppSidebar`) entirely in compact mode — project selection moves to a simple dropdown at the top.
- **Single-column layout** — the chat area fills the full 300px width.
- **Smaller typography** — reduce font sizes by ~1 step (e.g., `text-sm` → `text-xs` for secondary text).
- **Simplified header** — collapse to a single row with app name + project dropdown.
- **Tab bar** — keep tabs (freetext / manual / bibliography) but use icon-only or abbreviated labels.
- **Input bar** — full width, slightly smaller padding.
- Add Tailwind classes conditionally using a `compact` CSS class on the root or via the context.

**Files:** edit `src/pages/Index.tsx`, `src/components/AppSidebar.tsx`, add compact CSS utilities to `src/index.css`

---

## 4. Manifest File

Generate a `manifest.xml` at project root:
- Points `SourceLocation` to the published URL + `/app?addin=1`
- Defines a TaskPane command
- Sets default width to 300px
- Includes required metadata (app name in Hebrew, description, icon placeholders)
- Compatible with Office on Windows, Mac, and Web

**Files:** new `manifest.xml`

---

## 5. Authentication in Add-in

**Problem:** OAuth pop-ups are restricted in Office Task Panes. `window.open` may be blocked.

**Solution:**
- Use Office's `Office.context.ui.displayDialogAsync()` API to open a dialog window for Google OAuth.
- Flow:
  1. User clicks "Sign in with Google" in the Task Pane
  2. If in Office → open auth page via `displayDialogAsync`
  3. Auth page completes OAuth, sends token back to Task Pane via `messageParent()`
  4. Task Pane receives token, sets Supabase session manually
- Create a dedicated `/auth-dialog` route that handles the OAuth callback and calls `Office.context.ui.messageParent(token)`.
- For email/password login — works normally inside the Task Pane, no changes needed.

**Files:** new `src/pages/AuthDialog.tsx`, edit `src/hooks/useAuth.tsx`, edit `src/App.tsx` (add route)

---

## 6. Vite Configuration

- Add `https://appsforoffice.microsoft.com` to allowed origins in dev server headers.
- Ensure HTTPS in development (Office Add-ins require HTTPS) — may need `@vitejs/plugin-basic-ssl` for local dev.

**Files:** edit `vite.config.ts`

---

## Implementation Order

1. Office context detection + dual-mode init (`useOffice`, `main.tsx`)
2. Manifest file generation
3. Compact mode UI adjustments
4. Word insertion logic (OOXML footnotes)
5. Auth dialog for Office environment
6. Vite HTTPS config for local testing

---

## Technical Notes

- OOXML is preferred over HTML for footnote insertion because Word's HTML-to-document conversion is lossy and inconsistent with RTL/Hebrew text. OOXML gives full control over formatting runs.
- The `manifest.xml` can later be replaced with a Teams App manifest (JSON) for distribution via Microsoft AppSource, but XML is simpler for initial development.
- The app remains fully functional as a standalone web app — all Office-specific code is behind the `isOfficeAddin` guard.
