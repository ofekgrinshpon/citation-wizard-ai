

# Add Publication Integrity verification to batch footnote mode

## Problem
The batch footnote builder bypasses the Publication Integrity Card that exists in chat mode. Per Rule 2.5, if the original publication of a law (especially early Basic Laws like חוק-יסוד: הכנסת, התשי"ח–1958) doesn't include a Gregorian year, it should be omitted from the citation. Currently:

1. Perplexity returns a Gregorian year (e.g., 1958) regardless of whether it appeared in the original publication
2. The AI blindly includes it in the citation
3. The batch builder never shows the Publication Integrity Card, so the user is never asked whether Hebrew/Gregorian years appeared in the original
4. No `verified_sources` lookup is done for year preferences in the batch flow

In chat mode, this is handled by: (a) checking `verified_sources` for stored year preferences, and (b) showing the Publication Integrity Card for new laws.

## Solution
Add the same year-preference logic to the batch footnote builder:

### 1. After each individual citation returns, check `verified_sources` for stored year preferences
- If the source has stored `hasHebrewYear`/`hasGregorianYear` metadata, apply `applyYearPreferences` to strip the unwanted year — same as chat mode does silently for known laws.

### 2. For new legislation not yet in `verified_sources`, queue a Publication Integrity Card
- After all batch citations complete, show the Publication Integrity Card one-by-one for each new legislation source that lacks year preferences.
- Apply the user's choices to the corresponding citation and save to `verified_sources`.

### 3. Extract `applyYearPreferences` to a shared utility
- Currently defined inline in `src/pages/Index.tsx` — move it to a shared location (e.g., `src/lib/citationUtils.ts`) so both Index.tsx and BatchFootnoteBuilder.tsx can use it.

## Changes

| File | Change |
|------|--------|
| `src/lib/citationUtils.ts` | New file: extract `applyYearPreferences` function |
| `src/pages/Index.tsx` | Import `applyYearPreferences` from shared utility instead of defining inline |
| `src/components/BatchFootnoteBuilder.tsx` | After each legislation citation: check `verified_sources` for year prefs, apply them; queue unverified laws for Publication Integrity Card; show cards sequentially after batch completes |

