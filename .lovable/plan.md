

# Add "case not found" fallback with [חסר:...] placeholders

## Problem
When Perplexity finds nothing (`found: false`, JSON parse failure, or HTTP error), the system silently proceeds with zero metadata. The LLM then either halluccinates details or produces an unhelpful response.

## Solution
In `supabase/functions/citation-chat/index.ts`, when a case law search runs but returns no results, inject a fallback hint telling the AI explicitly:
- The case was **not found** in any search
- It must use `[חסר:...]` for every unknown field
- It must **not invent** party names, dates, courts, or publication details

### Change (single file)

**`supabase/functions/citation-chat/index.ts`** — after the search block (around line 541), add an `else` branch for when `parsed.found` is falsy (or when JSON parsing fails, or Perplexity returns an error):

```typescript
// After the if (parsed.found) { ... } block:
} else {
  caseLawHint = `\n\n══ חיפוש פסק דין ══\nלא נמצאו נתונים מאומתים עבור ${fullCaseRef}.\nחובה להשתמש ב-[חסר:...] עבור כל שדה שאינו ידוע (צדדים, תאריך, בית משפט, פרסום/מאגר).\nאל תמציא שמות צדדים, תאריכים, או פרטי פרסום.\n══`;
}
```

Same fallback text for the outer failure cases (HTTP error, no JSON match, parse error) — set `caseLawHint` to the same warning string instead of leaving it empty.

This ensures the LLM always gets explicit anti-hallucination instructions when no real data was found.

| File | Change |
|------|--------|
| `supabase/functions/citation-chat/index.ts` | Add fallback `caseLawHint` with [חסר:...] instructions when search finds nothing |

