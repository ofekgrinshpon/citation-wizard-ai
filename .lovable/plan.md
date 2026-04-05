

# Fix: Office.context.document undefined in Word Online

## Root Cause

Office.js is loaded dynamically via JavaScript in `main.tsx`. Microsoft requires it to be a **static `<script>` tag in `<head>`** for Word Online to properly wire up `Office.context.document` inside the iframe.

## Changes

### 1. `index.html` — Add static Office.js script
Add before the app bundle script:
```html
<script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js"></script>
```
This is harmless outside Office (creates an inert `Office` global).

### 2. `src/main.tsx` — Simplify bootstrap
Remove the dynamic `loadOfficeJs()` function entirely. Since Office.js is now always available via the static tag, just use:
```
Office.onReady(() => renderApp());
setTimeout(renderApp, 5000); // fallback for non-Office
```

### 3. `src/lib/wordInsertion.ts` — No changes needed
The existing `ensureOfficeReady` gate remains as a safety net.

## Files

| File | Change |
|------|--------|
| `index.html` | Add static Office.js `<script>` in `<head>` |
| `src/main.tsx` | Remove dynamic loading, use `Office.onReady` directly |

