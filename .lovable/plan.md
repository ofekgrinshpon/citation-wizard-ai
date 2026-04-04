

# Subscription Model & Remove Guest Mode

## Overview
Remove guest access entirely, add subscription tracking to the database, enforce usage limits for non-subscribers, and provide admin controls for managing subscriptions.

## 1. Database Migration

Add two columns to `profiles`:
- `is_subscribed BOOLEAN NOT NULL DEFAULT false`
- `citation_count INTEGER NOT NULL DEFAULT 0`

Add an RLS policy so only admins can update `is_subscribed` on any profile (regular users can still update their own `full_name` but not `is_subscribed`).

## 2. Remove Guest Mode

**Files affected:** `src/pages/Landing.tsx`, `src/pages/Index.tsx`, `src/hooks/useGuestLimit.tsx`, `src/components/GuestLimitModal.tsx`

- Delete the "כניסה כאורח/ת" button and card from `Landing.tsx`
- Remove `handleGuest` function
- In `Index.tsx`: redirect unauthenticated users to `/` instead of allowing guest mode
- Remove all `isGuestMode` / `isGuest` logic, `useGuestLimit` usage, and `GuestLimitModal` import
- Remove `BatchFootnoteBuilder`'s `isGuest` / `guestLimit` props (no longer needed)
- Delete `useGuestLimit.tsx` and `GuestLimitModal.tsx`

## 3. Subscription Hook: `useSubscription`

**New file:** `src/hooks/useSubscription.tsx`

- Fetches `is_subscribed` and `citation_count` from `profiles` for the current user
- Exposes: `isSubscribed`, `citationCount`, `isLimitReached` (count >= 3 && !isSubscribed), `incrementCount()`, `refresh()`
- `incrementCount` calls an RPC or direct update to increment `citation_count` by 1

## 4. Enforce Usage Limits in Index.tsx

- After each successful citation (freetext, batch, bibliography), call `incrementCount()`
- When `isLimitReached` is true:
  - Disable the send button and batch/bibliography generate buttons
  - Show a banner: "הגעת למכסה המרבית. שדרג/י למנוי Pro" with a link to the account management section in Profile

## 5. UI Changes

### Profile Badge (AppSidebar)
- Next to the user's name, show a badge:
  - Green "מנוי" if `is_subscribed === true`
  - Red "לא מנוי" if `is_subscribed === false`
- Clicking the badge navigates to `/profile?tab=account`

### Profile Page — New "ניהול חשבון" Tab
- Add a new tab in `Profile.tsx`
- Shows: subscription status, citation count used, remaining (if not subscribed)
- "שדרג ל-Pro" placeholder button (no payment integration yet, shows toast "בקרוב!")

## 6. Admin Controls

### Admin Users Tab Enhancement
- Add a search input to filter users by email/name
- Add a toggle switch per user row to set `is_subscribed`
- Toggle calls `supabase.from("profiles").update({ is_subscribed }).eq("id", userId)` (admin RLS policy allows this)

**Files modified:** `src/components/admin/UsersTable.tsx`, `src/pages/Admin.tsx`

## 7. Add-in Compatibility
- The subscription badge and limit banner use existing responsive patterns
- Already no guest mode in add-in (existing redirect). Now all paths require auth consistently.

## Files Summary

| Action | File |
|--------|------|
| Create | `src/hooks/useSubscription.tsx` |
| Modify | `src/pages/Landing.tsx` |
| Modify | `src/pages/Index.tsx` |
| Modify | `src/pages/Profile.tsx` |
| Modify | `src/pages/Admin.tsx` |
| Modify | `src/components/AppSidebar.tsx` |
| Modify | `src/components/admin/UsersTable.tsx` |
| Modify | `src/components/BatchFootnoteBuilder.tsx` |
| Modify | `src/components/BibliographyGenerator.tsx` |
| Delete | `src/hooks/useGuestLimit.tsx` |
| Delete | `src/components/GuestLimitModal.tsx` |
| Migration | Add `is_subscribed`, `citation_count` to `profiles`; admin update policy |

