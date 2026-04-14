

## Fix: Cross-reference regex doesn't match Hebrew gershayim (״)

### Root cause

All regexes for "לעיל ה"ש" use standard double-quote `"` but the AI sometimes outputs Hebrew gershayim `״` (U+05F4). The reference `פרי, לעיל ה״ש 4` was never caught by the renumbering logic, so it stayed as 4 instead of being updated to 3.

### Changes

**File: `supabase/functions/legal-qa/index.ts`**

Create a reusable quote-agnostic pattern and update all 4 locations that match "לעיל ה"ש":

```typescript
// Near top of serve handler, define a helper pattern string
const SUPRA_PATTERN = 'לעיל\\s+ה["\u05F4\u201C\u201D״]ש\\s+';
```

Then update these 4 regex sites to use the pattern:

1. **Line ~904** (renumbering cross-refs): replace `/לעיל\s+ה"ש\s+(\d{1,2})/g` with `new RegExp(SUPRA_PATTERN + '(\\d{1,2})', 'g')`

2. **Line ~942** (self-reference fix): replace the hardcoded pattern with `new RegExp(SUPRA_PATTERN + fn.number + '\\b', 'g')`

3. **Line ~945** (self-reference removal): same pattern update

4. **Line ~952** (validation): replace `/לעיל\s+ה"ש\s+(\d{1,2})/` with `new RegExp(SUPRA_PATTERN + '(\\d{1,2})')`

5. **Line ~958** (validation removal): same pattern update

### Technical details
- Single file change: `supabase/functions/legal-qa/index.ts`
- The pattern matches `"`, `״`, `"`, `"` variants
- Redeploy Edge Function `legal-qa`

