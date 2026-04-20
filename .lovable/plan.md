

## Goal
Make the main app shell feel like a professional legal workspace by removing the prominent numeric credit balance from the sidebar. Show only the plan name with a subtle "ניהול חשבון" link. The Profile → ניהול חשבון tab keeps all transparent credit details exactly as today.

## Scope
- **Change**: sidebar pill only.
- **Do NOT touch**: Profile account tab (already correct), `useCredits` hook, ledger, refund/consume logic, plans config, `InsufficientCreditsDialog`.

## Changes

### 1. Replace `CreditPill` content — `src/components/CreditPill.tsx`
Same component, same export, same `onClick` (still navigates to `/profile?tab=account`), same RTL alignment — only the visible content changes.

New layout (one line, two stacked tiny labels on the right side of the pill):
```
[plan badge]   ניהול חשבון
   Pro
```
- **Primary line**: `planMeta.label` (e.g. "Pro חודשי", "Basic", "Pro סמסטריאלי"). For admins → "Admin · ללא הגבלה" with the existing `InfinityIcon`.
- **Secondary line**: muted, very small — `ניהול חשבון`.
- **Removed**: the `{totalCreditsAvailable} קרדיטים` numeric label, the colored `ringColor` ratio indicator (low/medium/high), and the `planMeta.shortLabel` chip.
- **Kept**: subtle border + hover, `Coins` icon for paid users (neutral muted color, no ratio coloring), `InfinityIcon` for admins.
- **Tooltip (`title`)**: keep the detailed breakdown so a hover still shows the exact numbers for users who want them — this preserves "easy path to inspect" without dominating the UI.

Visual: rounded-full pill, `border border-border bg-card`, neutral muted icon, no warning/destructive colors leaking to the main shell.

### 2. Sidebar — `src/components/AppSidebar.tsx`
No structural change. The existing `<CreditPill className="w-full justify-between" />` slot stays where it is so users still have a single-tap path to the account page. Only the inner content quiets down via the change above.

### 3. Profile page — `src/pages/Profile.tsx`
No changes. The `account` tab already shows: included remaining/total, top-up balance, total available, renewal date, top-up packs, and full `credit_ledger` history. This remains the single source of truth for usage transparency.

## Files modified
- `src/components/CreditPill.tsx` — content rewrite (plan name + "ניהול חשבון", no number).

## Files intentionally untouched
- `src/components/AppSidebar.tsx`, `src/pages/Profile.tsx`, `src/hooks/useCredits.tsx`, `src/lib/plans.ts`, `src/components/InsufficientCreditsDialog.tsx`, all credit consume/refund logic.

## Expected outcome
- Sidebar shows: plan name (e.g. "Pro חודשי") with a small muted "ניהול חשבון" beneath — no "244 קרדיטים" anywhere on the main screen.
- Hovering the pill still surfaces the exact numbers as a native tooltip for power users.
- Clicking the pill opens `/profile?tab=account` where the full meter, balances, renewal date, top-up packs, and ledger history remain unchanged.
- Admin users see "Admin · ללא הגבלה" instead of an infinity-with-number readout.

