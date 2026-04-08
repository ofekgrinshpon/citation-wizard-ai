

# Fix Word Document Upload Support

## Problem
The file upload input accepts `.docx` but not `.doc` (older Word format). If your file is a `.doc` file, it will appear greyed out / unclickable in the file picker dialog.

## Changes

### `src/components/admin/LegalDocumentIngestion.tsx`
1. Add `.doc` to the file input's `accept` attribute: `.txt,.pdf,.doc,.docx,.csv,.tsv`
2. Update the `extractText` function to handle `.doc` files — convert them by reading as ArrayBuffer and passing to mammoth (mammoth supports both `.doc` and `.docx`)
3. Update the helper text to mention "DOC/DOCX"

This is a one-line fix in the accept attribute plus a small addition to the file extension check in `extractText`.

