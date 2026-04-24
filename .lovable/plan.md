

# Fix two academic-chapter citation problems

The last run (Q on סחיטת דמי חסות / חובה חיובית, qa_log `2c64327f...`) exposed two real bugs in the post-draft footnote pipeline. Both are fixable in `supabase/functions/legal-qa/index.ts`.

## What actually went wrong (from the live run)

**Problem 1 — duplicate footnotes for the same source (FN1 + FN2):**
Both FN1 and FN2 are the same Barak family-law journal article, just formatted slightly differently by the drafter. The footnote-build loop (lines 4121-4199) matches each AI footnote to a source card via `matchFootnoteToCard`, and **does not check whether that card was already cited earlier in the loop**. So when the drafter writes two notes that resolve to the same `card.id`, both get appended as consecutive numbered footnotes pointing at the same URL.

Aggravating factor: that source was off-topic to begin with. Rerank kept only 4 local docs (`after_rerank: caselaw=0, knesset_research=3, journal_article=1`) — the lone journal article was Barak on family-law constitutionalization. The drafter had no relevant constitutional-law local source, so it grabbed the only journal article available, twice. The dedup fix is the immediate win; relevance is a separate, larger problem.

**Problem 2 — חוק-יסוד: כבוד האדם וחירותו named in body, no footnote:**
Stage E.5 fires *before* drafting, based on uncovered sub-issues. It pulled חוק העונשין (→ FN6) but not the Basic Law, because the planner sub-issues didn't surface "Basic Law: Human Dignity and Liberty" as a distinct missing source — even though the drafter then named it explicitly in the מסגרת נורמטיבית paragraph. The post-draft `coverage-gap` scan logs the unanchored sentence but takes no action. The anchor pass can only re-use existing source-pack cards; it cannot fetch new ones. Result: the Basic Law gets named with no citation, in violation of the prompt rule at line 3377 that explicitly demands one.

## Fix 1 — De-duplicate footnotes that resolve to the same source card

In the AI-footnote loop (lines 4121-4199), track which `card.id` values have already been emitted. When the next AI footnote matches an already-cited card:

- **Do not** append a new numbered footnote.
- Map `aiFn.num` to the **existing** new number in `oldIdToNewNumber` so the body's `[N]` markers get rewritten to point at the first occurrence.
- Log it as `Deduped AI footnote #N → reusing existing #M (same card "<title>...")`.

Edge-case handling:
- "Same source, different pinpoint" (e.g. one cites בעמ' 5, another cites בעמ' 12): treat as same card and reuse — the pinpoint divergence is a drafter bug, not a real second authority. We log a `dedup_with_pinpoint_conflict` warning and surface it in `qa_logs.metadata.footnote_dedup` so we can monitor.
- Fuzzy-URL fallback matches: also dedup against URL when no card matched.
- "שם" / "לעיל ה"ש" short-form footnotes (Rule 37.7): NOT touched — those are intentional repeats, handled elsewhere.

Telemetry: add `qa_logs.metadata.footnote_dedup = { merged_count, with_pinpoint_conflict, samples }` (first 3 merge previews).

Expected immediate effect on the failing run: FN1 and FN2 collapse into a single FN1; the `[1]` and `[2]` markers in the body both point to it. Total footnotes drops from 8 to 7.

## Fix 2 — Post-draft statute completion for named-but-uncited statutes

Add a new post-draft stage **after** `coverage-gap` and **before** the final footnote validation, gated by `enableDeepPipeline` (so it covers both Deep research and academic chapters):

```text
1. Scan the drafted body with a Hebrew-statute regex:
     /(חוק[- ]יסוד[^,.\n[]{2,80}|חוק [^,.\n[]{2,80}|פקודת [^,.\n[]{2,80}|תקנות [^,.\n[]{2,80})/g
2. For each match, normalize the statute name and check:
     a. Is there already a footnote whose citation contains this statute name? → skip
     b. Is there a [N] marker within ~120 chars of the named statute in the body? → skip
3. Collect remaining "named but unanchored" statutes (capped at 3).
4. If list is non-empty, call a new helper runStatuteCompletion(statuteNames):
     - Re-uses the Stage E.5 Perplexity client (same API key, same 15s timeout).
     - Asks ONLY for type="statute" entries with the same strict schema (year_hebrew + year_gregorian + ס"ח/ק"ת + page + URL).
     - Validates with the existing validatePerplexityCandidate.
5. For each validated statute:
     - Append it as a new SourceCard (provenance="perplexity_completion").
     - Append a new footnote to finalFootnotes pointing at it.
     - Insert the [N] marker in the body right after the first naked mention of the statute name.
```

Telemetry: `qa_logs.metadata.statute_completion = { triggered, named_statutes, completed_count, skipped_with_existing, drops }`.

Expected effect on the failing run: חוק-יסוד: כבוד האדם וחירותו gets a real Perplexity-fetched citation with the proper התשנ"ב/1992 + ס"ח 150 fields, becomes a new footnote, and the marker is inserted at the first body mention. Total footnotes climbs from 7 (after Fix 1) to 8.

## What we are explicitly NOT doing in this pass

- **Not retraining/re-prompting the rerank** to keep more relevant journal articles. That's the underlying reason FN1/FN2 ended up as Barak family-law in the first place, but it's a retrieval-quality problem that needs its own pass with eval data. Fixes 1+2 are the right surgical patches for *the post-draft footnote layer* given whatever sources retrieval delivers.
- **Not changing Stage E.5's pre-draft trigger.** It still fires on `core < 6`. Fix 2 is a separate post-draft completion targeted only at named statutes, not a broader coverage retry.
- **Not touching the anchor pass.** It keeps doing what it does (re-anchor sentences to existing cards). Fix 2 supplies new cards before validation, so the anchor pass has more to work with on the next iteration if needed.

## Files touched

- `supabase/functions/legal-qa/index.ts` — Fix 1 in the footnote-build loop (lines ~4121-4199); Fix 2 as a new stage between `coverage-gap` (line ~4795) and final validation; metadata block at line ~4905 gets two new keys.
- `.lovable/memory/logic/legal-qa/post-processing-cleanup.md` — append the dedup + statute-completion behavior so future runs know it exists.

## Verification after deploy

Re-run the same סחיטת דמי חסות question (or any question that names a Basic Law in the body). Confirm in `qa_logs.metadata`:

- `footnote_dedup.merged_count >= 1`
- `statute_completion.completed_count >= 1` with חוק-יסוד: כבוד האדם וחירותו in `named_statutes`
- The body contains `[N]` immediately after the first mention of the Basic Law
- No two footnotes share the same URL + same source-card id

