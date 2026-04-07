

# Fix Book Search — Engine Hint Block Not Stripped

## Problem
The Perplexity book search is sending the entire engine hint block as the search query instead of just the book name. The log confirms:
```
[book] Searching Perplexity for: ══ מנוע אזכור (כלל 23 – ספרים) ══ ...
```

The regex `.replace(/\n══ מנוע אזכור[\s\S]*?══════════════════════════════════\n?/m, "")` requires a `\n` before `══`, but after stripping the classification tag, the engine hint starts at position 0 — no newline prefix.

## Fix
In `supabase/functions/citation-chat/index.ts` line 854, change the regex to make the leading `\n` optional:

```typescript
// Before
.replace(/\n══ מנוע אזכור[\s\S]*?══════════════════════════════════\n?/m, "")

// After
.replace(/\n?══ מנוע אזכור[\s\S]*?══════════════════════════════════\n?/m, "")
```

This same issue likely affects the legislation and regulation search blocks (lines 696, 781) — apply the same `\n?` fix there for consistency, even though those currently work because their engine hint block positioning differs.

## Files modified
| File | Change |
|------|--------|
| `supabase/functions/citation-chat/index.ts` | Make leading `\n` optional in engine-hint-stripping regex on lines 854, 696, 781 |

After the fix, deploy the edge function and re-test with "אוריאל פרוקצ'יה דיני חברות חדשים בישראל".

