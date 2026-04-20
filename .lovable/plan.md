

## Root cause (three problems compounding)

I confirmed the diagnosis by checking the DB and the logs:

1. **Local DB DOES have this case** — `legal_documents` row with `case_number = '18225-06-25'`, `source_type = 'case_law_database'`, content length **5393 chars** (well above the 3000 threshold). But the local lookup is missing it because:
   - `extractCaseNumber("בג\"ץ 18225-06-25")` extracts `'18225/06'` (hyphen → slash conversion)
   - `caseNumberVariants('18225/06')` produces only `['18225/06']` — it does NOT generate the original hyphenated form `'18225-06-25'`
   - DB stores it as `'18225-06-25'`, so `.in("case_number", ['18225/06'])` matches nothing
   - **This is the primary bug.** The case is right there, we just look up the wrong key.

2. **External fetch is blocked** — `supremedecisions.court.gov.il` resets the connection (`os error 104: Connection reset by peer`) for requests from Supabase edge runtime IPs, regardless of headers. This is a server-side anti-bot measure against datacenter IPs. We can't fix this from the edge function — but we don't need to, because the data is already local.

3. **Title-fallback search would also work but never runs** — because `caseNum` is truthy (`'18225/06'`), the code skips the title-fallback `.or(...)` query entirely. Even if it ran, the title contains `(בג"ץ 18225-06-25)` so an `ilike '%18225-06-25%'` would have matched.

## Fix — `supabase/functions/verify-case-fulltext/index.ts`

Change `caseNumberVariants()` to **also keep the original raw input** (the unconverted hyphenated form) when the input came from a hyphenated case number. Concretely:

- When `extractCaseNumber()` matches the `BARE_HYPHEN_REGEX` (e.g. `18225-06-25`), it currently returns the slash form `'18225/06'`. Change it to return the **original hyphenated string** `'18225-06-25'` instead, and let `caseNumberVariants()` derive both forms from it:
  - `'18225-06-25'` → variants: `['18225-06-25', '18225/06', '18225-06']`
- This way `.in("case_number", variants)` will match DB rows stored in any of the three common formats.

Also expand `caseNumberVariants()` for prefixed/slash inputs to cover the inverse mapping where reasonable (slash → hyphen is ambiguous without the day, so skip that direction; just make sure hyphenated DB rows are findable).

That's the only retrieval change needed. The external-fetch path can stay as-is (it correctly logs the connection reset and falls through), since the local DB already has the case.

## Out of scope
- Fixing the court-server connection reset (not solvable from edge runtime; would need a residential-IP proxy or scheduled offline ingestion).
- Changing the AI prompt or `legal-qa` — once `verify-case-fulltext` returns the local 5393-char content, the existing pipeline will fill in the summary fields normally.
- UI changes.

## Files touched
- **Edit** `supabase/functions/verify-case-fulltext/index.ts` — adjust `extractCaseNumber` (return raw hyphenated form) and `caseNumberVariants` (emit hyphen + slash + truncated-hyphen forms).
- **Deploy** `verify-case-fulltext`.

## Expected outcome
Entering `בג"ץ 18225-06-25` → local lookup finds the existing 5393-char document → `legal-qa` produces a real structured summary (עובדות / טענות / שאלה משפטית / דעות / הכרעה / הלכה) populated from the actual judgment text, with the "מקומי" source badge.

