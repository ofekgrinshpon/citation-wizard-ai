

# Skip Perplexity search when verified source already found

## Problem
When a verified source is found in the database, the edge function correctly returns it immediately for non-pinpoint queries (line 458-461). However, for **case law with pinpoints**, and in cases where the early return doesn't trigger, the Perplexity search still runs unnecessarily (line 486 has no `hasVerifiedCandidates` guard).

The legislation branch (line 635) already has `&& !hasVerifiedCandidates` — but the case law branch (line 486) is missing it.

## Fix

### `supabase/functions/citation-chat/index.ts`

Add `&& !hasVerifiedCandidates` to the case law Perplexity search condition on line 486:

```typescript
// Before:
if (isCaseLaw && caseNumberMatch) {

// After:
if (isCaseLaw && caseNumberMatch && !hasVerifiedCandidates) {
```

This ensures that when a verified source is already matched, neither the case law nor legislation Perplexity searches are triggered — saving API calls and preventing the LLM from receiving conflicting data.

## Files

| File | Change |
|------|--------|
| `supabase/functions/citation-chat/index.ts` | Add `&& !hasVerifiedCandidates` guard to case law search condition (line 486) |

