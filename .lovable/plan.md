

# Add File Upload to Legal Document Ingestion

## Overview
Add a third ingestion mode — "העלאת קובץ" — that lets admins upload `.txt`, `.csv`, or `.docx`/`.pdf` files from their computer. The file content is extracted client-side and fed into the existing `embed-legal-source` edge function.

## Changes

### 1. `src/components/admin/LegalDocumentIngestion.tsx`
- Add a third tab button: "העלאת קובץ"
- In file upload mode, show:
  - Source type selector (same as single mode)
  - File input accepting `.txt`, `.csv`, `.tsv`, `.pdf`, `.docx`
  - For `.txt` files: read with `FileReader.readAsText()`, use filename as title, prompt user for citation
  - For `.csv`/`.tsv` files: parse rows the same way bulk CSV mode works (type|title|citation|content|url columns), process each row
  - For `.pdf`/`.docx`: extract text client-side using `pdf.js` (PDF) or basic text extraction, then treat like a single `.txt` upload
- Title, citation, and year fields remain editable after file load (pre-filled from filename)
- Show file name and size after selection
- "📤 העלה ועבד" button triggers the same `embed-legal-source` call

### 2. Dependencies
- For PDF text extraction: use `pdfjs-dist` (lightweight, browser-compatible)
- For DOCX: use `mammoth` to extract raw text
- Install both as project dependencies

### 3. UX Flow
- User picks a file → content is extracted and shown in a preview textarea (editable)
- User fills in citation + title if not auto-detected
- User clicks upload → same embedding pipeline runs
- For CSV/TSV files with multiple rows → batch processing with progress indicator (same as current bulk mode)

## Result
Admins can drag-and-drop or browse for legal documents (TXT, CSV, PDF, DOCX) instead of copy-pasting text manually.

