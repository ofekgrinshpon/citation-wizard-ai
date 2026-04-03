

# Microsoft Word Task Pane Add-in — Architecture Plan

## Overview
The app will run in two modes: **standalone web** (current) and **Word Add-in** (Task Pane). At runtime, it detects whether it's inside Office and adapts accordingly. All Office-specific code is behind a guard — the standalone app remains unchanged.

---

## 1. Office.js Loading & Dual-Mode Init

- Add the `office.js` script to `index.html` (it's a no-op outside Office)
- Update `src/main.tsx`: if Office is present, wrap render in `Office.onReady()`; otherwise render directly
- Create `src/hooks/useOffice.tsx` — a React context exposing `isOfficeAddin: boolean` and Word API helpers

**Files:** `index.html`, `src/main.tsx`, new `src/hooks/useOffice.tsx`

---

## 2. Insert Citation as Footnote

Create `src/lib/wordInsertion.ts`:
- `insertCitationAsFootnote(text)` — uses `Word.run` to insert a footnote at the cursor
- `citationToOoxml(text)` — converts `**bold**` / `##italic##` markers to OOXML `<w:r>` runs with `<w:b/>` / `<w:i/>` for reliable formatting

Add an "הכנס להערת שוליים" button on each assistant message bubble, visible only in add-in mode.

**Why OOXML over HTML?** Word's HTML import is lossy with RTL/Hebrew. OOXML gives exact control over bold, italic, and BiDi runs.

**Files:** new `src/lib/wordInsertion.ts`, edit `src/components/MessageBubble.tsx`

---

## 3. Compact Mode UI (300px Task Pane)

When `isOfficeAddin` is true:
- **Hide sidebar** — replace with a small project dropdown at the top
- **Single-column layout** filling full width
- **Smaller fonts** and tighter padding
- **Tabs** use abbreviated labels or icons
- Applied via a `compact` class on the root, driven by the Office context

**Files:** edit `src/pages/Index.tsx`, `src/components/AppSidebar.tsx`, `src/index.css`

---

## 4. Manifest File

Generate `manifest.xml` at project root:
- `SourceLocation` → published URL + `/app?addin=1`
- TaskPane command definition, default width 300px
- Hebrew display name and description
- Compatible with Office on Windows, Mac, and Web

**Files:** new `manifest.xml`

---

## 5. Authentication in Add-in

OAuth pop-ups are blocked inside Task Panes. Solution:
- Use `Office.context.ui.displayDialogAsync()` to open a dialog for Google OAuth
- Create `/auth-dialog` route — completes OAuth, sends token back via `messageParent()`
- Task Pane receives token and sets Supabase session
- Email/password login works as-is (no pop-up needed)

**Files:** new `src/pages/AuthDialog.tsx`, edit `src/hooks/useAuth.tsx`, `src/App.tsx`

---

## 6. Vite Config

- Allow `appsforoffice.microsoft.com` origin in dev headers
- Add HTTPS plugin (`@vitejs/plugin-basic-ssl`) for local Office testing

**Files:** edit `vite.config.ts`

---

## Implementation Order

1. Office context detection + dual-mode init
2. Manifest file
3. Compact mode UI
4. OOXML footnote insertion logic
5. Auth dialog for Office
6. Vite HTTPS for local dev

