

# Fix: Mobile browser incorrectly detected as Office Add-in

## Problem

The Office.js CDN script (`office.js`) is loaded statically in `index.html` for **all** visitors. On mobile browsers, `window.Office.onReady` becomes truthy after the script loads, causing both `isOfficeAddin()` (in `App.tsx`) and `hasOfficeHost()` (in `useOffice.tsx`) to return `true`. This triggers MemoryRouter, compact mode, and Word-specific UI on regular mobile browsers.

## Solution

Only treat the app as an Office Add-in when there is a **real Office host** — not just because the Office.js library loaded. The `Office.onReady` callback receives an `info` object with a `host` property (e.g., `"Word"`). Outside a real Office host, `info.host` is `null`/`undefined`.

### 1. `src/App.tsx` — Fix `isOfficeAddin()` detection

Change the check from `Boolean(win.Office?.onReady)` to only trust explicit signals:
- `?addin=1` query parameter (set by the manifest)
- `Office.context.host` being a non-empty string

Remove `win.Office?.onReady` from the detection logic since it's always truthy when the script is loaded.

### 2. `src/hooks/useOffice.tsx` — Fix `hasOfficeHost()` detection

Same change: remove `win.Office?.onReady` from `hasOfficeHost()`. Only check `Office.context.host` and `Office.context.ui`.

Additionally, in the `onReady` callback handler, only set `isOfficeAddin(true)` when `info.host` is truthy — not just because `onReady` fired.

### 3. `src/main.tsx` — Guard the Office.onReady path

The bootstrap function currently assumes if `Office.onReady` exists, it should wait for it. Add a timeout-first approach: render immediately but let `onReady` also trigger render. This is already partially in place but the `onReady` check itself (`win.Office?.onReady`) will always be true. No functional change needed here since the timeout fallback already handles it.

## Files

| File | Change |
|------|--------|
| `src/App.tsx` | Remove `win.Office?.onReady` from `isOfficeAddin()`, only check `context.host` or `context.ui` |
| `src/hooks/useOffice.tsx` | Remove `win.Office?.onReady` from `hasOfficeHost()`; only set addin=true in `onReady` callback when `info.host` is truthy |

