
## Goal

Collapse the legal-research-v1 citation pipeline back to the simple, deterministic core that proved effective. Everything else listed below is deleted — no flags, no dead branches, no "maybe later" code.

Out of scope (must not change): retrieval, perplexity, verifier, candidate pool, source selection, sources-only mode, frontend, DB schema, drafter legal/style prompt (except keeping the already-approved final-summary dump rule already in `SYSTEM_PROMPT`).

## Resulting runtime path

```text
drafter (gpt-5-mini → escalate gpt-5)
  → applyCitationCleanup (Phase 1 chronological renumber + Phase 2 punct normalization + cluster telemetry)
  → runMarkerValidation
  → validatePlacement (telemetry only: cluster_count, cluster_run_count, max_cluster_len, end_paragraph_dump_count, final_summary_dump)
  → response
```

No retry. No quality gate. No occurrence footnotes. No compound footnotes. No atomic/tokenized marker pass. No controlled-failure response for citation quality.

## File changes

### Delete

- `supabase/functions/legal-research-v1/stages/qualityGate.ts`
- `scripts/legal-research-v1-quality-gate-runner.ts`
- `scripts/legal-research-v1-compound-runner.ts`
- `scripts/legal-research-v1-occurrence-footnotes-runner.ts`
- `scripts/legal-research-v1-occurrence-footnotes-targeted.ts`
- `scripts/legal-research-v1-p7-phaseD-runner.ts` (atomic / marker-boundary v2 runner)

Reports under `reports/legal-research-v1-{quality-gate,compound,occurrence-footnotes,occurrence-footnotes-targeted,p7-phaseC*,p7-phaseD*}-*.json` are historical artifacts and stay on disk; they are not in the runtime path.

### Edit — `supabase/functions/legal-research-v1/index.ts`

- Remove the `qualityGate.ts` import (lines ~21–26) and `QualityGateEvaluation` type usage.
- Remove the `x-atomic-markers` header handling and `atomicMode` plumbing (lines ~192–200, and the `atomicMode` argument passed to `runDrafter` at line ~600 and ~642).
- Replace the entire post-drafter block (lines ~604–725) with a single `const drafter = await runDrafter(...)` call followed by direct use of `drafter.answer_markdown` / `drafter.footnotes` / `drafter.used_sources`.
- Remove `qualityGateMeta`, `drafterRetry`, `extra_drafter_ms`, `final_action`, `source_set_equal_on_retry`, `retry_attempted`, `retry_passed`, `isControlledFailure`, and the `answer_quality_gate_failed` response branch.
- In `drafterMeta` remove `atomic: drafter.atomic`.
- In telemetry `metadata` remove `quality_gate` and `quality_gate_drafter_initial`.
- In the success-response `debug` block remove `quality_gate`.

### Edit — `supabase/functions/legal-research-v1/stages/drafter.ts`

Strip the file down to: helpers (superscript extraction, `detectInternalIdLeak`, `scrubInternalClaimLabels`, `SYSTEM_PROMPT` unchanged, `buildInputSources`, `buildUserMessage`, `validateDraftShape`, `runMarkerValidation`, `deterministicRepair`, `validatePlacement`, `applyCitationCleanup`, `runDrafter`).

Remove:

- Atomic helpers and types: `ATOMIC_RE`, `extractAtomicMarkers`, `normalizeToAtomic`, `validateAtomicMarkers`, `AtomicReport`/`AtomicMode` imports, the `atomicMode`/`extraSystemSuffix` parameters on `runDrafter`, and the entire "Phase D atomic marker validation" block at the end of `runDrafter` (lines ~1859–1893). `marker_format` stays as the constant `"legacy_superscript"`.
- Phase 3 occurrence-footnote machinery in full: `applyOccurrenceFootnotes`, `tokenizeSuperscripts`, `renderMarkersToSuperscripts`, `hasAdjacentTokens`, `FN_TOKEN_RE`, `enumerateValidSplits`, `Phase3Result`, `Phase3SourceLike`, `ADJACENT_SUP_RE`, `stripSup`, `shortenTitle`, the `assertNoTokenLeak` guard, and the Phase 3 block inside `runDrafter` (lines ~1776–1842).
- The `extraSystemSuffix` system-prompt branch — `systemPrompt` becomes just `SYSTEM_PROMPT`.
- All references to `is_compound`, `source_numbers`, `items`, `is_short_form`, `short_form_kind`, `back_ref_number`, `source_candidate_id`, `occurrence_mode`, ibid/supra rendering.

