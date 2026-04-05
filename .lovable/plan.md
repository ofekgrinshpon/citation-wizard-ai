

# Fix: Office.context.document still undefined after Office.onReady

## Problem

The static Office.js script tag is already in place and `Office.onReady` fires successfully, but `Office.context.document` remains undefined. This is a known Word Online timing issue where the document context is populated **after** `onReady` resolves.

## Solution — Two changes in `src/lib/wordInsertion.ts`

### 1. Poll for `Office.context.document` after onReady

The current `ensureOfficeReady` waits for `onReady` but doesn't verify the document context is actually populated. Add a polling loop (up to 5 seconds, checking every 200ms) that waits for `Office.context.document` to become available after `onReady` resolves.

### 2. Try `Word.run` even when `Office.context.document` is missing

In Word Online, `Word.run` (the Rich API) creates its own execution context and may work even when `Office.context.document` is undefined. The current code already tries `Word.run` first, but the `Word` global might not be checked correctly. Add a more aggressive retry: if the initial `Word.run` attempt fails and `Office.context.document` is still null, wait briefly and retry `Word.run` once more.

## File

| File | Change |
|------|--------|
| `src/lib/wordInsertion.ts` | Enhance `ensureOfficeReady` with document polling; add `Word.run` retry logic |

