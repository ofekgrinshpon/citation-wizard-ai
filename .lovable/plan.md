## What's happening

`sonar-pro` fixed the empty-result and year problems, but for `ע"פ 4596/98` it still returned a real party name (`באקו` / `בקו`) instead of the published anonymized `פלונית`. Reason: takdin's search-results page exposes the unredacted name, and Perplexity prefers it over the פ"ד headline because nothing in our prompt tells it the פ"ד name is authoritative.

Looking at the last log, the Perplexity `search_results[].snippet` array actually contains the right name multiple times:

> `ע"פ 4596/98 פלונית נ' מדינת ישראל, פ"ד נד(1) 145`

So the correct name is **already in the response payload** — we just don't use it.

## Fix (two layers)

### 1. Prompt rule (both functions)

In the case-law system prompt, add an explicit anonymization rule:

> אם פסק הדין פורסם בפד"י והכותרת הרשמית בפד"י משתמשת בכינוי `פלוני`/`פלונית`/`קטין`/`קטינה`/`אלמוני`/`אלמונית` — זהו שם הצד הקובע. אל תחליף אותו בשם פרטי שמופיע במאגרים אחרים (תקדין/נבו), גם אם הוא נראה מפורש יותר.

### 2. Deterministic post-processing guard (both functions)

After parsing Perplexity JSON, if `isPublished === true`, scan `search_results[].snippet` + `citations` text + `pContent` (raw response) for a regex like:

```
/(?:^|\s)(פלוני|פלונית|פלונים|פלוניות|קטין|קטינה|אלמוני|אלמונית)\s+נ['׳]/
```

near the case number. If matched, **override `parsed.party1`** with that anonymized term. This is a safety net for when the prompt rule still loses to a strong takdin snippet.

Apply same logic to `party2` (rarer, but e.g. `פלוני נ' פלונית`).

## Files

- `supabase/functions/case-law-search/index.ts`
  - Update system prompt (around lines 84–98)
  - Add anonymization-override block right after `parsed = JSON.parse(...)` (~line 138), before the date-verify section
- `supabase/functions/citation-chat/index.ts`
  - Update system prompt in case-law branch (~lines 1093–1102)
  - Add same override block after `parsed = JSON.parse(jsonMatch[0])` (~line 1119)

## Out of scope

- No model changes (`sonar-pro` stays everywhere it was switched).
- No changes to legislation/regulations/books/articles branches.
- No Wikipedia verifier (deferred — year is already correct, this is only about party name).

## Verification

Re-run `ע"פ 4596/98`. Expected: `פלונית נ' מדינת ישראל, פ"ד נד(1) 145 (2000)`. Confirm via logs that the override fired (`[case-law] anonymization override: party1=באקו → פלונית`).
