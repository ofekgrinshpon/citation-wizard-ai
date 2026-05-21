
## Goal

Centralize all per-source citation work inside a single **Core-only Citation Enrichment layer**. The citation engine stays the sole formatter. Enrichment's only job is to assemble the richest possible structured input from a verified `LedgerSource` and hand it to the engine. Manual emission becomes a true last-resort `partial_enriched` path.

## Architecture

```text
LedgerSource (verified)
    │
    ▼
[citationEnrichment.ts]  ← NEW, Core-only, no LLM
    1. collectFields(ls)            // title, citation, snippet, url, metadata,
    │                                // source_type, origin, reporter, section, docket, pinpoint
    2. normalizeSourceType(ls)      // reuse existing helper
    3. extractStructured(ls, recovered)  // source-type-aware regex extractors
    │                                    // merged with per-pass `recovered` hints
    4. callEngine(parts)            // resolveCitation via buildCitationForSource
    │                                // enrichmentRetry=true → engine's placeholder path
    5. manualPartialEmit(parts)     // ONLY if engine failed AND verified
    │                                // (docket+parties | lawName+collection) exist
    ▼
Citation { canonical, quality, citation_errors[], debug }
    │
    ▼
CitationQualityPass (unchanged)
```

## Files

### New: `supabase/functions/legal-qa/core/citationEnrichment.ts`
- Owns the full flow above.
- Exports:
  - `RecoveredFields` — per-pass hint shape (docket, party1, party2, year, fullDate, lawName, hebrewYear, gregorianYear, collection, firstPage, …)
  - `EnrichmentInput` — `{ ls, recovered?, passLabel }`
  - `EnrichmentOutput` — `{ citation, debug: { input_fields, resolver_input, resolver_output, missing_after, path: "engine" | "manual_partial" | "engine_unresolved" } }`
  - `enrichLedgerSource(input): EnrichmentOutput`
- Internal helpers (private to this file): `collectFields`, `extractStructured` (source-type-aware regex set lifted from current `citations.ts` first-pass), `manualPartialEmit`.
- No GPT/LLM calls. No fabricated fields — manual emit writes only values already present in the merged parts.

### Refactor: `supabase/functions/legal-qa/core/citations.ts`
- Keep `buildCitationForSource` strictly as **engine adapter**: take prepared hints → `resolveCitation` → post-resolver gates (bare-reporter, off-domain, pipe artifacts, source_type sanity).
- Remove the inline "safety-net manual emission" block (current L352–388); that responsibility moves to `manualPartialEmit` in the new layer.
- Remove first-pass field-extraction code that duplicates `extractStructured` and move it into the new layer.
- Remove exports: `enrichBareReporterCitation`, `enrichBareReporterCitationWithDebug` (callers switch to `enrichLedgerSource`).
- Keep `buildCitationsForLedger` as a thin bulk wrapper that calls `enrichLedgerSource(ls, { passLabel: "initial" })` per source.

### Refactor: `supabase/functions/legal-qa/core/runCore.ts`
- All four enrichment passes (A metadata, B text_regex, C official_fetch, D party_lookup) stop calling the engine directly. Each pass:
  1. Computes a `RecoveredFields` object from its own evidence.
  2. Calls `enrichLedgerSource(ls, { recovered, passLabel })`.
  3. Records telemetry from `EnrichmentOutput.debug`.
- Telemetry counters keep their existing names: `bare_reporter_recovered`, `bare_reporter_dropped`, `partial_enriched`, `core_failed`, plus the per-pass counts. A new field `enrichment_path` (`engine` | `manual_partial` | `engine_unresolved`) is added per attempt.

### Types: `supabase/functions/legal-qa/core/types.ts`
- Lift the inline `EnrichAttempt` shape so the new layer can import it.
- Add fields: `enrichment_input_fields`, `resolver_input`, `resolver_output`, `missing_after`, `enrichment_path`.

## Not changed

- `supabase/functions/_shared/citationResolver.ts`
- `supabase/functions/_shared/citationEngine.ts`
- `supabase/functions/_shared/partyLookup.ts`
- `supabase/functions/legal-qa/core/officialSourceFetcher.ts`
- Planner, Verifier, Ledger, Drafter, BatchFootnoteBuilder
- `supabase/functions/citation-chat`
- All `src/components/**`, all `src/data/citationEngine.ts` (React copy)
- `prompts.ts` (drafter contract is unchanged)

## Hard rules preserved

- Engine is the only formatter when sufficient structured fields exist.
- No GPT in the enrichment layer; regex + structured metadata only.
- No fabricated `year` / `fullDate` / `parties` / `docket` — `manualPartialEmit` only writes verified values already in the merged parts.
- `partial_enriched` is last-resort: fires only when engine returned unresolved AND verified minimum fields are present (caselaw: docket+party1+party2; legislation: lawName+collection).
- Bare-reporter / off-domain / pipe-artifact gates run on the engine's canonical output, same as today.

## Telemetry / acceptance for the smoke run

Per attempt:
- `enrichment_path`: `engine` | `manual_partial` | `engine_unresolved`
- `enrichment_input_fields`: keys present going in
- `resolver_output`: `{ resolved, canonical?, placeholders?, citation_errors[] }`
- `missing_after`: keys still missing post-resolver

Aggregate must hold:
- 0 `answer=null`, 0 `[cite:LS#]` leftovers, 0 orphan superscripts, 0 `(ציטוט חסר)`, 0 bare-reporter footnotes shipped
- `core_failed` does not regress vs. previous run
- S6/S7/S8 citation grades remain at or above previous run
- `manual_partial` count ≤ previous `partial_enriched` count (engine should now handle more cases via placeholders)

## Validation

1. Type-check edge functions.
2. Run `eval/_smoke10_v2.mjs` (all 10).
3. Report per attempt: `enrichment_path`, before/after canonical, and the aggregate counters above.
4. Diff `engine` vs `manual_partial` distribution against the prior run.
