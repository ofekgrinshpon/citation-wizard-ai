

# Fix subscription badge flicker on navigation

## Problem
When navigating from admin back to the app, `useSubscription` re-fetches from the database. During that fetch, `isSubscribed` defaults to `false` and `loading` is `true`, causing the badge to briefly flash "לא מנוי" (red) before updating to the correct state.

## Solution
Use the `loading` state from `useSubscription` in `AppSidebar` to hide the badge until subscription status is resolved.

## Change

| File | Change |
|------|--------|
| `src/components/AppSidebar.tsx` | Destructure `loading` from `useSubscription()`. Wrap the subscription `Badge` (lines 86-92) in a condition: only render when `!loading`. While loading, either show nothing or a small skeleton placeholder so there's no flash of incorrect state. |

