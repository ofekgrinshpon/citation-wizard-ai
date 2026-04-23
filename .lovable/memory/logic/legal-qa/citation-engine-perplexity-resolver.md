---
name: Citation Engine — Perplexity Resolver (Milestone C)
description: Stage E.5 Guard 2 replaced with Deno-only citation engine port; resolves Perplexity-completion candidates into canonical citations, non-blocking on failure
type: feature
---

Milestone C replaces the brittle `STATUTE_CITATION_RE` regex (Guard 1) for Stage E.5 Perplexity-completion candidates with a structured **citation engine resolution**. A candidate now passes through TWO guards:

1. **Guard 1 — URL allowlist** (`isTrustedLegalUrl`, unchanged). Runs FIRST. Drops the candidate if the URL is missing or its host isn't in `TRUSTED_LEGAL_DOMAINS`.
2. **Guard 2 — Engine resolution** (`resolveCitation` in `supabase/functions/_shared/citationResolver.ts`). Tries to classify + extract fields + validate against the engine's required-field schema, then re-emit a canonical citation string from the engine template.

**Engine resolution is NON-BLOCKING.** If the engine cannot resolve a candidate, the candidate is **kept** (URL allowlist already vouched for the source) but flagged `engine_resolved: false` with a `engine_drop_reason`. The drafter sees the raw Perplexity citation string in that case. Drop reasons: `classify_failed`, `extract_failed`, `missing_required`.

When the engine resolves successfully, the **canonical re-emission replaces the raw Perplexity citation** before it reaches `SourceCard` / `sourcePack`. The drafter prompt is unchanged — it only sees the resulting citation string.

### Files

- `supabase/functions/_shared/citationEngine.ts` — Deno port of the registry data + 4 helpers (`getRequiredFields`, `getFieldFormat`, `getFieldRule`, `validateCitation`). Currently includes only the 5 source types used by Perplexity (`primary_legislation`, `basic_law`, `secondary_legislation`, `case_law_published`, `case_law_database`).
- `supabase/functions/_shared/citationResolver.ts` — Deno-only `resolveCitation(text, declaredType, opts)` API. Does not exist on the React side.
- `supabase/functions/legal-qa/index.ts` — `validatePerplexityCandidate` calls `resolveCitation` after `isTrustedLegalUrl`. `ValidatedCompletionCandidate` extended with `engine_resolved` + `engine_drop_reason`. Stage E.5 telemetry block adds `engine_resolved_count`, `engine_unresolved_count`, `engine_drop_reasons`.

### Independence from the React engine

The React app (`src/data/citationEngine.ts` + `src/lib/citationValidation.ts`) is **NOT modified, NOT imported, NOT symlinked**. The Deno copy is a standalone, byte-independent fork. **Any rule changes must be ported manually to BOTH sides** — there is no auto-sync. When the user asks to update citation rules, both files need to change.

### Scope

Perplexity-completion candidates ONLY. Local corpus assembly is untouched in Milestone C. Future Milestone D may pipe local sources through the resolver as well (TBD).

### Telemetry

`qa_logs.metadata.retrieval_funnel.perplexity_completion` now includes:
- `engine_resolved_count`, `engine_unresolved_count`
- `engine_drop_reasons: { classify_failed, extract_failed, missing_required }`
- `candidates_kept` should now equal `candidates_returned − url_dropped` (engine never drops by itself).
