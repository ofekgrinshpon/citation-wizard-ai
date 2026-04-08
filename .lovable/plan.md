

# Add Multi-File Upload to Knowledge Base Ingestion

## Current State
The file upload mode already supports PDF (via pdfjs-dist), DOCX (via mammoth), and TXT extraction — but only one file at a time.

## Changes

### `src/components/admin/LegalDocumentIngestion.tsx`
- Change `<input type="file">` to accept `multiple`
- Replace single `selectedFile` state with a `fileQueue: Array<{file, title, content, status, sourceType, citation, year}>` state
- On file selection, extract text from all files in parallel (with a progress indicator per file)
- Show a list/table of queued files with: filename, size, extraction status, source type selector, title (editable, pre-filled from filename), citation field
- Add a "📤 העלה הכל" (Upload All) button that processes each file sequentially through `embed-legal-source`
- Show per-file progress: pending → extracting → ready → uploading → done/error
- Keep the drag-and-drop zone (update label to "בחרו קבצים" plural)
- Allow removing individual files from the queue before upload

### UX Flow
1. User selects multiple files (or drops them)
2. Text is extracted from each file client-side (PDF/DOCX/TXT)
3. User reviews the list, adjusts source types/titles/citations per file
4. User clicks "Upload All" → sequential processing with progress
5. Summary toast: "X succeeded, Y failed"

### No backend changes needed
The existing `embed-legal-source` edge function handles one document at a time; the client will call it in a loop.

