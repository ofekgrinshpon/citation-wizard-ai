---
name: Party-Lookup fullDate Relaxation (Stage 2 retry policy)
description: case_law_database fullDate is optional ONLY on the partyLookupRetry pass when caseType + caseNumber + party1 + party2 + (year || fullDate) are all present
type: feature
---

After Stage 2 of the caselaw v4 work (Perplexity party-name backfill for bare-docket citations), the after4c eval surfaced a 1-1-1 failure mix across `no_candidates` / `no_match` / `retry_still_unresolved`. The third bucket — citations where Perplexity successfully returned parties but no `dd.mm.yyyy` decision date — was a pure validation policy issue, not an external-search issue.

### Policy

`supabase/functions/_shared/citationResolver.ts` accepts a new `partyLookupRetry: boolean` option on `ResolveCitationOptions`. When set to `true`, AND the source type is `case_law_database`, AND `caseType + caseNumber + party1 + party2` are all present, AND at least one of `year` / `fullDate` survived, the resolver removes `fullDate` from the required-field set and emits a fallback canonical:

- `(year)` form when only year is available: `{caseType} {caseNumber} {party1} נ' {party2} ({year}).`
- The standard `(פורסם ב{database}, {fullDate})` form when fullDate IS present (no relaxation needed).

If any precondition fails, behavior is unchanged — citation still drops as `missing_required` or `needs_party_lookup`.

### Scope

- ONLY `case_law_database`. `case_law_published` (Rule 18) requires `series + volume + firstPage` and is NOT relaxed.
- ONLY on the explicit retry pass. First-pass `resolveCitation` calls are unaffected.
- ONLY in the Deno resolver. The React side `src/data/citationEngine.ts` is NOT updated — this is a Stage 2 chapter-loop policy, not a general engine rule.

### Plumbing

- `RouteOptions` in `supabase/functions/_shared/chapterCitationRouter.ts` gained `partyLookupRetry?: boolean` and forwards it as-is to `resolveCitation`.
- `supabase/functions/legal-qa/index.ts` sets `partyLookupRetry: true` on the retry call inside the chapter loop's Stage 2 block (after `lookupPartyNames` returns hits).
- The aggregator now tracks `recovered_without_full_date` so the relaxation is observable in `qa_logs.metadata.chapter_engine.party_lookup`. A non-zero counter means the relaxation is doing real work; zero means the relaxation is wired but idle.

### Why this is narrow

The 1-1-1 after4c mix had no dominant bucket, so a broad Stage 2 tuning loop (widen domains, loosen prompt, relax docket normalization) would not be justified. Bucket 3 is the only one where the lookup itself succeeded — relaxing one validation field for that exact case has zero risk of corpus contamination and adds at most one canonical citation per chapter.
