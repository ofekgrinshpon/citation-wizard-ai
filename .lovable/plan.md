
## Goal

Make the "Insert to Word" actions appear reliably in both:
- "טקסט חופשי"
- "הערות שוליים"

without affecting the regular web app.

## What is actually going wrong

There are two separate issues in the current code:

1. `useOffice` can still stay `false` forever  
   In `src/hooks/useOffice.tsx`, if `window.Office?.onReady` exists, the effect returns immediately after registering the callback. If `onReady` does not complete as expected, and the URL no longer has `?addin=1`, `isOfficeAddin` can remain `false`, so all Word buttons stay hidden.

2. Some Word buttons are hidden behind hover-only UI  
   In:
   - `src/components/MessageBubble.tsx`
   - `src/components/BatchFootnoteBuilder.tsx`

   the per-item actions use `opacity-0 group-hover:opacity-100`. In the narrow Word task pane this makes the actions easy to miss, and on some environments hover is unreliable.

There is also a smaller routing issue:
- `AuthRedirect` and `AuthDialog` still have redirects that can drop the add-in query/context.

## Implementation plan

### 1. Make Office add-in detection robust
Update `src/hooks/useOffice.tsx` so it does not depend on a single signal.

Plan:
- Create one shared detection rule for:
  - `?addin=1`
  - `window.Office`
  - `window.Office.context.host`
  - `window.Office.context.ui`
  - `window.Office.onReady`
- Do not `return` early just because `Office.onReady` exists.
- Keep a timeout fallback active even when `onReady` is present.
- If Office runtime is present by timeout time, set `isOfficeAddin = true`.

This fixes the case where Office.js loads but `onReady` does not complete cleanly.

### 2. Preserve add-in routing everywhere
Update redirects so Word context is not lost.

Files:
- `src/App.tsx`
- `src/pages/AuthDialog.tsx`

Plan:
- Make `AuthRedirect` preserve `?addin=1` when present.
- Make `AuthDialog` fallback redirects preserve `?addin=1` too.

This prevents the app from silently falling back into “regular web app” mode.

### 3. Make Word actions always visible inside the add-in
Update both UI sections so Word actions are visible without hover when `isOfficeAddin` is true.

Files:
- `src/components/MessageBubble.tsx`
- `src/components/BatchFootnoteBuilder.tsx`

Plan:
- In free text results, keep the action row visible in add-in mode instead of hover-only.
- In footnotes, show per-footnote insert buttons visibly in add-in mode.
- Keep the current cleaner hover behavior for the normal browser app.

## Technical details

```text
Current failure path:
Office.js exists
→ onReady handler registered
→ effect returns early
→ URL/query may already be missing
→ isOfficeAddin never flips true
→ Insert buttons never render
```

```text
Target behavior:
Word add-in runtime detected by any valid signal
→ add-in mode stays true
→ query/context preserved through redirects
→ Insert buttons render visibly in Word UI
```

## Files to update

| Action | File |
|---|---|
| Modify | `src/hooks/useOffice.tsx` |
| Modify | `src/App.tsx` |
| Modify | `src/pages/AuthDialog.tsx` |
| Modify | `src/components/MessageBubble.tsx` |
| Modify | `src/components/BatchFootnoteBuilder.tsx` |

## Expected result

After this change:
- "Insert to Word" appears again in free text results
- "Insert to Word" appears in the footnotes section
- the regular web app remains unchanged
- add-in mode is no longer fragile when auth or routing occurs
