

# Fix: Word Desktop falling back to clipboard instead of inserting footnotes

## Problem

On Word Desktop, the insertion falls through to "manual-copy" (clipboard) instead of actually inserting footnotes. The root cause is in the capability detection flow:

1. `waitForOfficeInit` waits only 3 seconds — may not be enough on Desktop
2. `detectCapabilities` does an active `Word.run` probe — if this fails transiently, `bridgeConnected` stays `false`
3. The insertion code **only** attempts Rich API if `bridgeConnected === true` (line 233)
4. If the probe fails, it skips Rich API entirely and also skips Common API (since `hasSetSelectedData` may also be false at that point)
5. Result: straight to clipboard copy, even though Word Desktop fully supports footnote insertion

## Solution

Make the insertion flow less conservative — try `Word.run` insertion even if the probe failed, since the probe is just a quick health check and the actual insertion call may succeed (Word Desktop may need the full context of an insertion operation to work).

## Changes — `src/lib/wordInsertion.ts` only

1. **Try Rich API whenever `hasWordRun` is true**, not only when `bridgeConnected` is true. The `tryRichApi` function already has its own error handling and will return `null` if it genuinely fails.

2. **Increase `waitForOfficeInit` timeout** from 3s to 5s — Word Desktop can be slow to fully initialize the bridge.

3. **Add a retry with delay to `tryRichApi`** — if the first attempt fails with a non-bridge error, wait 2 seconds and try once more. Bridge errors (`executeRichApiRequestAsync`) still skip immediately.

### Key logic change

```
Before:
  if (caps.bridgeConnected) → tryRichApi    // skipped if probe failed
  if (caps.hasSetSelectedData) → tryCommonApi
  → manual-copy

After:
  if (caps.hasWordRun) → tryRichApi          // always try if Word.run exists
  if (caps.hasSetSelectedData) → tryCommonApi
  → manual-copy
```

This means:
- **Word Desktop**: Will attempt Rich API insertion (footnotes) even if the probe was inconclusive
- **Word Online**: Will still skip Rich API quickly on bridge error and fall to Common API or clipboard
- No other files need changes — the `InsertionResult` type and UI handling remain the same

