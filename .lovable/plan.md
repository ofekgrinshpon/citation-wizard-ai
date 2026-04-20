

## Root cause (definitive)

The DB has 11,479 case rows under `source_type = 'caselaw'` (one word). The `verify-case-fulltext` function filters on `["case_law", "case_law_database"]` (with underscore). **No row ever matches.** Every case summary refuses, even when the text is sitting right there. The recent variant fix was correct but couldn't help because the `source_type` filter rejects the row before `case_number` is even compared.

Confirmed for `18225-06-25`:
- Row exists, `source_type='caselaw'`, content **5393 chars**
- Logs show variants generated correctly: `["18225-06-25","18225/06","18225-06"]`
- Lookup returns 0 because `'caselaw'` is not in `["case_law","case_law_database"]`
- External fetch then fails (Connection reset by peer from court server)
- → refusal

## Fix — one file

**`supabase/functions/verify-case-fulltext/index.ts`** — change both local-lookup queries to filter on the actual values in the DB:

```ts
.in("source_type", ["caselaw", "case_law", "case_law_database"])
```

(Keep the legacy values too, in case any older rows exist with those types.)

Two places to change: line 265 (case-number lookup) and line 278 (title-fallback lookup).

That's it. No other logic, prompt, or UI changes needed — once the row is returned, the existing pipeline produces the structured summary.

## Out of scope
- External court-server fetch (still blocked by IP-based rate limit; doesn't matter once local lookup works).
- AI prompt or `legal-qa` changes.

## Expected outcome
`בג"ץ 18225-06-25` → local hit (5393 chars, `caselaw`) → real structured summary with עובדות / טענות / שאלה משפטית / דעות / הכרעה / הלכה filled from the actual judgment, with the "מקומי" badge. Same fix unblocks **all ~11.5K** locally-ingested cases.

