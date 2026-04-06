

# Fix legislation validation: single number after ס"ח

## Root Cause
Two bugs cause the false "missing page" warning:

1. **Frontend validation regex** (line 124 of `citationValidation.ts`): The pattern `(?:ס["״]ח|ק["״]ת)\s+\d+[,\s]+(\d+)` expects TWO numbers after ס"ח (e.g., `ס"ח 864, 226`). But per Rule 2.8, there should only be ONE number (the page). So `ס"ח 128` never matches and `firstPage` stays undefined.

2. **LLM adds `[חסר: עמוד בס"ח]`**: Even though Perplexity returns the page, the LLM still outputs a `[חסר]` marker. The marker-stripping logic at lines 160-170 then deletes `firstPage` even if the regex had found it.

## Changes

### 1. `src/lib/citationValidation.ts` — Fix firstPage regex (line 124)

Change the regex from expecting two numbers to extracting the single number after ס"ח/ק"ת:
```
// OLD: expects two numbers (issue + page)
/(?:ס["״]ח|ק["״]ת)\s+\d+[,\s]+(\d+)/

// NEW: captures the single number right after the collection name
/(?:ס["״]ח|ק["״]ת)\s+(\d+)/
```

### 2. `supabase/functions/citation-chat/index.ts` — Strengthen hint to prevent `[חסר]`

Add an explicit instruction in the `legislationHint` (line 690): "אם קובץ הפרסום כולל מספר עמוד, אל תוסיף [חסר: עמוד]. הנתונים שלהלן מאומתים." This prevents the LLM from second-guessing the Perplexity data and adding a false `[חסר]` marker.

## Files

| File | Change |
|------|--------|
| `src/lib/citationValidation.ts` | Fix firstPage regex to match single number after ס"ח |
| `supabase/functions/citation-chat/index.ts` | Add instruction preventing false `[חסר]` when page data exists |

