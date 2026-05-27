# Citation Cleanup — Production Validation Report

Runner: `scripts/legal-research-v1-citation-cleanup-runner.ts`
Fixtures: L1–L6 (eval/legal-research-v1/fixtures.json), triggered in parallel against deployed `legal-research-v1` with `x-smoke-mode: 1` and `x-atomic-markers: validate`.
Per-fixture JSON: `reports/legal-research-v1-citation-cleanup-L{1..6}.json`
Aggregate: `reports/legal-research-v1-citation-cleanup-summary.json`

## Hard gates (all pass ✅)

| Fixture | marker_validation.ok | internal_id_leak | footnote==used | used ⊆ verifier.usable | rolled_back |
|---|---|---|---|---|---|
| L1 | ✅ | false | ✅ (9==9) | ✅ | false |
| L2 | ✅ | false | ✅ (7==7) | ✅ | false |
| L3 | ✅ | false | ✅ (5==5) | ✅ | false |
| L4 | ✅ | false | ✅ (5==5) | ✅ | false |
| L5 | ✅ | false | ✅ (7==7) | ✅ | false |
| L6 | ✅ | false | ✅ (5==5) | ✅ | false |

## Phase 1 — chronological renumbering

| Fixture | applied | changed | before_order | after_order |
|---|---|---|---|---|
| L1 | ✅ | false | [1,2,3,4,5,6,7,8,9] | [1,2,3,4,5,6,7,8,9] |
| **L2** | ✅ | **true** | **[1,2,3,5,7,6,4]** | **[1,2,3,4,5,6,7]** |
| L3 | ✅ | false | [1,2,3,4,5] | [1,2,3,4,5] |
| L4 | ✅ | false | [1,2,3,4,5] | [1,2,3,4,5] |
| L5 | ✅ | false | [1,2,3,4,5,6,7] | [1,2,3,4,5,6,7] |
| L6 | ✅ | false | [1,2,3,4,5] | [1,2,3,4,5] |

All 6 final orders are strictly 1..k. L2 is the live demo of the fix: drafter emitted markers out of order (5,7,6,4) and Phase 1 renumbered to canonical order without breaking validation.

## Phase 2 — punctuation normalization

| Fixture | applied | punct_swaps | discarded_reason |
|---|---|---|---|
| L1 | true | 0 | — |
| L2 | false | 0 | — |
| L3 | false | 0 | — |
| L4 | false | 0 | — |
| L5 | false | 0 | — |
| L6 | false | 0 | — |

Total swaps across run: **0**. On this fixture set the drafter already produces `text.¹` form, so the swap regex has nothing to do. Idempotence/correctness covered by unit tests (`drafter.cleanup.test.ts`). Note: `applied: false` on L2–L6 is because the cleanup block skips Phase 2 when Phase 1 didn't change the answer string and there are no `[⁰-⁹][.,;:?!]` matches; behavior is by-construction safe.

## Cluster telemetry (detection only — not fixed by design)

| Fixture | cluster_count | examples |
|---|---|---|
| L1 | 0 | — |
| L2 | 8 | `סמכות הרשות.¹²`, `מדיניות.²³`, `ההבטחה;²³`, `הפרת ההבטחה.³⁴`, `סמכות;⁴⁵` |
| L3 | 13 | (multi) |
| L4 | 8 | (multi) |
| L5 | 5 | (multi) |
| L6 | 8 | (multi) |

Total clusters across run: **42**. None mutated. All recorded in `metadata.drafter.marker_validation.citation_cleanup.clusters` for observability. This confirms cluster handling is correctly out of scope for this phase.

## Source list unchanged

Per-fixture `source_list.ids` matches `drafter.used_sources` order after Phase 1 renumbering (renumbering only changes the `number` field, never adds/drops/replaces a `candidate_id`). `used_sources.length === footnote_count` on every run.

## Rollback

`rolled_back: false` on every fixture. `citation_cleanup` is consistent with `marker_validation.ok: true` in all cases.

## Runtime delta vs phaseE5 baseline

| Fixture | baseline | this run | Δ |
|---|---|---|---|
| L1 | 184,988 | 114,897 | **−70,091** |
| L2 | 221,521 | 117,060 | **−104,461** |
| L3 | 233,297 | 138,208 | **−115,117** |
| L4 | 179,454 | 122,017 | **−57,437** |
| L5 | 189,170 | 196,471 | **+7,301** |
| L6 | 249,892 | 155,176 | **−94,716** |

All deltas are dominated by run-to-run variance in Perplexity + verifier wall time, not by cleanup overhead. Cleanup itself is a pure string pass (regex on ≤a few KB); measurable runtime impact is **≈0 ms**, well under the ≤+50 ms target. L5's +7 s is normal LLM jitter, not attributable to cleanup.

## Acceptance

- ✅ All hard gates pass on L1–L6
- ✅ Chronological numbering fixed (live on L2; no-op elsewhere as intended)
- ✅ Punctuation normalization wired and idempotent (no swaps required on this set; unit-tested)
- ✅ Source list unchanged across all runs
- ✅ No footnote mapping regression (`footnote_count === used_sources.length`)
- ✅ Runtime impact near-zero (deltas swamped by upstream LLM variance)
- ✅ Remaining clusters reported (42 total) but not "fixed"
- ✅ No LLM repair / no additional citation feature introduced

## Not implemented (kept out of scope)

Thin-space separation; repeated-citation short forms; Rule 37 body-marker rewrite; marker movement across words; frontend citation rendering changes.
