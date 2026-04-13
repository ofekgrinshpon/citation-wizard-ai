

## Add Stop Button to LegalQAChat Component

### Problem
The `LegalQAChat` component (used on `/app`) has no way to cancel an in-progress request. It uses `supabase.functions.invoke()` which doesn't support `AbortController`, and the send button just shows a spinner while loading.

### Changes

**`src/components/LegalQAChat.tsx`**

1. Switch from `supabase.functions.invoke()` to raw `fetch()` with `AbortController` (same pattern as `LegalQA.tsx` lines 118-135)
2. Add an `abortControllerRef` using `useRef<AbortController | null>(null)`
3. Add a `handleStop` function that aborts the controller and resets loading state
4. Change the send button (line 605-615): when `loading` is true, show a stop icon (StopCircle) that calls `handleStop` instead of the spinning indicator

### Technical Detail
- The send button currently shows a spinner during loading and is disabled. It will instead become a clickable stop button with a `StopCircle` icon styled in destructive color.
- The `fetch()` call will use the same URL pattern (`${VITE_SUPABASE_URL}/functions/v1/legal-qa`) and auth headers as the existing `LegalQA.tsx` page.

