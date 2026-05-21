
## Root cause

`enrichBareReporterCitation()` simply forwards hints to `buildCitationForSource()`, which calls `resolveCitation()` **without** `partyLookupRetry: true`. The placeholder-emission and `fullDate`-relaxation policies inside `citationResolver.ts` (lines 522–608) are gated on that flag — so when Pass B recovers `{docket, party1, party2}` but no `fullDate`/`year`, the resolver returns `needs_party_lookup` / `missing_required`, `buildCitationForSource` falls back to `passthroughCitation()` (which returns the original bare reporter text like `פ"ד מט(4) 221`), the bare-reporter gate at line 304 re-fires, `failed_bare_reporter` is re-added, and runCore logs `rebuild_still_bare`.

In other words: Pass B is finding the parties, but the resolver path inside the *enrichment* call still behaves like a first-pass strict call, so the recovered fields never make it into a canonical string.

## Fix scope (narrow — only the enrichment path)

Files touched:
- `supabase/functions/legal-qa/core/citations.ts` — add an enrichment-mode flag, route resolver to retry policy, add safety-net manual emission.
- `supabase/functions/legal-qa/core/runCore.ts` — pass the flag from all four enrichment passes; add the requested telemetry fields.
- `supabase/functions/legal-qa/core/types.ts` — extend the `EnrichAttempt` shape if needed for the new telemetry fields.

Explicitly **not** touched: Planner, Retrieval, Verifier, Ledger, Drafter, BatchFootnoteBuilder, FootnoteReviewCard, citation-chat, src/components/**, partyLookup prompt, citationResolver.ts (we only flip the flag it already supports).

## Changes

### 1. `citations.ts` — `BuildCitationHints` + `buildCitationForSource`

- Add `enrichmentRetry?: boolean` to `BuildCitationHints`.
- When `hints.enrichmentRetry === true`, pass `partyLookupRetry: true` into `resolveCitation(...)`. This activates the existing placeholder-emission path (`[חסר: שנה]`, `[חסר: תאריך מלא]`, etc.) and the relaxed-`fullDate` policy, so resolver returns `{resolved: true, placeholders: [...]}` instead of falling through to passthrough.
- After the resolver call, when `hints.enrichmentRetry` is true AND resolver still failed AND we have `caseNumber + party1 + party2` (from hints), **manually emit** a canonical line of the form `{prefix?} {docket} {party1} נ' {party2}.` (omit year/date — never invent them), set `canonical`, set `quality = "needs_review"`, push `partial_enriched` into `citation_errors`, and **do not push** `failed_bare_reporter`. This is the safety-net for the case where classify/extract loses parties on the second pass.
- The bare-reporter gate at line 304 still runs, but on an enriched canonical that now contains a docket prefix + `נ'` separator, so `isBareReporter()` returns false and `failed_bare_reporter` is no longer re-added.
- Return a side-channel debug object alongside (extend the function to also write to a `__lastResolverDebug` symbol, OR have it return a tuple via a sibling helper `enrichBareReporterCitationWithDebug()`). Pick the helper approach to avoid altering the existing return type for `buildCitationForSource()` callers.

### 2. `runCore.ts` — wire the flag and the telemetry

- In all four `enrichBareReporterCitation(ls, { ... })` call sites (Pass A metadata, Pass B text_regex, Pass C official_fetch, Pass D party_lookup), add `enrichmentRetry: true`.
- Switch each site to `enrichBareReporterCitationWithDebug(...)` to capture `{ input, resolverOutput, missingAfter }`.
- Extend the `EnrichAttempt` type with:
  - `enrichment_input_fields?: string[]` — which hint keys were non-empty going in.
  - `resolver_input_after_enrichment?: Record<string, string | undefined>` — the actual hint values sent.
  - `resolver_output?: { resolved: boolean; canonical?: string; placeholders?: string[]; citation_errors: string[] }`.
  - `missing_fields_after_enrichment?: string[]` — keys still missing after the enriched rebuild (year, fullDate, etc.).
  - Keep the existing `rejection_reason` field; when the safety-net manual emission fires, set it to `partial_enriched` (not `rebuild_still_bare`).
- Update the "recovered" calculation: `recovered = !fresh.citation_errors.includes("failed_bare_reporter")` stays correct, because the safety-net no longer pushes that error. `partial_enriched` results now count as recovered.
- Bump telemetry summary line at L699 to also print `partial_enriched=N`.

### 3. `types.ts`

Add the new optional fields to the `EnrichAttempt`-related export if it lives here (it currently appears inline in `runCore.ts`; lift only if needed for compile).

## Hard rules preserved

- No GPT/LLM call added; Pass B/C remain regex-only.
- No fabricated `year`/`fullDate`/`parties`/`docket` — safety-net manual emission writes only what was already in `hints`.
- Bare-reporter gate stays strict for first-pass calls (`enrichmentRetry` default false).
- `partyLookup` prompt untouched.
- Off-domain check, `journal_pipe`, source-type sanity checks all still run on the enriched canonical.

## Acceptance criteria (re-verified by smoke run)

- `enrichBareReporterCitation` given `{docket, party1, party2}` (with or without year) must NOT return `rejection_reason="rebuild_still_bare"`.
- `text_regex_recovered > 0` on S1/S4/S6/S8.
- Recovered citations appear in final answer as either full canonical (when year/date present) or `<prefix> <docket> P1 נ' P2.` / canonical with `[חסר: ...]` markers (when temporal anchor missing), classed `partial_enriched` / `needs_review`.
- Invariants from prior run still hold: 0 `answer=null`, 0 `[cite:LS#]` leftovers, 0 orphan superscripts, 0 `(ציטוט חסר)`, 0 bare-reporter footnotes shipped, 0 pipe artifacts, 0 raw `source_type` leaks.
- No hallucinated year/date in any footnote.

## Validation

1. Run `eval/_smoke10_v2.mjs` filtered to S1, S4, S6, S8 (add S7 if any of those still leak bare reporters).
2. Diff each affected attempt's new telemetry block (`enrichment_input_fields`, `resolver_output`, `missing_fields_after_enrichment`) against the prior run.
3. Report:
   - `text_regex_attempted` / `recovered`
   - `official_fetch_attempted` / `recovered` / `timeouts`
   - `party_lookup_attempted` / `hits` / `timeouts`
   - `bare_reporter_recovered` vs `bare_reporter_dropped`
   - `partial_enriched` count
   - `core_failed` count
   - Two before/after footnote examples per affected case.
4. If still bare on any S-case, inspect new telemetry to determine whether (a) Pass B regex missed parties, (b) resolver dropped them, or (c) safety-net was not triggered — and propose one targeted follow-up.

No other behavior changes.
