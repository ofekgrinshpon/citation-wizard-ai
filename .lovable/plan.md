## Goal

Stop emitting a wrong `(year)` for published Supreme Court case-law citations (Rule 18). The current pipeline trusts Perplexity's single-shot `date`/`year` even when it is fabricated, as just happened with `ע"פ 4596/98 פלונית נ' מדינת ישראל, פ"ד נד(1) 145` (got `(2001)`, real decision date `25.01.2000` → should be `(2000)`).

## Root cause

In `supabase/functions/citation-chat/index.ts` (case-number branch, ~lines 974–1075):

1. The first Perplexity (`sonar`) call returns `date`/`year` alongside publication fields. We accept them as-is.
2. The "secondary verification" block (~lines 984–1029) re-asks Perplexity **only** about `isPublished/padi_volume/padi_part/padi_page`. It does not re-fetch the decision date.
3. The system prompt does not tell Perplexity that the `year` field for a published case must be the **decision year** (Rule 18), not the volume's print year. Perplexity tends to return the volume's publication year, and sometimes invents the date outright.
4. There is no plausibility check between the published volume (e.g. `פ"ד נד(1)`) and the returned `date`/`year`.

Same pattern exists in `supabase/functions/case-law-search/index.ts` (single-shot, no verification at all).

## Fix

### 1. `supabase/functions/citation-chat/index.ts` — add a date-verification step

When the (possibly verification-promoted) result has `isPublished === true` AND `padi_volume` present, run one extra focused Perplexity call (`sonar`, same `search_domain_filter`) asking **only** for the decision date:

```
מהו התאריך המדויק שבו ניתן פסק הדין {fullCaseRef} שפורסם בפ"ד {volume}({part}) {page}?
החזר JSON בלבד: {"date":"DD.MM.YYYY","year":"YYYY","confidence":"high/low"}
```

System message must state: "התאריך הנדרש הוא תאריך מתן פסק הדין על ידי בית המשפט (לא שנת הוצאת הכרך)."

Logic:
- If the new date parses cleanly → **override** `parsed.date` and `parsed.year` with it.
- If the two dates disagree by more than 12 months → set `parsed.confidence = "low"` and prefer the verification result (it is anchored to a specific volume).
- If verification fails or returns nothing → **clear** `parsed.date`/`parsed.year` so the downstream output emits `[חסר: שנה]` instead of a fabricated value (anti-hallucination policy, per `mem://logic/anti-hallucination`).

Add to the existing system prompt at line ~960: "שדה `year` חייב להיות שנת מתן פסק הדין, לא שנת הוצאת כרך פ"ד."

### 2. `supabase/functions/citation-chat/index.ts` — plausibility guard

Add a small `PADI_VOLUME_YEAR_RANGES` table (a handful of well-known volumes is enough; full table is not required):

```ts
// volume → [earliest plausible decision year, latest plausible decision year]
// Add entries opportunistically; unknown volumes skip the check.
const PADI_VOLUME_YEAR_RANGES: Record<string, [number, number]> = {
  "נד": [1999, 2001],
  "נה": [2000, 2001],
  // ...
};
```

After step 1, if `parsed.padi_volume` is in the table and `Number(parsed.year)` is outside the range → clear `parsed.year`/`parsed.date` and mark confidence `low`. This catches future regressions without a network call.

### 3. `supabase/functions/case-law-search/index.ts` — port the same date-verification step

This function is the standalone variant used by other call sites. Apply identical logic so we do not regress through that path.

### 4. Telemetry

Add console logs:
- `[case-law] date verification: original={...} verified={...} action=override|clear|keep`
- `[case-law] volume plausibility: volume=נד year=2001 → out of range, cleared`

So we can spot future hallucinations in the function logs.

## Verification

Re-run `ע"פ 4596/98`. Edge logs should show:
1. First call returns `date=28.06.2001, year=2001`.
2. Publication verification keeps `פ"ד נד(1) 145`.
3. New date verification returns something like `date=25.01.2000, year=2000`.
4. Override applied; final citation reads `ע"פ 4596/98 פלונית נ' מדינת ישראל, פ"ד נד(1) 145 (2000).`

Also run a known-good case (e.g. one already verified) to confirm we did not regress.

## Out of scope

- Switching Perplexity models or adding a different provider.
- Changing the case-number routing or local `verified_sources` ranking.
- Rule 19 (database) citations — this fix targets Rule 18 (published) only, where the `(year)` field is mandatory and high-visibility.
- Building a full volume↔year mapping table for all פ"ד volumes (only seed a few; expand on demand).
