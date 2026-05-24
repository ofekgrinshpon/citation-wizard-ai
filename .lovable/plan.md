## Goal
Make the מחקר משפטי composer match the אזכור אחיד input: white card background, sticky at the very bottom, no divider line above it.

## Changes

**`src/components/LegalResearchV1Panel.tsx`** (composer block around lines 490–560)

1. Remove the top divider on the composer wrapper so the input floats as a card (matching אזכור אחיד):
   - From: `<div className="mt-auto pt-2 border-t border-border bg-background">`
   - To: `<div className="mt-auto pt-2">`

2. Swap the inner input shell to use the shared `.input-field` token (white `--card` bg + border + shadow + focus ring), instead of the ad-hoc background/border:
   - From: `<div className="flex flex-1 min-w-0 items-end bg-background border border-input rounded-xl focus-within:ring-2 focus-within:ring-ring">`
   - To: `<div className="input-field flex flex-1 min-w-0 items-end">`

3. No DOM/order changes: trash stays outside on the right (RTL), paperclip + textarea + send arrow stay inside the white field; file chips list and "השתמש בקבצים כמקור" toggle remain below.

## Out of scope
No backend changes, no validation/limit changes, no edits to other panels or modes, no design-token changes.
