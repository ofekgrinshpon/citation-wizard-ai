

# Batch verification and "verify" button for pending sources in admin panel

## Overview
Two features requested:
1. **Batch operations** in both the citation history tables (SourceCategoryView) and the verified sources table (VerifiedSourcesTable) — select multiple rows and verify/remove them together.
2. **"Verify" button** for pending sources in the VerifiedSourcesTable — currently only "edit" and "remove" exist; pending sources need a quick one-click verify action.

## Changes

### 1. `src/components/admin/SourceCategoryView.tsx`
- Add a checkbox column (header = select-all, per-row = individual select)
- Track `selectedIds` state
- Add a floating action bar when selection is non-empty: "אמת X מקורות" / "בטל אימות X מקורות" buttons
- Call a new `onBulkVerify` prop that receives an array of citation IDs
- Keep existing single-row "אמת" button as-is

### 2. `src/components/admin/VerifiedSourcesTable.tsx`
- Add a checkbox column for multi-select
- Track `selectedIds` state
- For rows with `verification_status === "pending"`: show a "אמת ✓" button in the actions column (next to edit/remove)
- Add a floating action bar when selection is non-empty: "אמת X מקורות" (sets status to verified) and "הסר X מקורות" (bulk remove)
- Call new `onBulkVerify` and `onBulkRemove` props

### 3. `src/pages/Admin.tsx`
- Add `bulkToggleVerification(citations: CitationRecord[])` — loops through and calls the same logic as `toggleVerification` for each, then refreshes once
- Add `bulkVerifyVerifiedSources(sourceIds: string[])` — updates `verification_status` to "verified" for all selected IDs in one query
- Add `bulkRemoveVerifiedSources(sourceIds: string[])` — deletes all selected IDs in one query
- Pass these as props to the respective components

## Technical details

Bulk status update for verified sources:
```typescript
await supabase
  .from("verified_sources")
  .update({ verification_status: "verified" })
  .in("id", selectedIds);
```

Bulk delete:
```typescript
await supabase
  .from("verified_sources")
  .delete()
  .in("id", selectedIds);
```

Both operations are allowed by the existing admin RLS policy (`Admins can manage verified sources` — ALL command).

| File | Change |
|------|--------|
| `src/components/admin/SourceCategoryView.tsx` | Add checkboxes, select-all, bulk action bar |
| `src/components/admin/VerifiedSourcesTable.tsx` | Add checkboxes, select-all, bulk action bar, per-row "אמת" button for pending sources |
| `src/pages/Admin.tsx` | Add bulk verify/remove handler functions, pass as props |

