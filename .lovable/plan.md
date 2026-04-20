

## Root cause
When navigating from `/profile` back to `/app`, the lock modal flashes for a split second.

`Index.tsx` line 761 renders a 🔒 "הגעת למכסה המרבית" overlay whenever `subscription.isLimitReached` is true. That value comes from `useSubscription` → `useCredits`, computed as:

```
isLimitReached = !isAdmin && totalCreditsAvailable <= 0
totalCreditsAvailable = (profile?.included_credits_remaining ?? 0) + (profile?.topup_credits_remaining ?? 0)
```

While the profile re-fetches on `/app` mount, `profile` is `null`, so both balances default to `0`, `isLimitReached` evaluates to `true`, and the modal renders for one frame — even for a Pro user with 244 credits left. The same race makes `loading` flip from `true` (initial) to `false` only after the fetch resolves.

## Fix

Gate the modal on the loading state so it never renders before the profile has actually loaded.

### File: `src/pages/Index.tsx`
Line 761 — change:
```tsx
{subscription.isLimitReached && (
```
to:
```tsx
{!subscription.loading && subscription.isLimitReached && (
```

Also harden the early-return guard inside `handleSend` (line 511) the same way so a submit that races the refetch doesn't silently no-op:
```tsx
if (!subscription.loading && subscription.isLimitReached) return;
```

That's the entire change — one component, two lines, no behavior change for genuinely depleted users.

### Why not also change `useCredits`
We could make `totalCreditsAvailable` return `Infinity` while loading, but that would mask real "0 credits" states elsewhere. Gating the UI on `loading` at the consumer is more precise and keeps the hook's numbers honest.

## Out of scope
- The `LegalQA.tsx` Lock icon (line 282) — already correctly gated by `if (authLoading || subLoading)` at line 110, so no flash there.
- Any redesign of the limit modal or copy.

## Expected outcome
- Returning from `/profile` to `/app` shows the workspace immediately, no 🔒 flash.
- Pro user with credits never sees the lock.
- A user who genuinely has 0 credits still sees the modal once the fetch resolves — same behavior as today.

