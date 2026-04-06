

# Enable Perplexity searches in batch footnote mode

## Problem
The batch footnote builder sends all sources as a single combined prompt to the `citation-chat` edge function. The edge function only triggers Perplexity searches (for case law and legislation) when it detects a `[סיווג אוטומטי: ...]` classification tag in the user input. Since the batch prompt doesn't include these tags, Perplexity searches never run for batch-generated footnotes.

## Solution
Change the batch footnote builder to process each source individually (one API call per source) instead of sending them all in one combined prompt. Each individual call will include the `[סיווג אוטומטי: ...]` tag, which will trigger Perplexity searches just like the chat mode does. After all individual citations are generated, apply the repeat-citation rules (שם / לעיל ה"ש) client-side as it already does today.

## Changes

### `src/components/BatchFootnoteBuilder.tsx` — `processAllCells`

Replace the current "send all sources in one prompt" approach with:

1. For each active cell, send an individual request to `citation-chat` with the same format used by the chat mode:
   - Normalize abbreviations and detect source type
   - Prepend the `[סיווג אוטומטי: ...]` tag
   - Append the citation engine hint (same as the chat mode does)
   - Send as a single-message conversation

2. Process all cells in parallel (using `Promise.allSettled`) for speed, with individual error handling per cell.

3. After all responses return, apply the existing `applyRepeatCitationRules` logic on the collected outputs to handle שם/לעיל cross-references.

4. Keep existing bibliography sync, citation history logging, and verified source persistence unchanged.

### Key detail: the repeat-citation prompt
The current batch prompt includes detailed instructions for repeat citations (שם, לעיל ה"ש). Since each source will now be processed individually, the LLM won't see the other sources. The client-side `applyRepeatCitationRules` function (already in this file) will handle cross-references after all citations are collected — this is the same function already used post-processing today.

## Files

| File | Change |
|------|--------|
| `src/components/BatchFootnoteBuilder.tsx` | Refactor `processAllCells` to send individual requests per cell instead of one combined prompt |

No edge function changes needed — the existing search logic will work once it receives properly tagged individual requests.

