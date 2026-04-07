

# Add Knowledge Base Document Summary to Admin Panel

## Overview
Add a summary panel in the Admin "Knowledge Base" tab showing how many documents have been ingested, broken down by source type, with a list of recent documents.

## Changes

### 1. `src/pages/Admin.tsx`
- Fetch `legal_documents` data alongside existing queries in `fetchData()` (count by source_type, recent entries)
- Store in new state: `legalDocs`
- Pass to `LegalDocumentIngestion` or render summary cards directly in the knowledge tab above the ingestion component

### 2. Knowledge tab section (in `Admin.tsx`, the `activeTab === "knowledge"` block)
Add before the `LegalDocumentIngestion` component:
- **Summary stats row**: StatCard grid showing total documents, total chunks, and count per source type (legislation, caselaw, book, article, notebook, international)
- **Recent documents list**: A table/list of the last ~20 ingested documents showing: title, source type (with emoji), citation (truncated), chunk count, and date added
- Each row is read-only (no edit/delete needed here, that's managed elsewhere)

### 3. Data fetching
Add to the existing `fetchData()` parallel queries:
- `supabase.from("legal_documents").select("id, title, source_type, citation, created_at").order("created_at", { ascending: false }).limit(50)`
- `supabase.from("legal_document_chunks").select("id", { count: "exact", head: true })` for total chunk count

### 4. Display format
- StatCards: 📚 Total Documents | 🧩 Total Chunks | per-type breakdown
- Document list: simple table with columns: סוג | כותרת | אזכור | תאריך הוספה
- Source type displayed with matching emoji from SOURCE_TYPES

