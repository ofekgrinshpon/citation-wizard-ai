

# Fix `.doc` File Upload — Mammoth Only Supports `.docx`

## Problem
The `mammoth` library only supports `.docx` (ZIP-based XML format). Old `.doc` files use the binary OLE2 format, which mammoth cannot read — hence the "Can't find end of central directory" ZIP error.

## Solution
Install `word-extractor`, a library that handles legacy `.doc` (OLE2) files client-side.

## Changes

### `package.json`
- Add `word-extractor` dependency

### `src/components/admin/LegalDocumentIngestion.tsx`
- Split extraction logic:
  - `.docx` → continue using `mammoth`
  - `.doc` → use `word-extractor` (`WordExtractor.extract(arrayBuffer)` → `document.getBody()`)
- Update `extractText` switch:
  ```
  if (ext === "docx") return extractTextFromDocx(file);
  if (ext === "doc")  return extractTextFromDoc(file);  // new function using word-extractor
  ```

This is a small change — add one dependency, one new extraction function, and update the extension check.

