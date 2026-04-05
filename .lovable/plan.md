

# Fix: Word.run exists but Rich API bridge not connected in Word Online

## Problem

`Word.run` exists as a function stub in the Office.js library, but the underlying bridge (`executeRichApiRequestAsync`) is not wired up by the Word Online host. This means checking `!!Word.run` is **not a reliable readiness signal** — it's always true once Office.js loads, even before the document context is actually connected.

Both `hasDocumentAccess` (in useOffice) and `ensureOfficeReady` (in wordInsertion) currently trust `Word.run` existence as proof of readiness. This causes premature insertion attempts that fail with the RichAPI error.

## Solution

Replace passive existence checks (`!!Word.run`) with an **active probe** — actually call `Word.run` with a no-op to verify the bridge is functional.

## Changes

### 1. `src/hooks/useOffice.tsx`

- Change `checkDocumentAccess` to NOT count `Word.run` existence alone
- Only trust `Office.context.document` for passive checks
- Add an async probe function that actually calls `Word.run(() => context.sync())` in a try/catch
- Run this probe during polling; only set `hasDocumentAccess = true` when it succeeds
- Extend polling timeout to 15s (Word Online is slow)

### 2. `src/lib/wordInsertion.ts`

- In `ensureOfficeReady`, stop treating `Word.run` existence as "ready" (line 116-118)
- Poll for `Office.context.document` only; treat `Word.run` as a path to try but not a readiness guarantee
- In the insertion flow, if `Word.run` fails with `executeRichApiRequestAsync`, skip remaining retries and fall through to Common API immediately
- If Common API (`Office.context.document`) is also unavailable, show a specific message: "Word document is still loading — please wait a moment and try again"

### Key logic

```
// Active probe instead of passive check
async function probeWordRun(): Promise<boolean> {
  try {
    await Word.run(async (ctx) => { await ctx.sync(); });
    return true;
  } catch {
    return false;
  }
}

// In insertion: detect bridge error and skip retries
catch (e) {
  if (e.message.includes('executeRichApiRequestAsync')) {
    // Bridge not ready — don't retry Word.run, fall to Common API
    break;
  }
}
```

## Files
| File | Change |
|------|--------|
| `src/hooks/useOffice.tsx` | Active probe for document access instead of `!!Word.run` |
| `src/lib/wordInsertion.ts` | Skip Word.run retries on bridge errors; better fallback + messaging |

