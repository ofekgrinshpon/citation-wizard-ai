# V2.1c default-switch — validation report

## Files changed

- `supabase/functions/legal-research-v1/index.ts`
  - Final drafter call in answer mode now invokes `runDrafterV2` (V2.1c).
  - Removed the `x-drafter-mode: v2_compare` smoke-only harness branch.
  - Added a shape adapter that builds the existing `drafterMeta` fields
    (`marker_validation`, `marker_format`, `omitted_candidate_ids`,
    `used_sources`) from the V2 result. V2-specific telemetry
    (`drafter_version: "v2.1c"`, `structured_validation`, `builder_report`,
    `schema_failure_reason`) is added additively under `metadata.drafter`.
  - `runDrafter` import is intentionally retained for easy revert.
- `scripts/legal-research-v1-v2.1c-default-validation.ts` (new) — triggers
  the live edge function with no special headers and asserts invariants on
  `metadata.drafter` (i.e. the shipped path).
- `reports/legal-research-v1-v2.1c-default-validation.json` — per-fixture
  raw metrics from this run.

No frontend, schema, retrieval, verifier, candidate-pool, Perplexity,
sources-only, footnoteBuilder, drafter prompt, or DB changes.

## Active drafter path (answer mode)

```
runVerifier → runDrafterV2 (V2.1c, structured blocks)
            → buildFootnotedAnswer (deterministic markers + footnotes)
            → drafterMeta adapter (shape-compat for frontend / telemetry)
            → writeTelemetry + jsonResponse
```

The legacy `runDrafter` (Markdown baseline with citation-cleanup phases)
remains in the repo and is still imported by `index.ts`, but is no longer
invoked on the answer path. **Revert** = change the `runDrafterV2(...)` call
at line 586 back to `runDrafter(...)`, drop the adapter block, and restore
`drafter.marker_validation` / `drafter.marker_format` / `drafter.omitted_candidate_ids`
direct passthrough. No DB or frontend changes are required for revert.

## Compatibility changes

Response shape unchanged for the frontend:

| Field | Before (baseline) | Now (V2.1c via adapter) |
|---|---|---|
| `answer` | `drafter.answer_markdown` | `drafterV2.answer_markdown` |
| `footnotes` | baseline footnotes | V2 footnotes (compound-aware) |
| `used_sources` | baseline used_sources | V2 used_sources |
| `marker_format` | `"legacy_superscript"` | `"superscript"` |
| `debug.drafter.marker_validation` | from baseline post-validator | synthesized (ok=true, no leaks, no repair — guaranteed by construction) |
| `debug.drafter.omitted_candidate_ids` | from baseline | computed: `usable \ used` |

V2-only fields (`drafter_version`, `structured_validation`, `builder_report`,
`schema_failure_reason`) are additive and ignored by the existing
`LegalResearchV1Panel` UI.

Baseline-only citation cleanup is **not** applied to V2 output — the V2
footnoteBuilder is deterministic, so there is no markdown post-processing
pass for the V2 path.

## Validation

Live edge function, 12 fixtures (L1–L6 + PROT + R03, R04, R09, R10, R18):

| Invariant | Result |
|---|---|
| app builds | ✅ (deploy succeeded; no TS errors) |
| all V2 ok | ✅ 12/12 |
| `drafter_version == "v2.1c"` everywhere | ✅ 12/12 |
| no stub answers | ✅ 12/12 |
| no unknown `source_refs` | ✅ 12/12 |
| no forbidden marker/superscript text from model | ✅ 12/12 |
| `used_sources ⊆ verifier.usable` | ✅ 12/12 |
| `builder.adjacent_marker_count == 0` | ✅ 12/12 |
| answer-text adjacent superscript runs == 0 | ✅ 12/12 |
| schema failures | 0 |
| sources_only path | unchanged (short-circuits before drafter) |

**Latency:** avg drafter `ms` = 38,773; avg total pipeline `ms` = 167,723 —
in line with prior V2 harness runs, no regression.

**Prose / citation profile (means across 12):** prose length 2,397 chars;
used_sources/fixture 8.17; sources per cited segment 2.26. No source-density
optimization was applied; numbers are consistent with the V2.1b harness
baseline.

## Acceptance — confirmed

- app builds ✅
- no TypeScript errors ✅
- V2 ok ✅
- no schema failures ✅
- no unknown source_refs ✅
- no forbidden marker/superscript text from model ✅
- used_sources ⊆ verifier.usable ✅
- footnotes render (compound-aware, deterministic) ✅
- no adjacent citation marker pathology (builder == 0, answer == 0) ✅
- no stub answers ✅
- sources_only unchanged ✅
- latency acceptable ✅

## Revert instructions

If V2.1c default proves bad in production:

1. In `supabase/functions/legal-research-v1/index.ts` (~line 586) change
   `runDrafterV2(` back to `runDrafter(`.
2. Remove the `marker_validation` / `omitted_candidate_ids` / adapter block
   and restore direct passthrough:
   ```ts
   marker_validation: drafter.marker_validation,
   marker_format: drafter.marker_format,
   omitted_candidate_ids: drafter.omitted_candidate_ids,
   internal_id_scrub: drafter.internal_id_scrub,
   ```
3. Drop the `drafter_version` / `structured_validation` / `builder_report` /
   `schema_failure_reason` fields from `drafterMeta`.
4. Redeploy `legal-research-v1`.

No DB migration, no frontend change, no config flag involved.
