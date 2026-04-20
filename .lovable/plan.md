

## Goal
Replace the placeholder 👤 emoji in the sidebar user card with a refined initial-avatar treatment, and consolidate the user card so the hierarchy reads as: **name → plan → ניהול חשבון**.

## Current state
`AppSidebar.tsx` lines 78–88 render two stacked elements:
1. A `<button>` with a 👤 emoji and the display name
2. A separate `<CreditPill />` showing plan + "ניהול חשבון"

Both navigate to `/profile`. They become a single, polished card.

## Changes — `src/components/AppSidebar.tsx` only

### 1. Imports
- Drop `CreditPill` import.
- Add `useCredits`, `useMemo`, and `Infinity as InfinityIcon` from lucide-react.

### 2. Compute the initial
```ts
const { planMeta, isAdmin } = useCredits();
const initial = useMemo(() => {
  const source = (displayName || user?.email || "").trim();
  const ch = Array.from(source)[0] ?? "?";
  return ch.toUpperCase();
}, [displayName, user?.email]);
```
Works for Hebrew ("ע") and Latin ("O") alike.

### 3. Replace the two elements (lines 78–88) with one unified card
```tsx
<button
  onClick={() => navigate("/profile?tab=account")}
  className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted transition-colors text-right w-full group"
  title={isAdmin ? "Admin — ללא הגבלה" : planMeta.label}
>
  <span
    aria-hidden
    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted border border-border/60 text-foreground font-semibold text-sm group-hover:border-primary/40 transition-colors"
  >
    {isAdmin ? <InfinityIcon className="w-4 h-4 text-primary" /> : initial}
  </span>
  <span className="flex flex-col min-w-0 flex-1 leading-tight">
    <span className="text-sm font-medium text-foreground truncate">
      {displayName || user?.email || "הפרופיל שלי"}
    </span>
    <span className="text-[11px] text-muted-foreground truncate">
      {isAdmin ? "Admin" : planMeta.label}
    </span>
    <span className="text-[10px] text-muted-foreground/70 mt-0.5">ניהול חשבון</span>
  </span>
</button>
```

The wrapping `<div className="px-2 mt-1"><CreditPill /></div>` block (lines 86–88) is removed entirely — the new card already carries the plan + management affordance.

### 4. Visual notes
- Avatar: 36×36, neutral `bg-muted` with subtle `border-border/60`, no gradients, no color fills — refined and secondary.
- Hover only nudges the avatar border to a soft primary tint — no scale, no glow.
- RTL preserved via the parent `direction: rtl` on `<aside>`; `text-right` keeps text alignment correct.
- Admin sees `InfinityIcon` in primary color inside the same neutral circle — preserves visual rhythm.

## Files modified
- `src/components/AppSidebar.tsx` — swap header, remove CreditPill from sidebar.

## Files intentionally untouched
- `src/components/CreditPill.tsx`, `src/pages/Profile.tsx`.

## Expected outcome
- Sidebar top shows a clean initial-in-circle avatar (e.g. "O" for Ofek), the user's name, the plan name (e.g. "Pro חודשי"), and a quiet "ניהול חשבון" line — all in one tappable card opening the account page.
- No 👤 emoji anywhere in the sidebar.
- No numeric credit balance in the main shell (previous refinement preserved).

