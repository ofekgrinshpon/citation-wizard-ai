

# Add Perplexity Search for תקנון (Rule 13.1)

## Overview
When a user's query is classified as `תקנון`, trigger a Perplexity search to find the regulation's exact date and full name — the two required fields for Rule 13.1 citations.

## Change

| File | Change |
|------|--------|
| **`supabase/functions/citation-chat/index.ts`** | Add a new Perplexity search block (after the legislation search block) for regulations. Detect via `classMatch` matching `תקנון`. Search query asks Perplexity for the regulation's full name, exact Gregorian date (DD.MM.YYYY), and any known abbreviation (e.g. תקשי"ר). Return structured JSON `{found, regulationName, fullDate, abbreviation}`. Inject results as a `══ נתוני תקנון מאומתים ══` hint into the user message, following the same pattern as case-law and legislation hints. Include anti-hallucination fallback if search fails. |

## Search query design
The Perplexity system prompt will request:
- Full official name of the regulation/bylaw
- The exact Gregorian date of the current version (last amendment date)
- Common abbreviation if any

Response format: `{"found":true/false,"regulationName":"...","fullDate":"DD.MM.YYYY","abbreviation":"..."}`

## Integration point
The hint will be appended alongside existing hints in the `enhancedMessages` construction (line ~737), e.g.:
```
const allHints = engineHint + (verifiedHint || "") + caseLawHint + legislationHint + regulationHint;
```

