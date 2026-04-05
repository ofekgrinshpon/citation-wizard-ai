

# Fix Word Add-in White Screen

## Root Causes Identified

1. **No visible loading state before React renders.** When `?addin=1` is detected, `main.tsx` waits up to 5 seconds for Office.js before rendering anything — the user sees pure white.

2. **`FunctionFile` in manifest points to the full app.** Line 39 of `manifest.xml` sets `FunctionFile resid="Taskpane.Url"` which loads the entire React app as a "function file." This is meant for lightweight command handlers, not full apps — Word Online may error trying to initialize it.

3. **Unhandled errors crash silently.** If `useSubscription`, `useProjects`, or auth hooks throw (e.g., RLS error, network issue), there's no error boundary — React unmounts and shows white.

4. **Auth redirect race in Index.tsx.** When the add-in opens `/app?addin=1`, auth is still loading. Once it resolves with no user, it redirects to `/?addin=1`. This works, but during the transition there's no feedback.

## Plan

### 1. Add HTML loading indicator in `index.html`
Add a simple CSS spinner inside `<div id="root">` so something shows immediately, before any JS executes. React will replace it on mount.

### 2. Remove `FunctionFile` from `manifest.xml`
Delete line 39 (`<FunctionFile resid="Taskpane.Url" />`). Task pane add-ins don't require a FunctionFile unless you use ribbon commands that execute functions. The current manifest only uses `ShowTaskpane`, which doesn't need it.

### 3. Add React Error Boundary in `App.tsx`
Wrap the app routes in an error boundary component so that if any hook crashes, the user sees an error message instead of a white screen.

### 4. Add loading fallback in `Index.tsx`
While `authLoading` is true, show a spinner instead of rendering nothing. This prevents the brief white flash before the redirect to Landing.

## Files

| Action | File |
|--------|------|
| Modify | `index.html` — add inline loading spinner inside `#root` |
| Modify | `manifest.xml` — remove `FunctionFile` line |
| Modify | `src/App.tsx` — add ErrorBoundary wrapper |
| Modify | `src/pages/Index.tsx` — show spinner while auth loads |

