

# Fix: "Connecting to Word..." blocks forever

## Problem

In Word Online, neither `Office.context.document` nor the `Word.run` bridge become available within the 15s polling window. After timeout, `hasDocumentAccess` stays `false` permanently, so the UI is stuck showing "Connecting to Word..." with disabled buttons. The user can never even attempt insertion.

## Root cause

The current approach gates the UI on a readiness check that Word Online may never pass. But the insertion function (`insertCitationAsFootnote`) already has its own retry logic, fallbacks, and error messages. Blocking the UI permanently is worse than letting the user try and getting a specific error.

## Solution

After the 15s timeout, if we're in add-in mode, force `hasDocumentAccess = true` so buttons become enabled. The insertion function will handle failures with actionable error messages. Additionally, the Common API path (`setSelectedDataAsync`) may work even when the probe fails, so we should give it a chance.

## Changes

### `src/hooks/useOffice.tsx`
- In the 15s timeout handler: if `isOfficeAddin` is true, set `hasDocumentAccess = true` as a last resort so the UI unblocks
- This lets the insertion function's own error handling take over instead of a permanent UI block

### `src/lib/wordInsertion.ts`  
- In `ensureOfficeReady`: after polling for `Office.context.document` times out, also try the active `Word.run` probe as a last check before giving up
- In the Common API fallback section: attempt `setSelectedDataAsync` even without checking `doc` existence first — wrap in try/catch and let it fail gracefully
- Improve the final error message to say "please wait a moment and try again" instead of a technical dump

## Files
| File | Change |
|------|--------|
| `src/hooks/useOffice.tsx` | Force `hasDocumentAccess = true` after timeout in addin mode |
| `src/lib/wordInsertion.ts` | Try Common API more aggressively; better final error message |

