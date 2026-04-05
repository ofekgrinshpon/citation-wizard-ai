

# Fix: "Word API is not available" Error

## Root Cause

The `insertCitationAsFootnote` function checks for two things:
1. `Word?.run` — not available in Word Online
2. `Office?.context?.document?.setSelectedDataAsync` — should be available but may not be populated yet

The error "Word API is not available" means **both** checks fail. This happens because in Word Online's iframe environment, `Office.context.document` may not be fully initialized at the time the button is clicked, even though `Office` itself exists. The current code doesn't wait for Office readiness before attempting insertion.

## Fix

### 1. Add Office readiness gate to `insertCitationAsFootnote` (`src/lib/wordInsertion.ts`)

Before attempting insertion, wait for `Office.onReady` to complete (with a short timeout). This ensures `Office.context.document` is populated.

```text
Current flow:
  Click → check Word.run → check Office.context.document → both fail → throw

Fixed flow:
  Click → wait for Office.onReady (max 3s) → check Word.run → check Office.context.document → insert
```

Changes:
- Add a helper `ensureOfficeReady()` that returns a promise resolving when `Office.onReady` fires (or rejects after timeout)
- Call it at the start of `insertCitationAsFootnote` before checking APIs
- Add diagnostic `console.log` showing what APIs are available after readiness, so future debugging is easier

### 2. Broaden Common API detection

Also check for `Office.context.document.getSelectedDataAsync` as an alternative signal that the document API is available — some Word Online builds expose methods differently.

## Files

| Action | File |
|--------|------|
| Modify | `src/lib/wordInsertion.ts` — add `ensureOfficeReady()` gate + broader API detection |

