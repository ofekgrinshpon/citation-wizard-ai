

# Fix: Published case law incorrectly validated as database case law

## Problem

When searching for `רע"פ 9142/01`, the client-side `detectSourceType` classifies it as `case_law_database` because the user input doesn't contain `פ"ד`. However, the Perplexity search discovers it IS published in פ"ד נז(6) 793. The AI correctly formats it as published case law (Rule 18), but the post-response validation still runs against `case_law_database` (Rule 19), which demands a database name and full date -- producing a false "missing 2 mandatory components" warning.

This also explains the inconsistency: sometimes the AI output format varies slightly, causing different validation results for the same case.

## Solution

**File: `src/pages/Index.tsx`** (around line 650-664)

After receiving the AI response, re-detect the source type from the **output** when the original type is case law. If the AI response contains `פ"ד` (indicating published case law), upgrade the source type from `case_law_database` to `case_law_published` before running validation.

### Specific change

After `const reply = await callAPI(...)` and before `const validation = validateAIResponse(...)`, add logic:

```typescript
// If originally classified as database case law, but AI found it's published (contains פ"ד),
// re-classify to case_law_published for correct validation
let effectiveSourceType = sourceType as SourceType;
if (effectiveSourceType === "case_law_database" && /פ["״]ד\s+[א-ת]+/.test(reply)) {
  effectiveSourceType = "case_law_published";
}
```

Then use `effectiveSourceType` instead of `sourceType` in `validateAIResponse`, `getMissingFieldsSummary`, `setMessageSourceTypes`, and the history save.

## Files to modify

| File | Change |
|------|--------|
| `src/pages/Index.tsx` | Re-classify source type from AI output before validation; use effective type for validation and display |

