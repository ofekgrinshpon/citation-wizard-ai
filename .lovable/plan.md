## What's actually happening

The latest edge function logs for `סע"ש 50358-09-16` show:

```
[case-law] isCaseLaw=true, caseNumberMatch=סע"ש 50358-09-16
Case law search result: {"found":true,"party1":"קמיקר","party2":"מדינת ישראל - רשות האוכלוסין וההגירה","date":"","court":"שלום תל-אביב-יפו","isPublished":false,"databaseName":"תקדין","year":"2016","confidence":"high"}
[case-law] overrideLabel=פסיקה (מאגר), confidence=high
```

So:
- Classification IS working — `isCaseLaw=true`, override label is `פסיקה (מאגר)`.
- The court detected (`שלום תל-אביב-יפו`) is also wrong for a `סע"ש` docket — `סע"ש` is **בית הדין האזורי לעבודה**, not שלום.
- The actual blocker is `date:""` — Perplexity's `sonar` model returned only the year. The system prompt already asks for a two-step lookup on takdin lite, but `sonar` isn't fetching the case detail page reliably.

The "no full date" + wrong court are why the rendered citation looks wrong to you, which is also why it "doesn't feel like case law" in the output.

## Plan

### 1. Upgrade the case-law Perplexity model (`supabase/functions/citation-chat/index.ts`, ~line 904)

Change `model: "sonar"` → `model: "sonar-pro"` for the case-number branch only.
`sonar-pro` does multi-step reasoning and follows the "open the case page for the date" instruction much more reliably. The verification search and party-name branch can stay on `sonar`.

### 2. Add a dedicated date-recovery search when `date` is empty (~line 991, before the `dataIsUsable` check)

If `parsed.found && (!parsed.date || parsed.date.trim() === "")`, fire one focused Perplexity call:

- model: `sonar-pro`
- domain filter: `lite.takdin.co.il`, `nevo.co.il`, `court.gov.il`
- prompt: "מצא את התאריך המלא (DD.MM.YYYY) של פסק הדין `${fullCaseRef}` בין הצדדים `${party1}` נ' `${party2}`. בדף התיק בתקדין לייט התאריך מופיע בסוגריים מרובעים [DD.MM.YYYY]. החזר JSON: `{\"date\":\"DD.MM.YYYY\"}` או `{\"date\":\"\"}` אם לא נמצא."
- Validate `^\d{1,2}\.\d{1,2}\.\d{4}$` before merging into `parsed.date`.

### 3. Add a court-correction step using the docket prefix

The detected court `שלום תל-אביב-יפו` contradicts the prefix `סע"ש`. Add a small mapping of prefix → expected court family:

```text
סע"ש, ס"ק, ד"מ      → בית הדין האזורי לעבודה
ע"ע                  → בית הדין הארצי לעבודה
תמ"ש                 → בית המשפט לענייני משפחה
עת"מ                 → בית המשפט לעניינים מנהליים
```

If Perplexity returns a court whose family doesn't match the prefix, override `parsed.court` to the prefix-implied family + the city Perplexity returned (e.g. `בית הדין האזורי לעבודה תל אביב`). Log the override.

### 4. Loosen the "usable" gate so a verified docket+parties always renders as case-law (~line 997)

Today: `dataIsUsable = parsed.found && hasValidParties && (hasValidDate || hasValidPublication)`.

Change to: `dataIsUsable = parsed.found && hasValidParties` (the docket itself is the anchor, and `databaseName` will always be present for unpublished cases). When `date` is still missing after step 2, emit `[חסר: תאריך]` in the hint, but keep the `פסיקה (מאגר)` override label so the engine renders a real case-law citation rather than degrading.

### 5. Redeploy `citation-chat`

After the edits, deploy and re-run `סע"ש 50358-09-16` to verify the new logs show a populated `date` and a corrected court family.

## Files to change

- `supabase/functions/citation-chat/index.ts` (only this file)

## Out of scope

- No frontend changes.
- No database/migration changes.
- The party-search branch (no docket) is unaffected.
