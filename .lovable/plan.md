

# Fix: Apify Ingestion - DOCX Text Extraction Failing

## Problem
All 97 cases from Apify failed with "No extractable text content". The root cause: `mammoth` (DOCX-to-text library) imported via `esm.sh` doesn't work in the Deno edge runtime. PDF extraction is also not implemented. Since the Apify data has no `page_text` or `content` field, every case hits the minimum-content check and fails.

## Solution
Replace the broken `mammoth` approach with a simpler, reliable DOCX text extraction method that works in Deno edge runtime. DOCX files are ZIP archives containing XML — we can extract text directly using Deno-compatible libraries.

## Changes

### 1. Rewrite `extractTextFromDocxUrl` in `apify-ingest-cases/index.ts`
- Remove the `mammoth` dependency (doesn't work in Deno edge runtime)
- Use `fflate` (a lightweight, Deno-compatible ZIP decompression library) to unzip the DOCX
- Parse `word/document.xml` from the ZIP and extract text from XML paragraph tags
- This approach has zero Node.js dependencies and works natively in Deno

### 2. Add better error logging
- Log the specific error reason for each failed case (currently swallowed)
- Log sample of first item's keys to help debug field mapping issues

### 3. Add fallback: store metadata even without full text
- If DOCX extraction fails but we have a title and case_number, insert the document with the title as minimal content and mark as `partial_failure`
- This ensures metadata is preserved and documents can be retried later

## Technical details

**DOCX text extraction approach:**
```text
DOCX file (from URL)
  -> fetch as ArrayBuffer
  -> decompress ZIP with fflate
  -> find word/document.xml
  -> strip XML tags, extract text content
  -> return clean text
```

**Library:** `fflate` via `https://esm.sh/fflate@0.8.2` — proven to work in Deno edge runtime, lightweight (~13KB), handles ZIP decompression.

