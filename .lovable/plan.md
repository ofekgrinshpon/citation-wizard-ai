

## Fix: Add trailing period to footnote citations in העוזר המשפטי

### Problem
Footnote citations in the Legal Assistant output are missing a period (`.`) at the end, which is required by Israeli citation convention.

### Change

**`supabase/functions/legal-qa/index.ts`** — after the post-processing cleanup (around line 501), add a step that ensures every footnote citation ends with a period:

```typescript
// Ensure trailing period on every citation
for (const fn of footnotes) {
  if (fn.citation && !/[.。]$/.test(fn.citation.trim())) {
    fn.citation = fn.citation.trim() + ".";
  }
}
```

This runs after title stripping and placeholder removal, so the period is always the final character.

### Files
- `supabase/functions/legal-qa/index.ts` — add trailing period enforcement

