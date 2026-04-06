

# Show "מקורות מאומתים" sidebar link to all users

## Problem
The sidebar link is currently gated behind `isSubscribed || isAdmin`, so non-subscribers never see it. The user wants all authenticated users to see the link — clicking it as a non-subscriber should show the existing upgrade/paywall prompt on the page itself.

## Change

| File | Change |
|------|--------|
| `src/components/AppSidebar.tsx` | Remove the `(isSubscribed || isAdmin)` condition wrapping the "📚 מקורות מאומתים" button+separator block, so it renders for all authenticated users. The page already handles access gating with the Lock/upgrade screen. |

