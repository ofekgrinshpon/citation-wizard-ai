

# Fix: Verified sources not found in batch mode due to engine hint in search term

## Root Cause
When the batch footnote builder sends a request to `citation-chat`, it prepends the full engine hint text to the user's input:

```
[סיווג אוטומטי: חוק יסוד]

══ מנוע אזכור (כלל 4 – חוק יסוד) ══
תבנית: חוק-יסוד: {lawName}...
(~20 lines of rules)
══════════════════════════════════
חוק יסוד הכנסת
```

The edge function strips only the `[סיווג אוטומטי: ...]` tag (line 416), leaving the entire engine hint in `searchTerm`. The `scoreVerifiedMatch` function then tokenizes this massive text into dozens of words and requires ALL of them to appear in the candidate — which always fails. Result: `ranked=0, hasVerifiedCandidates=false`.

In chat mode this works because the user input is just the source name without engine hints (engine hints are added separately by the chat UI after the verified source check).

## Fix
In `supabase/functions/citation-chat/index.ts`, strip the engine hint block from `searchTerm` before doing the verified source lookup. The engine hint is always wrapped in `══...══` delimiters, so we can strip everything between the first `══` marker and the last `══` marker, keeping only the actual user query that follows.

### Changes

| File | Change |
|------|--------|
| `supabase/functions/citation-chat/index.ts` | After stripping `[סיווג אוטומטי: ...]`, also strip the `══ מנוע אזכור...══` engine hint block from `searchTerm` so only the actual source name remains for the verified source lookup |

### Implementation detail
Add a regex after line 416 to strip the engine hint:

```typescript
const searchTerm = userInput
  .replace(/\[סיווג אוטומטי:.*?\]\n?/, "")
  .replace(/══[\s\S]*══+\s*/g, "")  // Strip engine hint blocks
  .trim();
```

This ensures the search term for "חוק יסוד הכנסת" is just `חוק יסוד הכנסת` — which will match the verified source `חוק-יסוד: הכנסת` and return its stored `full_citation` directly (line 456), bypassing Perplexity entirely.