Keep `applyCitationCleanup` exactly as today minus any later patching by Phase 3 (Phase 1 + Phase 2 + cluster telemetry already stand alone). Keep `validatePlacement` and the placement telemetry fields the user listed.

### Edit — `supabase/functions/legal-research-v1/lib/types.ts`

- Delete `FootnoteItem` interface.
- `Footnote`: remove `source_number`, `is_short_form`, `short_form_kind`, `back_ref_number`, `source_candidate_id`, `is_compound`, `source_numbers`, `items`. Keep `number`, `title`, `url`, `source_type`.
- Delete `AtomicMode`, `AtomicReport`. Keep `MarkerFormat = "legacy_superscript"`.
- `CitationCleanupReport`: delete the entire `phase3?` block. Keep `phase1`, `phase2`, `clusters`.
- `MarkerValidation`: remove `occurrence_mode`, `occurrence_count`, `unique_source_count`, `short_form_count`, `ibid_count`, `supra_count`, `every_marker_has_footnote`, `every_footnote_in_usable`, `no_adjacent_marker_clusters`, `multi_digit_marker_runs_count`, `multi_digit_runs_from_single_token_count`, `every_multi_digit_run_from_single_token`, `token_model_ok`. Keep `ok`, `markers_in_answer`, `unused_sources`, `missing_sources`, `internal_id_leak`, `leaked_tokens`, `repaired`, `error`, `placement`, `citation_cleanup`.
- `PlacementReport`: unchanged (those are the telemetry fields we keep).
- No `QualityGateReport` — it was only defined inline in `qualityGate.ts`, which is deleted.

### Edit — `supabase/functions/legal-research-v1/stages/drafter.cleanup.test.ts`

Delete every test block that references `applyOccurrenceFootnotes`, `shortenTitle`, compound, ibid/supra, Phase 3 v2/v3 (lines ~101–end). Keep the Phase 1 / Phase 2 / cluster-telemetry / placement tests.

## Env flags removed (no callers remain)

- `LRV1_QUALITY_GATE`
- `LEGAL_RESEARCH_V1_OCCURRENCE_FOOTNOTES`
- `PHASE3_COMPOUND_ENABLED`
- `LEGAL_RESEARCH_V1_ATOMIC_MARKERS`

`grep` will confirm zero remaining references in `supabase/functions/legal-research-v1/`.

## Validation after cleanup

1. `deno check` / project typecheck must be clean across `supabase/functions/legal-research-v1/**`.
2. `rg "qualityGate|applyOccurrenceFootnotes|is_compound|AtomicReport|atomicMode|LRV1_QUALITY_GATE|PHASE3_COMPOUND|OCCURRENCE_FOOTNOTES|ATOMIC_MARKERS" supabase src` returns nothing in runtime code.
3. Add a thin runner `scripts/legal-research-v1-cleanup-validation-runner.ts` that drives L1–L6 + PROT and writes `reports/legal-research-v1-cleanup-*.json`. For each fixture verify:
   - `marker_validation.ok === true`
   - `marker_validation.internal_id_leak === false`
   - `used_sources ⊆ verifier.usable`
   - `footnotes.length === used_sources.length`
   - answer is non-empty and is not `STUB_ANSWER`
   - `metadata.drafter.marker_validation.citation_cleanup.phase1.applied === true`
   - `metadata.drafter.marker_validation.citation_cleanup.phase2` populated
   - `metadata.drafter.marker_validation.placement` carries `cluster_count`, `cluster_run_count`, `max_cluster_len`, `end_paragraph_dump_count`, `final_summary_dump`
   - no `quality_gate`, no `atomic` keys anywhere in the response
   - `total_ms` not worse than the last `compound` baseline for the same fixture
4. Sources-only smoke: one `mode: "sources_only"` call to confirm that path is untouched.

## Report after validation (stop point)

- Files deleted / edited.
- Removed env flags.
- Removed types / functions / tests.
- Final citation pipeline diagram.
- L1–L6 + PROT table: `marker_ok`, `internal_id_leak`, `footnote_count`, `used_sources_count`, `cluster_count`, `cluster_run_count`, `max_cluster_len`, `end_paragraph_dump_count`, `final_summary_dump`, `total_ms`, delta vs baseline.
- Any regression flagged; otherwise "none".

Stop after the validation report.
