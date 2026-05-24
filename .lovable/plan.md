## Problem
`min-h-full` only sets minimum height, so the panel's `h-full` child resolves to `auto`, and the composer's `mt-auto` has no excess space to absorb. The composer ends up sized to content, mid-screen.

## Change

**`src/components/LegalQAChat.tsx` (line 2936)**

- From: `<div className="min-h-full flex flex-col py-4">`
- To: `<div className="h-full flex flex-col py-4">`

The scroll parent (`flex-1 overflow-y-auto`) already has a resolved flex height, so `h-full` on the wrapper resolves correctly. The panel's `h-full` then fills it and the composer's `mt-auto` docks at the bottom.

## Out of scope
No edits to LegalResearchV1Panel or other modes.
