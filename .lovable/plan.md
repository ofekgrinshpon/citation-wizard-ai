## Problem
The composer is floating in the middle because its wrapper sits inside a `overflow-y-auto` scroll container. `flex-1` doesn't stretch in a non-flex parent, so `mt-auto` on the composer has no room to push it down.

## Change

**`src/components/LegalQAChat.tsx` (line 2936)**

Swap the research-mode wrapper so it always fills at least the scroll area's height:

- From: `<div className="flex-1 min-h-0 flex flex-col py-4">`
- To: `<div className="min-h-full flex flex-col py-4">`

With `min-h-full`, the wrapper stretches to the full height of the scroll container; the panel's existing `h-full flex flex-col` + composer `mt-auto` then dock the composer at the bottom.

## Out of scope
No edits to LegalResearchV1Panel, no other modes, no design tokens.
