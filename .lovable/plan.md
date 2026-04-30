# Fix `סע"ש 50358-09-16` — round 2

## What the new logs show

```
[case-law] isCaseLaw=null, caseNumberMatch=סע"ש 50358-09, partyMatch=no
```

Two distinct problems remain in `supabase/functions/citation-chat/index.ts`:

### Problem 1 — Regex truncates the docket

Line 816 captures the docket with `[0-9]+[\/\-][0-9]+`, which only allows **one** separator. Israeli district / labor / family dockets use the form `NNNNN-MM-YY` (two dashes), e.g. `50358-09-16`. The current regex matches only `50358-09` and drops the `-16` year tail.

That truncated docket gets sent to Perplexity, which then can't find the right case (or finds the wrong one), and the date comes back wrong / missing.

### Problem 2 — `isCaseLaw=null` blocks the case-law branch

```ts
const classMatch = userInput.match(/\[סיווג אוטומטי:\s*([^\]]+)\]/);
const isCaseLaw = classMatch && /פסיקה/.test(classMatch[1]);
...
const shouldSearchCaseLaw = isCaseLaw && !hasVerifiedCandidates && (caseNumberMatch || partyMatch) && ...
```

The auto-classifier didn't prepend `[סיווג אוטומטי: פסיקה]` to this query, so `isCaseLaw=null` and `shouldSearchCaseLaw=false`. Branch A never ran — even with the regex fix alone, the Perplexity case-law lookup wouldn't trigger.

This is brittle: when a user types a clean Israeli docket like `סע"ש 50358-09-16` directly into אזכור אחיד, **the docket prefix itself is unambiguous proof that it's case law** — we shouldn't require the upstream classifier to also agree.

## Plan — two surgical edits to the same file

### Edit 1 — Allow the optional third segment in the docket regex (line 816)

Change the docket tail from:

```
[0-9]+[\/\-][0-9]+
```

to:

```
[0-9]+(?:[\/\-][0-9]+){1,2}
```

This matches both:
- `6427/02`, `8294/14` (Supreme Court / classic)
- `50358-09-16`, `13579-11-24` (district / labor / family — two-dash form)

No change to capture-group indices. `caseNumberMatch[1]` is still the prefix, `[2]` is the docket.

### Edit 2 — Treat a recognized docket prefix as sufficient evidence of case-law

Replace:

```ts
const isCaseLaw = classMatch && /פסיקה/.test(classMatch[1]);
```

with:

```ts
const isCaseLawByClassifier = !!(classMatch && /פסיקה/.test(classMatch[1]));
// fallback: a recognized Israeli docket prefix + docket number IS case-law,
// regardless of whether the upstream classifier tagged it.
// (caseNumberMatch is computed below, so move/duplicate the regex test up,
// or just compute caseNumberMatch first and then derive isCaseLaw from both.)
const isCaseLaw = isCaseLawByClassifier || !!caseNumberMatch;
```

Concretely: move the `caseNumberMatch` computation **above** the `isCaseLaw` line (it currently sits at line 816, two lines below), then OR them together. No other code in the file reads `isCaseLaw` for anything that would regress (it gates only the case-law search and the disambiguation-selection branches, both of which legitimately want to run when we have a real docket).

`partyMatch` is **not** included in this fallback — "X נ' Y" is too ambiguous (could be a book title or article reference). Only an explicit docket prefix is trusted as case-law evidence.

## What this does NOT change

- `case-law-search/index.ts`, `_shared/partyLookup.ts` — already correct from previous rounds.
- The validation block, the verification search, the disambiguation flow, Branch B (party search), the book branch — all untouched.
- The takdin two-step prompt and `search_domain_filter` added last round — those stay; this fix just makes sure execution actually reaches them.

## Files touched

- `supabase/functions/citation-chat/index.ts` — lines ~810–816 only.

Redeploy `citation-chat` after the edit.

## Validation

1. Re-run `סע"ש 50358-09-16` in אזכור אחיד.
   Expected logs: `caseNumberMatch=סע"ש 50358-09-16` (full docket), `isCaseLaw=true`, Branch A fires, Perplexity returns `date: "19.10.2021"`.
2. Spot-check a Supreme Court query (`בג"ץ 6427/02`) — should still match (single-slash form covered by `{1,2}`) and resolve פ"ד publication unchanged.
3. Spot-check a district docket (`ת"א 13579-11-24`) — should match the full docket and route to case-law.

Approve and I'll make the two edits and redeploy.
