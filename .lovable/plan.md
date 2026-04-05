

# Fix Word Add-in: `o.replaceState is not a function`

## Root Cause

**`BrowserRouter` uses `history.pushState` / `history.replaceState` under the hood.** Word Online loads the add-in in a cross-origin iframe where these browser History API methods are restricted or unavailable. The minified error `o.replaceState is not an option` is React Router crashing because it cannot call `history.replaceState`.

The `ErrorBoundary` catches this and shows "משהו השתבש" — which is exactly what the user sees after the spinner.

## Fix

Replace `BrowserRouter` with `MemoryRouter` when running inside the Word add-in (`?addin=1`). `MemoryRouter` keeps all routing state in memory without touching the browser History API, which is exactly what's needed in a restricted iframe.

### 1. Switch to `MemoryRouter` for add-in mode (`src/App.tsx`)

Detect `?addin=1` before rendering. If true, use `MemoryRouter` (with `initialEntries={["/?addin=1"]}`). Otherwise, use `BrowserRouter` as normal.

```tsx
import { BrowserRouter, MemoryRouter, Route, Routes, Navigate } from "react-router-dom";

function isOfficeAddin() {
  try { return new URLSearchParams(window.location.search).get("addin") === "1"; }
  catch { return false; }
}

const Router = isOfficeAddin()
  ? ({ children }: { children: React.ReactNode }) => (
      <MemoryRouter initialEntries={["/?addin=1"]}>{children}</MemoryRouter>
    )
  : BrowserRouter;
```

Then replace `<BrowserRouter>` with `<Router>` in the JSX.

### 2. Preserve `addin=1` context in `MemoryRouter` (`src/hooks/useOffice.tsx`)

Since `MemoryRouter` doesn't update the real URL, `useOffice` should also check the initial `window.location.search` (already does this). No change needed here.

### 3. Fix navigation in Landing page (`src/pages/Landing.tsx`)

The `<Navigate to="/app?addin=1">` works fine with `MemoryRouter` — React Router parses the query string from the `to` prop. No change needed.

## Files

| Action | File |
|--------|------|
| Modify | `src/App.tsx` — use `MemoryRouter` when `?addin=1` |

This is a single-file fix. The `MemoryRouter` avoids all History API calls, eliminating the crash entirely.

