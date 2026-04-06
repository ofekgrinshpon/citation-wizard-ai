

# Fix: Perplexity case law search is blocked by false-positive verified source matches

## Problem

The Perplexity search **never runs** because of a logic bug in the guard condition on line 476:

```typescript
if (isCaseLaw && caseNumberMatch && !hasVerifiedCandidates) {
```

`hasVerifiedCandidates` is set to `true` on line 438 whenever ANY rows come back from the `verified_sources` table -- even if they're completely irrelevant to the case. The tokenized search for "רע״א 5768/94" extracts terms like "5768", "94" and searches broadly with `ilike`. If any verified source contains these numbers (even a law from 1994), it sets `hasVerifiedCandidates = true`, which skips the Perplexity search entirely.

Result: the AI generates the citation with zero case data, producing `[חסר:...]` placeholders for everything.

## Solution

Two changes in `supabase/functions/citation-chat/index.ts`:

### Change 1: Don't let irrelevant verified sources block case law search
Move the `hasVerifiedCandidates = true` assignment to AFTER the ranking/filtering step, so it's only set when there are actually relevant matches (score >= 0). Currently it's set on line 438 before any relevance check.

### Change 2: For case law, always run Perplexity search
Remove the `!hasVerifiedCandidates` guard from the case law search condition entirely. Case law data (party names, dates, court) is fundamentally different from what verified sources provide (pre-formatted citations). The Perplexity search should always run for case law, and its results can supplement or override verified source hints.

The updated condition on line 476 becomes:
```typescript
if (isCaseLaw && caseNumberMatch) {
```

### Change 3: Add debug logging
Add `console.log` statements before key decision points so future issues are diagnosable from logs.

## Files to modify

| File | Change |
|------|--------|
| `supabase/functions/citation-chat/index.ts` | Remove `!hasVerifiedCandidates` guard from Perplexity search; move `hasVerifiedCandidates` assignment after ranking; add debug logs |

This is a 3-line fix. After this, every case law query will trigger a Perplexity web search for real case metadata.

