

## Fix: Show Real Document Counts in Admin Dashboard

### Problem
The dashboard fetches `legal_documents` with `.limit(50)` (line 76) and then uses `legalDocs.length` for all stat cards. So "סה״כ מסמכים" shows 50 instead of the real number (~6,185). The type breakdown (פסיקה, מחברות) is also wrong because it counts from the same 50 items.

### Changes

**`src/pages/Admin.tsx`**

1. Add new state variables for real counts:
   - `totalDocsCount` (number) — total documents in DB
   - `docTypeCounts` (Record<string, number>) — count per source_type

2. In `fetchData()`, add two new parallel queries:
   - `supabase.from("legal_documents").select("id", { count: "exact", head: true })` → total count
   - `supabase.rpc(...)` or separate count queries per source_type — but since Supabase JS doesn't support GROUP BY, we'll fetch all `source_type` values (lightweight: just one column) and count client-side:
     ```
     supabase.from("legal_documents").select("source_type")
     ```
     This returns all rows but only the `source_type` column (tiny payload). We count occurrences client-side.

3. Keep the existing `.limit(50)` query for the "recent documents" table (unchanged).

4. Update the stat cards section (line 582) to use `totalDocsCount` instead of `legalDocs.length`, and `docTypeCounts` instead of counting from the limited array.

5. Add a refresh button next to the document count so it can be updated after ingestion without reloading.

### Result
- "סה״כ מסמכים" will show the real number (e.g., 6,185)
- Type breakdown will show real counts (e.g., פסיקה: 97, מחברות: 20)
- The "recent documents" table still shows the latest 50 for quick browsing

