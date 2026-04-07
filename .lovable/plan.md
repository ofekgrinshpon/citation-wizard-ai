

# Support Multiple Case Law Results & Party-Name Search

## Problem
Two issues with the current case law search:

1. **No case number = no search**: The Perplexity case law search only triggers when a case number pattern (e.g., `ע"א 1234/56`) is detected (line 537-540). Searching by party names like "מדינת ישראל נגד רומן זדורוב" skips the Perplexity search entirely — `caseNumberMatch` is `null`.

2. **Single result only**: Even when triggered, Perplexity is asked to return a single JSON object. For party names that span multiple proceedings (e.g., Zadorov had criminal trial, appeals, retrial), only one result would come back.

## Proposed Solution

### 1. Enable party-name search trigger
In `citation-chat/index.ts`, add a fallback: if the source is classified as case law (`isCaseLaw`) but no case number is found, detect a "parties pattern" (Hebrew text containing `נגד` / `נ'`) and use that as the search query.

### 2. Ask Perplexity for multiple results
Change the Perplexity system prompt to return a JSON **array** of cases when searching by party names:
```json
{"results": [
  {"found":true, "caseType":"ע\"פ", "caseNumber":"7939/10", "party1":"זדורוב", "party2":"מדינת ישראל", "date":"...", "court":"...", ...},
  {"found":true, "caseType":"ע\"פ", "caseNumber":"2485/23", ...}
]}
```

### 3. Present disambiguation to user
When multiple results are returned, format the hint as a numbered list asking the LLM to present the user with options, e.g.:
```
נמצאו מספר פסקי דין תואמים:
1. ע"פ 7939/10 זדורוב נ' מדינת ישראל (2016) — בית המשפט העליון
2. ע"פ 2485/23 זדורוב נ' מדינת ישראל (2024) — בית המשפט העליון
```
The LLM will ask the user to choose, then proceed with the selected case's data.

When only one result is returned, proceed as today (auto-populate).

## Changes

| File | Change |
|------|--------|
| `supabase/functions/citation-chat/index.ts` | 1. Add party-name detection fallback when `isCaseLaw && !caseNumberMatch`. 2. Use a multi-result prompt for party-name searches. 3. Parse array response and build disambiguation hint when >1 result. |

## Technical Details

**Party-name detection regex** (after classification tag stripping):
```typescript
const partyMatch = cleanedInput.match(/([\u0590-\u05FF\s'"]+)\s+(?:נגד|נ['׳'])\s+([\u0590-\u05FF\s'"]+)/);
```

**Perplexity prompt for multi-result**:
- System: "Return a JSON array of ALL matching Israeli court cases for these parties. Max 5 results, sorted by date descending."
- Schema: `{"results": [{...case fields...}]}`

**Disambiguation flow**:
- If `results.length === 1`: use existing single-result hint logic
- If `results.length > 1`: build a numbered list hint and instruct the LLM to ask the user which case they meant
- If `results.length === 0`: existing "not found" fallback

