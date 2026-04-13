

## Fix: Verified Sources Dropdowns Auto-Opening in Footnotes Tab

### Problem
When switching to "הערות שוליים" (Batch Footnote Builder), every cell that already has text triggers the `VerifiedAutocomplete` search `useEffect`, which runs on mount because `value` already has content. This causes all dropdown panels to open simultaneously.

### Fix
**`src/components/VerifiedAutocomplete.tsx`** — Add a `hasFocused` ref that prevents the dropdown from opening on mount. The search effect should still fetch suggestions, but only set `isOpen(true)` if the input has been focused at least once.

1. Add a `hasFocused` ref initialized to `false`
2. Set it to `true` in the `onFocus` handler
3. In the search effect, only call `setIsOpen(true)` if `hasFocused.current` is true
4. The `onFocus` handler already opens the dropdown if suggestions exist, so focusing will still show results

This ensures dropdowns stay closed when the tab loads, but work normally once the user interacts with a field.

### Files
- `src/components/VerifiedAutocomplete.tsx` — ~5 lines changed

