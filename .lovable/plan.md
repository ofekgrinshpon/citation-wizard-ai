

## Fix Truncated Input in "אזכור אחיד" Mode

### Problem
The input field in the "אזכור אחיד" section uses a single-line `<input>` element inside a container with `overflow-hidden`. When the user types a long citation, the text gets cut off and isn't fully visible (as shown in the screenshot).

### Solution
The input field container on line 1110 of `src/pages/Index.tsx` has `overflow-hidden` which clips the text. The fix:

1. **Remove `overflow-hidden`** from the `.input-field` wrapper div (line 1110) — change it to `overflow-visible` or remove the overflow class entirely
2. Alternatively, ensure the inner `<input>` element can scroll horizontally so the user can see what they're typing

### File
- `src/pages/Index.tsx` — line 1110: remove `overflow-hidden` from the `input-field` div's class list

