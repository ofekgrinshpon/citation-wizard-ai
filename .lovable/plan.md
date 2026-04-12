

## Fix: Copy Formatting + History Sidebar Refresh

### Issue 1: Copy-paste loses formatting
`handleCopy` in `LegalQAChat.tsx` uses `copyPlainText`, so the clipboard only gets unformatted text. Need to switch to `copyRichText` and build an HTML version with David 12pt styling — same approach used in `MessageBubble.tsx`.

**Change in `LegalQAChat.tsx`:**
- Import `copyRichText` instead of `copyPlainText`
- In `handleCopy`, build an HTML string with `direction: rtl`, `font-family: David`, `font-size: 12pt`, `line-height: 1.5`, `text-align: justify`
- Convert `**bold**` markers to `<strong>` tags
- Style footnotes section at 10pt
- Keep the on-screen display using the app's current font (no change to rendering)

### Issue 2: History sidebar doesn't refresh after new query
`qaRefreshKey` is incremented in `Index.tsx` when `onResultSaved` fires, but it's never passed to `QAHistorySidebar`. The sidebar only fetches data on mount.

**Changes:**
- `QAHistorySidebar.tsx`: Add a `refreshKey` prop; include it in the `useEffect` dependency array so it re-fetches when incremented
- `Index.tsx`: Pass `refreshKey={qaRefreshKey}` to `QAHistorySidebar`

### Files
- `src/components/LegalQAChat.tsx` — rich text copy
- `src/components/QAHistorySidebar.tsx` — add `refreshKey` prop
- `src/pages/Index.tsx` — pass `refreshKey` to sidebar

