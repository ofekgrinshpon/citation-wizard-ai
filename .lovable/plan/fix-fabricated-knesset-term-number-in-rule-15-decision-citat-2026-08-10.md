# Fix fabricated Knesset term number in Rule-15 decision citations

## The problem

The returned citation was:

```text
"החלטת הררי" (החלטה של הכנסת ה-12, 13.6.1950)
```

Two things are wrong:

1. **The term number is wrong.** 13.6.1950 falls inside the First Knesset (sworn in February 1949, dissolved 1951). The Harari decision was adopted by the First Knesset plenum, not the twelfth.
2. **The term number was never verified.** The new Rule-15 decision search returns only deciding body, decision number, decision name and date. There is no Knesset-term field in the search result, no field in the citation validator, and nothing anywhere in the codebase that derives or checks a Knesset ordinal. The "ה-12" was produced freely by the drafting model from an unconstrained "deciding body" slot.

So this is the same class of bug as the fabricated פ"ד volume: an unsourced detail rendered with full confidence.

## What to change

### 1. Deterministic Knesset-term derivation

Add a small table of Knesset terms (ordinal, start date, end date) covering the 1st through the current Knesset, plus the Provisional State Council period that precedes it. Given a verified decision date, the correct term is a lookup, not a guess.

### 2. Constrain the decision search

In the Rule-15 decision branch of the citation backend:

- Ask the search step for the Knesset term explicitly, and require it to come from an official source.
- After the search returns, compute the term from the verified date and compare. If the search-reported term and the date-derived term disagree, keep the date-derived one and log the conflict.
- If the date itself is unverified, no term may be stated at all.
- Pass the resolved term into the drafting hint as a fixed value, with an explicit instruction that the term number may not be altered or invented, and must be omitted if absent.

### 3. Reject fabricated terms after drafting

Add a post-response normalizer alongside the existing publication-data sanitizers: when the drafted citation contains a Knesset ordinal and a full date, recompute the term from the date. On mismatch, correct it; when no date is available to anchor it, strip the ordinal rather than leave an unverifiable claim.

### 4. Cover the Harari case specifically

Verify the correct rendering for the Harari decision: First Knesset, plenum, "כינון חוקה לישראל", 13.6.1950, with the decision number omitted unless an official number is confirmed (Rule 15.2). Add it as a regression case.

## Technical notes

- Term table and lookup helper: new shared module used by both the edge function and the post-response normalizer.
- Search branch and hint construction: the Rule-15 decision block in `supabase/functions/citation-chat/index.ts`.
- Post-response correction: the same content-normalization chain that already runs the Hebrew year, number-range and editor-placement fixes.
- Regression coverage: a unit test asserting date-to-term mapping around each term boundary, plus the Harari citation shape.

## Out of scope

No changes to other citation engines, to the research pipeline, or to the false-missing-field fix already shipped for the "אחר" engine.
