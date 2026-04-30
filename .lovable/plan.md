# Fix `סע"ש 50358-09-16` returning no date in אזכור אחיד

## What actually happened

Edge function logs for your query show:

```
[case-law] isCaseLaw=false, caseNumberMatch=null, partyMatch=no
[book] Searching Perplexity for: סע"ש קמיקר נ מדינת ישראל...
[book] Perplexity raw response: {"found":false}
```

So the citation went through the **citation-chat** function (not `case-law-search`), and inside it the case-number branch **never ran**. Two reasons:

### Cause 1 — `סע"ש` is missing from the docket regex

`supabase/functions/citation-chat/index.ts` line 816:

```ts
const caseNumberMatch = userInput.match(
  /(בג"ץ|בג״ץ|ע"א|ע״א|ע"פ|ע״פ|רע"א|רע״א|דנ"א|דנ״א|ת"א|ת״א|ע"ע|ע״ע|עע"מ|עע״מ|בש"פ|בש״פ|ת"פ|ת״פ|תפ"ח|תפ״ח|עמ"ה|עמ״ה|בר"ם|בר״ם)\s+([0-9]+[\/\-][0-9]+)/
);
```

`סע"ש` (labor court — sikhsukhei avoda) is not in the list. So `caseNumberMatch=null`, the function fell through to the party-name branch, didn't match that either, and ended up classified as a **book** search — which is why your logs show `[book] Searching Perplexity for…` returning `{"found":false}` and rendering the citation with no date.

Other common prefixes also missing: `סע"ש`, `תמ"ש` (family), `עת"מ` (admin petitions), `ה"פ`, `פ"ה`, `תק"ג`, `ב"ש`.

### Cause 2 — Branch A prompt was never updated with the takdin two-step

Last round's fix touched `case-law-search/index.ts` and `_shared/partyLookup.ts`. But `citation-chat/index.ts` has its **own** Perplexity call for the case-number branch (lines 866–888), and it has:

- No `search_domain_filter` at all — Perplexity is free to roam blogs and old summaries that only show the year.
- No takdin two-step instruction (search-results page → click through to case landing page for `[DD.MM.YYYY]`).
- A schema that asks for `date` but doesn't insist it be the full date when the case page exposes it.

So even if `סע"ש` were in the regex, the case-number search would still tend to return year-only on long-tail dockets — exactly the symptom you saw originally.

## Plan — two surgical edits, one file

### Edit 1 — Extend the docket regex (line 816)

Add labor/family/admin prefixes that legitimately appear in citations:

```
סע"ש | סע״ש | תמ"ש | תמ״ש | עת"מ | עת״מ | ה"פ | ה״פ | פ"ה | פ״ה | ב"ש | ב״ש | תק"ג | תק״ג
```

Same `\s+([0-9]+[\/\-][0-9]+)` tail. No change to capture-group semantics — `caseType` still ends up in `caseNumberMatch[1]`, docket in `[2]`.

### Edit 2 — Bring Branch A's Perplexity call up to parity with `case-law-search`

In the `fetch("https://api.perplexity.ai/chat/completions", …)` call around lines 866–888:

1. **Add `search_domain_filter`** with the same trusted list already used in `case-law-search`:
   ```
   ["lite.takdin.co.il", "takdin.co.il", "nevo.co.il",
    "supreme.court.gov.il", "court.gov.il", "psakdin.co.il"]
   ```

2. **Append the takdin two-step block** to the existing system prompt (the same Hebrew block that's already in `case-law-search`):
   - Step 1: query `https://lite.takdin.co.il/search-results?txtSearch=<docket>` to identify parties / court / docket prefix.
   - Step 2: if the snippet shows only a year, follow the result link to the individual case landing page on `lite.takdin.co.il` — the page exposes the decision date in `[DD.MM.YYYY]` brackets, free of charge (only the full PDF is paywalled).
   - Mandatory: never return only a year if the case page exposes the full date. Populate `date` as `DD.MM.YYYY` whenever available.
   - Fallback: if not found on takdin, try `nevo.co.il` and `supreme.court.gov.il`.

3. Keep the existing JSON schema and `confidence` / `padi_*` fields — no behavioral change for already-working Supreme Court / פד"י paths.

### What I will NOT change

- The schema-validation block (lines 947–982) — `hasValidDate` already accepts `DD.MM.YYYY`, so once Perplexity returns it, the existing pipeline writes it into `caseLawHint` and the citation renders correctly.
- The verification-search call (lines 902–944) — that's a separate פד"י-only check, unrelated to the date issue.
- The party-name fallback branch (Branch B) and the book branch — they were only triggered here as **side effects** of the regex miss, not the actual problem.
- `case-law-search/index.ts` and `_shared/partyLookup.ts` — already correct from the previous round.

## Files touched

- `supabase/functions/citation-chat/index.ts` — regex on line 816, Perplexity body around lines 866–888.

Redeploy `citation-chat` after the edit.

## Validation

1. Re-run `סע"ש 50358-09-16` in אזכור אחיד. Expected: logs show `caseNumberMatch=סע"ש 50358-09-16`, Branch A fires, Perplexity returns `date: "19.10.2021"`, citation renders with the full date — no `[חסר: תאריך מלא]`.
2. Spot-check `תמ"ש`, `עת"מ` dockets where the Takdin landing page is the only public source of the full date.
3. Sanity-check that an existing Supreme Court query (e.g. `בג"ץ 6427/02`) still resolves with פ"ד publication unchanged.

Approve and I'll make the two edits to `citation-chat/index.ts` and redeploy.
