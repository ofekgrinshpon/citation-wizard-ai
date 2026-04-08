

# Plan: Move DOCX Text Extraction to Apify Actor + Update Edge Function

## Summary
The DOCX extraction code works — the download is what fails. Move the download step to the Apify actor (real browser), send extracted text as `page_text` in the dataset, and update the edge function to use it.

## Changes

### 1. Update `apify-ingest-cases` edge function
- Check for `page_text` field first before attempting any DOCX download
- Use `page_text` as the document content when available
- Keep DOCX fetch as a fallback (unlikely to work, but harmless)

### 2. Provide Apify actor code snippet (for you to paste into your actor on apify.com)
Node.js code to add inside your actor's `requestHandler`:
- Download DOCX using Playwright's browser context (`page.context().request.get(docxUrl)`)
- Unzip with `adm-zip` (add to actor's `package.json`)
- Parse `word/document.xml`, extract text from `<w:t>` tags
- Save as `page_text` field in the dataset item

### 3. Delete existing partial_failure records
- SQL migration to clean up the 97 failed caselaw records so they can be re-ingested with full text

