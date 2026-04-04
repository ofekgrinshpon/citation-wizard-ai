

# Add Enter-to-Send in the Search Input

## Problem
The `VerifiedAutocomplete` component used as the main input does not propagate `Enter` keypress to the parent `Index.tsx`. The `handleKeyDown` in `Index.tsx` exists but is never passed to the input component.

## Solution

### 1. Add `onKeyDown` prop to `VerifiedAutocomplete` (`src/components/VerifiedAutocomplete.tsx`)
- Add an optional `onKeyDown` prop to the component interface
- In the internal `handleKeyDown`, after handling autocomplete keys (ArrowUp/Down, Enter for selection, Escape), call the external `onKeyDown` for unhandled keys
- Specifically: only call `onKeyDown` for Enter when the autocomplete dropdown is **closed** or no item is highlighted — so selecting a suggestion still works

### 2. Pass `handleKeyDown` from `Index.tsx` (`src/pages/Index.tsx`)
- Add `onKeyDown={handleKeyDown}` to the `<VerifiedAutocomplete>` at ~line 1097

This way, Enter sends the message unless the user is actively selecting an autocomplete suggestion.

