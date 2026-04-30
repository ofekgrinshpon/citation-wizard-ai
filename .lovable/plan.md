## What's actually failing

Logs for the latest two attempts on `סע"ש 50358-09-16` and `סע״ש קמיקר נ' מדינת ישראל - רשות האוכלוסין וההגירה`:

```
[case-law] isCaseLaw=false ... caseNumberMatch=null, partyMatch=no    ← docket attempt
[book]    Searching Perplexity for: סע"ש קמיקר נ מדינת ישראל...        ← party-only attempt
[case-law] Date-recovery search result: I appreciate your question, but I need to be direct with you: I don't have the ability to browse websites...
```

Three independent bugs:

### Bug 1 — Classifier regex is fed un-normalized text
`normalizeHebrewLegalText` (which converts `״ → "`, strips niqqud, etc.) only runs *after* the case-law branch decides to run. The classifier on line 836 still tests the **raw** `userInput` for the docket regex, so an input typed with gershayim (`סע״ש`) or a stray niqqud silently fails to match `סע"ש`. Result: `caseNumberMatch=null` even though we previously matched the same docket.

**Fix:** apply `normalizeHebrewLegalText` to the input *once at the top* of the request handler (or at least before line 836), and use the normalized string for: the AI classifier prompt, `caseNumberMatch`, and `partyMatch`. Keep the original for display only.

### Bug 2 — Party-only case-law inputs are mis-classified as "book"
When the user types a docket prefix + parties but no docket number (`סע״ש קמיקר נ' מדינת ישראל - רשות האוכלוסין וההגירה`):
- `caseNumberMatch` is null (no number) ✓ expected
- `partyMatch` regex on line 849 *should* fire on `נ'`, but `party1` greedily captures `סע״ש קמיקר` (bleeding the prefix into the party name), and the AI classifier returns "ספרות" because the gershayim throws it off, so `isCaseLaw=false` and we fall through to the book branch.

**Fix:**
1. Add a **prefix-only override**: if the normalized input *starts with* a known case-law prefix (`סע"ש`, `ע"א`, `בג"ץ`, …) followed by Hebrew text, force `isCaseLaw=true` regardless of the AI classifier.
2. Strip the leading prefix from the text before applying `partyMatch`, so party1 is just `קמיקר` instead of `סע״ש קמיקר`.
3. Pass the prefix through to the party-search branch so the Perplexity prompt knows to constrain results to that court family (e.g. `סע"ש` → labor-court cases only). This stops the search from returning irrelevant civil-court hits between the same parties and means the user's manual override produces a correct, complete citation.

### Bug 3 — Date-recovery prompt triggers a refusal
`sonar-pro` returned a long English refusal ("I don't have the ability to browse websites…") for the date-recovery call. The model treats our user prompt as a question rather than a search task. Fix the prompt:
- Drop the conversational framing.
- Use a search-shaped query string (`"סע\"ש 50358-09-16" קמיקר תאריך`) as the user content.
- Explicitly state in the system prompt: *"You have web search; use the search results from the configured domains. If no result, return `{\"date\":\"\"}`. Never explain — JSON only."*
- Keep `search_domain_filter: ["lite.takdin.co.il", "nevo.co.il", "court.gov.il"]`.
- Add `search_recency_filter` is **not** appropriate (judgment is from 2016); instead omit it.

Also: when the first-pass search returns `confidence: "low"` AND `date: ""` AND parties are present, run the date-recovery call too (currently it only runs on empty date).

## Files to change

`supabase/functions/citation-chat/index.ts` — only this file.

## Out of scope

- Frontend, DB, other edge functions.
- The `partyMatch` regex itself is fine; we just need to feed it normalized + de-prefixed text.

## Verification

After deploy, three test inputs:
1. `סע״ש 50358-09-16` (gershayim) → `caseNumberMatch != null`, `isCaseLaw=true`, full DD.MM.YYYY date populated.
2. `סע"ש 50358-09-16` (ASCII quote) → same as above, no regression.
3. `סע״ש קמיקר נ' מדינת ישראל - רשות האוכלוסין וההגירה` → `isCaseLaw=true` via prefix override, party-search branch runs (not book branch), returns the labor-court case with full metadata.

Then redeploy `citation-chat` and inspect logs to confirm the new `[case-law] prefix-override=true` log line and a populated `parsed.date`.
