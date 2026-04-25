## Decision

Stage 2 (Perplexity party-lookup fallback) is **wired and honest** but the after4c failure mix is 1-1-1 across `no_candidates` / `no_match` / `retry_still_unresolved`. No single bucket dominates, so we do **not** open a broad Stage 2 tuning loop.

The only defensible narrow move is **Bucket 3** — it is a validation policy decision, not external tuning, and it has zero risk of contaminating the source corpus.

## Scope of this change (very small)

In `supabase/functions/_shared/citationResolver.ts` (or the equivalent validation step that calls `validateCitation` from `citationEngine.ts`), relax the `case_law_database` required-field check **only** under all of the following conditions:

1. The citation arrived via the Stage 2 `needs_party_lookup` path (i.e. party names were just recovered by `lookupPartyNames`).
2. `caseType`, `caseNumber`, `party1`, `party2` are all present and non-empty.
3. Either `year` or `fullDate` is present (so the citation still carries a temporal anchor — just not necessarily `dd.mm.yyyy`).

When all three hold, treat `fullDate` as optional and re-emit the canonical citation using whichever of `fullDate` / `year` is available. If only `year` is present, the engine template should fall back to `(year)` form rather than `(פורסם ב{database}, {fullDate})`.

If any of the three conditions fails, behavior is unchanged — the citation still drops as `missing_required`.

## What this is NOT

- Not a general relaxation of `case_law_database` validation for all sources.
- Not a change to `case_law_published` (Rule 18) requirements.
- Not a change to Perplexity domain filtering, prompt, or matching logic.
- Not a change to Stage 1 bare-docket recognition.
- Not ported to the React-side `src/data/citationEngine.ts` — this is a Stage 2 post-lookup policy that only exists in the Deno resolver path.

## Telemetry

Add one new counter to the existing `chapterPartyLookup` aggregator in `supabase/functions/legal-qa/index.ts`:

- `recovered_without_full_date` — incremented when a Stage 2 lookup succeeds and the citation is accepted under the relaxed rule.

This keeps the relaxation observable in `qa_logs.metadata.chapter_engine.party_lookup` so we can tell, after the next eval, whether the relaxation is doing real work or sitting idle.

## Validation step

Re-run `eval/academic-chapter-q1-q3.mjs` as `after4d` and confirm:

- The 1/3 Bucket 3 case from after4c now resolves.
- Buckets 1 and 2 are unchanged (still failing — that is expected).
- No new false positives in Q2/Q3 (statutes are untouched, but worth confirming the chapter_engine totals don't regress).

## What we explicitly defer

- Bucket 1 (no candidates) — would need domain/prompt tuning. Defer.
- Bucket 2 (no match) — would need docket-normalization relaxation. Defer.
- Both can be revisited later if real-world chapters show one of them dominating, but the after4c sample is too small to justify either now.

## Statutes

Unchanged. Remaining statute failures are still treated as a source-card enrichment problem, not a resolver problem.
