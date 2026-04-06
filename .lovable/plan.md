

# Strip rule/meta lines from formatted_output before saving to citation_history

## Problem
The raw AI response (including `📐 כלל:`, `⚠️`, `🏷️`, step-by-step explanations) is saved directly to `citation_history.formatted_output` (line 355). The clean extraction function `extractCitationFromResponse` already exists and is used for `verified_sources`, but not for `citation_history`.

## Solution
Use `extractCitationFromResponse(reply)` (already computed as `extractedCitation` on line 352) as the value saved to `formatted_output` instead of the raw `reply`. This applies to all the citation save points in `Index.tsx`.

## Changes

| File | Change |
|------|--------|
| `src/pages/Index.tsx` | On line 355, change `formatted_output: reply` to `formatted_output: extractedCitation \|\| reply` (fallback to raw if extraction yields empty). Apply the same pattern to any other `citation_history.insert` calls in the file (treaty type handler, bill type handler, etc.). |

The `extractCitationFromResponse` function already strips `📐`, `⚠️`, `שלב`, `העוזר המשפטי`, and `מכיוון ש` lines — so the stored citation will be clean. The user's displayed message (`finalReply`) remains unchanged, so they still see warnings and rule references in the chat UI.

