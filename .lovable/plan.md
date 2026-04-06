

# User-facing Verified Sources page (subscribers only)

## Overview
Add a read-only "מקורות מאומתים" page where subscribed users can browse verified sources by category, search, and copy citations. Non-subscribers see a paywall message. No editing or pending sources shown.

## Changes

| File | Change |
|------|--------|
| `src/pages/VerifiedSources.tsx` | **New file.** Fetch from `verified_sources` where `verification_status = 'verified'`. Category tabs, search bar, read-only table with HoverCard + RenderCitation for full citations. Copy button per row using `copyPlainText`. Gate access: if `!isSubscribed && !isAdmin`, show upgrade prompt instead of the table. |
| `src/App.tsx` | Add route: `<Route path="/verified-sources" element={<VerifiedSources />} />` |
| `src/components/AppSidebar.tsx` | Add "📚 מקורות מאומתים" link below projects section. Only visible when `isSubscribed || isAdmin`. Navigates to `/verified-sources`. |

## Access control
- Uses `useSubscription()` hook — only `isSubscribed` or `isAdmin` users see the sidebar link and page content
- Non-subscribers who navigate directly to `/verified-sources` see a message prompting them to subscribe
- No database changes needed — existing RLS policy `Anyone can read verified sources` (SELECT for public) already allows read access
- Query filters to `verification_status = 'verified'` only — pending/invalid sources are never shown

## Page structure
- RTL layout matching admin panel style
- Category tabs: פסיקה, חקיקה ראשית, חקיקת משנה, ספרות ומאמרים, אחר
- Search input filtering by source name or citation text
- Table columns: שם מקור, קטגוריה, ציטוט מלא (with HoverCard), העתק (copy button)
- No edit, delete, or verify actions

