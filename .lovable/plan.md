

# Fix: Word.run available but insertion silently failing

## Problem

The error state shows `hasWordRun: true` — meaning `Word.run` IS available and IS being attempted, but it's **failing silently**. The `tryWordRun` function catches all errors and returns `null`, then the diagnostic code falls through to an irrelevant "No Office host detected" message because `Office.context.host` happens to be falsy.

The real issue is hidden: `Word.run` throws an error that gets swallowed. We need to surface it.

## Changes

### `src/lib/wordInsertion.ts`

1. **Capture the actual Word.run error** — In `tryWordRun`, store the caught error message instead of discarding it.

2. **Fix the diagnostic logic** — When `Word.run` exists but failed, report the actual failure reason instead of checking `Office.context.host` (which is irrelevant when Word.run is the available path).

3. **Remove the misleading host check from the error path** — The current flow is:
   - Word.run exists → try it → fails silently → falls to diagnostics
   - Diagnostics: "No Office host detected" (wrong — Word.run WAS there)
   
   Fix: if Word.run was tried and failed, show "Word.run failed: [actual error]"

4. **Add a longer retry with delay** — Word Online may need the document context to fully initialize. Add a 2-second wait before the retry (currently 1s), and attempt up to 3 times total.

### Summary of logic change

```
Before: Word.run fails → error swallowed → "No Office host detected"
After:  Word.run fails → error captured → retry with longer waits → 
        if still fails → "Word.run failed: [actual error message]"
```

Only one file changes: `src/lib/wordInsertion.ts`

