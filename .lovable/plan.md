

# Fix: Word Add-in Buttons Missing + Copy Not Working

## Problems Found

1. **"Insert to Word" buttons not showing**: The `useOffice` timeout fallback (line 53-56) sets `isReady=true` but does NOT set `isOfficeAddin=true`. If Office.onReady doesn't fire before the 5-second timeout, `isOfficeAddin` stays `false` and all Word-specific buttons are hidden. This is the most likely cause.

2. **Copy button not working**: `navigator.clipboard.write()` and `navigator.clipboard.writeText()` are blocked in Word Online's cross-origin iframe due to Permissions Policy restrictions. Need a fallback using `document.execCommand('copy')` with a temporary textarea.

## Fix

### 1. Fix `useOffice` timeout fallback (`src/hooks/useOffice.tsx`)

In the timeout fallback (line 53-56), also set `isOfficeAddin` to `true` when `addinRoute` is true. If we know we're on `?addin=1`, we should trust that even if Office.onReady never fires:

```tsx
const timeoutId = window.setTimeout(() => {
  window.clearInterval(intervalId);
  if (addinRoute) setIsOfficeAddin(true); // <-- add this
  setIsReady(true);
}, 5000);
```

### 2. Fix clipboard in Word Online iframe (`src/components/MessageBubble.tsx` + `src/components/BatchFootnoteBuilder.tsx`)

Create a shared clipboard utility (`src/lib/clipboard.ts`) that:
- Tries `navigator.clipboard.write()` first (rich text)
- Falls back to `navigator.clipboard.writeText()` 
- Falls back to `document.execCommand('copy')` with a temporary textarea
- Returns success/failure

Then use this utility in both `MessageBubble.copyContent()` and `BatchFootnoteBuilder.copyAll()`/`copySingle()`.

## Files

| Action | File |
|--------|------|
| Modify | `src/hooks/useOffice.tsx` — set `isOfficeAddin=true` in timeout fallback |
| Create | `src/lib/clipboard.ts` — clipboard utility with execCommand fallback |
| Modify | `src/components/MessageBubble.tsx` — use clipboard utility |
| Modify | `src/components/BatchFootnoteBuilder.tsx` — use clipboard utility |

