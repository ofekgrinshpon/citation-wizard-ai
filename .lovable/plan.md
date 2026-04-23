

# Milestone C — Citation Engine for Perplexity Candidates

Confirmed scope guardrails:
- `src/data/citationEngine.ts` and `src/lib/citationValidation.ts` are **not modified, not imported, not symlinked**. Uniform-citation feature in the React app keeps working byte-identically.
- The Deno copy lives under `supabase/functions/_shared/` and is used **only by `legal-qa`**.
- Only Perplexity-completion candidates flow through the engine. Local corpus assembly is untouched.

## Goal

Replace the brittle `STATUTE_CITATION_RE` Guard 1 in Stage E.5 with the citation engine. A Perplexity candidate is accepted iff the engine can resolve it into a structured citation. When resolved, the engine's canonical re-emission becomes the citation string the drafter sees. When unresolved, the candidate is **kept** (Guards 1+2 already passed) but flagged `engine_resolved: false` and cited as-is.

## Files to add

### 1. `supabase/functions/_shared/citationEngine.ts` (new)
Verbatim copy of the data registry from `src/data/citationEngine.ts`:
- `GENERAL_RULES`, `CITATION_RULES`, `REPEATED_CITATION_RULES`, `PINPOINT_RULES` constants
- `CitationRuleSet`, `CitationComponent` interfaces
- Helper functions: `getRequiredFields`, `getFieldFormat`, `getFieldRule`, `validateCitation`

No React imports (the source file already has none). Pure Deno-compatible TS.

### 2. `supabase/functions/_shared/citationResolver.ts` (new)
Deno-only logic that does NOT exist in the React side:

```text
resolveCitation(candidateText, declaredType?) →
  | { resolved: true,  sourceType, fields, canonical, missingFields: [] }
  | { resolved: false, reason: 'classify_failed' | 'extract_failed' | 'missing_required', missingFields, partialFields }
```

Pipeline:
1. **Classify** — map Perplexity's `type` ("statute" | "caselaw") to engine source-type keys:
   - statute → try `basic_law` (regex: `חוק[-\s]יסוד`), else `secondary_legislation` (regex: `תקנות|צו|כללי`), else `primary_legislation`
   - caselaw → try `case_law_published` (regex: `פ["״]ד|פד["״]ע`), else `case_law_database`
2. **Extract** — port the field extractors from `src/lib/citationValidation.ts:extractFieldsFromResponse` for the 5 source types above only. Keep the regex behavior identical.
3. **Validate** — call ported `validateCitation(sourceType, fields)`. Resolution succeeds when zero required fields are missing.
4. **Emit canonical** — interpolate `ruleSet.template` with extracted field values to produce a normalized citation string. For example template `{lawName}, {hebrewYear}-{gregorianYear}, {collection} {firstPage}.` → `חוק העונשין, התשל"ז-1977, ס"ח 226.`

## Files to modify

### `supabase/functions/legal-qa/index.ts`

**Remove** lines 91–96 statute regex. Keep `CASE_NUMBER_RE` for now (engine handles it but we'll keep the cheap pre-check to fail fast on garbage).

**Replace** `validatePerplexityCandidate` (lines 126–152). New logic:

```text
1. Guard 1 (URL allowlist) — unchanged, runs first now.
2. Guard 2 (engine resolution) — call resolveCitation(c.citation, c.type).
   - If resolved: candidate.citation = canonical; engine_resolved = true.
   - If unresolved: candidate.engine_resolved = false; candidate.engine_drop_reason = reason.
   - Either way, accept (we already trust the URL domain).
3. Drop only on completely unknown type or missing URL.
```

**Extend** `ValidatedCompletionCandidate` with two fields: `engine_resolved: boolean` and `engine_drop_reason?: string`.

**Update** Stage E.5 SourceCard creation (line 2582) to use the canonical `v.citation` (already overwritten above) and pass `engine_resolved` into the `SourceCard` and `sourcePack` entry as a metadata flag (drafter prompt does not change — it sees the citation string the same way).

**Update** telemetry block (line 2613). Add to `retrievalFunnel.perplexity_completion`:
- `engine_resolved_count`
- `engine_unresolved_count`
- `engine_drop_reasons: Record<string, number>` (counts of `classify_failed` / `extract_failed` / `missing_required`)

This replaces the previous `drops` shape for engine outcomes; URL drops keep their own counter.

## Files to add (memory)

### `.lovable/memory/logic/legal-qa/citation-engine-perplexity-resolver.md` (new)
Documents:
- Two-stage pipeline: URL allowlist → engine resolve.
- Engine resolution is **non-blocking**: unresolved candidates are kept with `engine_resolved=false`.
- Deno engine copy is independent from React copy. Any rule changes must be ported manually (no auto-sync). When the user asks to update citation rules, both files need to change.
- Scope: Perplexity candidates only. Local corpus is not piped through the engine yet (Milestone D).

## Files NOT touched

- `src/data/citationEngine.ts` ✋
- `src/lib/citationValidation.ts` ✋
- All `src/components/**`, `src/pages/**`, `src/hooks/**` ✋

## Validation plan

After deploy:
1. Run `eval/stability-v7.12-run.mjs` (18 questions). Compare against last run:
   - `engine_resolved_count` per question
   - `engine_unresolved_count` and breakdown of reasons
   - `candidates_kept` should now equal `candidates_returned − url_dropped` (engine never drops)
   - Final anchored citations in body — should not regress
2. Spot-check 3 statute candidates that previously failed `statute_citation_shape` (e.g., `חוק חופש המידע, התשנ"ח-1998`). Confirm they now resolve with `primary_legislation` template, canonical form matches input.

## Technical notes

- The engine is pure data + 4 helpers, ~820 lines. No runtime cost concerns.
- Template interpolation handles missing optional fields by leaving the placeholder empty and collapsing surrounding whitespace/punctuation (e.g., `{specificPage}` empty → no trailing comma).
- For caselaw, `case_law_published` requires `series`/`volume`/`firstPage`; if Perplexity returns only `case_number` without these, classification falls back to `case_law_database` which only requires database name + date — much higher resolution rate.
- `engine_resolved=false` candidates retain the raw Perplexity citation string. Drafter behavior is unchanged (it never knew about the flag).

