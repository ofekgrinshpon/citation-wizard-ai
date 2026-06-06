# Fix Tier-2 hallucinations in footnote (citation-chat) path

## Problem (from logs for בג"ץ 4769/24)

Tier-2 fired correctly and returned trusted citations — but the model returned parties from **בג"ץ 5819/24** (a louder neighbor) instead of 4769/24. Across 5 retries the parties shifted: `התנועה למען איכות השלטון נ' שר הביטחון` → `מכון ברנדייס נ' היועצת המשפטית` → `התנועה לאיכות השלטון נ' שר המשפטים`. One run also fabricated a `פ"ד מב(4) 868` publication for a 2024 case.

Root causes, in order of impact:

1. **No docket-anchor gate** in `citation-chat` tier-2 (refill has one, footnotes don't).
2. **Adjacent-case contamination**: search results for 4769/24 are dominated by 5819/24; the model copies the louder neighbor's text even when the correct URL is in the citation list.
3. **Verification-search override** has no sanity check — it accepted a `פ"ד מב/4/868` claim for a 2024 case.

## Changes

### A. Docket-anchor gate in `citation-chat` tier-2 (parity with refill)

In `perplexityWithFallback` (citation-chat/index.ts ~L81–162), add an optional `dockedAnchor?: { num: string; year: string }` parameter. When provided, after trust-gating Tier-2 citations, require at least one trusted URL to contain `num/year` (or `num-year`, `num_year`, `num%2fyear`). If not, **discard Tier-2** and keep Tier-1 (which was empty → caller falls back as before). Log a new telemetry field `docket_anchor_ok`.

Extract `urlContainsDocket` from `citation-refill/index.ts` into `_shared/trustedHosts.ts` so both functions use the same matcher.

Threading: the case-number path (~L1219) already has `fullCaseRef`; parse the docket once and pass it into the helper.

### B. Party-source agreement check (kills 5819/24 contamination)

After the model returns party names for a case-number lookup, run a cheap server-side check:
- Take the docket-anchored URL (the trusted citation whose URL contains the input docket).
- Fetch the page snippet that Perplexity already returned in `search_results[].snippet` for THAT URL (no extra HTTP — it's in the response).
- Verify the model's `party1` OR `party2` appears (substring, whitespace-normalized) in either the title or snippet of the anchored result.
- If neither party appears in the anchored source's title/snippet, mark the result as **unverified**: keep the docket, drop the parties (`[חסר: שמות צדדים]`), and log `party_mismatch=true`.

This is the same pattern the stack-overflow note suggests: cross-validate the extracted parties against the source text where the docket actually appears.

### C. Sanity-check the פ"ד-publication verification override (~L1219 area, "Verification found פד\"י")

Before accepting an `isPublished=true` override, require:
- `padi_volume` is in `PADI_VOLUME_YEAR_RANGES` (already in the file at L169).
- The case's decision year falls within that volume's plausible window (with the existing generous ±2y).
- At least one trusted citation URL contains the docket (reuse the helper from A).

If any check fails: discard the override, keep `isPublished=false`, log `padi_override_rejected` with the reason. This kills the `מב/4/868` for 2024 hallucination.

### D. Telemetry

Add to the existing `[case-law]` log line: `docket_anchor_ok`, `party_mismatch`, `padi_override_rejected`. No new env var; the existing `CITATION_CHAT_OPENWEB_FALLBACK=on` flag remains the master switch.

## Out of scope

- No prompt rewrites. The model is already told to use the exact docket; the fix is server-side verification, not better prompting.
- No new HTTP fetches. We use only the `search_results[]` snippets Perplexity already returns.
- `citation-refill` is unchanged — it already has the docket-anchor gate.

## Rollback

Unset `CITATION_CHAT_OPENWEB_FALLBACK` — Tier-1-only behavior is preserved. The party-agreement check and פ"ד sanity check are cheap and safe to keep on unconditionally, but I can gate them behind a second flag if you prefer.
