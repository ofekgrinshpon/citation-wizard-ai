# five_mode_source_depth_policy_v1 — Acceptance Report

Status: **CONDITIONAL PASS** (classification + budgeting accepted; citation yield unchanged and still gated by the pre-existing sufficiency gate)

## What shipped

- `stages/sourceDepthPolicy.ts` — deterministic classification into 5 modes
  (`exact_source`, `specific_case_or_statute`, `narrow_doctrine`,
  `broad_research`, `academic_research`) from structural signals only
  (docket, statute-section, quote cue, broad cue, academic cue, multi-facet,
  question length, claim count). No substantive legal-field coupling.
- Per-mode `source_mix` ranges + `min_slots_by_source_type` diversity floor.
- `stages/queryPlanner.ts` — mode directive injected into the planner prompt,
  plus deterministic top-up/trim (`applyDepthToPlannerQueries`).
- `stages/queryMergeAndBudget.ts` — the floor reorders admission (depth-needed
  source types are admitted first) but **counts against `max_total`**; the
  ceiling is never raised.
- `stages/sourceNomination.ts` — depth-aware category breadth.
- `index.ts` — depth decided before planning/nomination; Perplexity gated
  (`never` / `targeted` / `allowed`); full telemetry under
  `metadata.drafter.source_depth_policy`.
- Smoke-only control switch `x-disable-source-depth: 1` (with `x-smoke-mode: 1`)
  for A/B validation; sets `control_run: true` in telemetry.

## Classification results (9 queries)

| id | question type | depth_mode | reasons | perplexity |
|---|---|---|---|---|
| D1 | broad constitutional | broad_research | broad_cue | allowed |
| D3 | broad regulatory | broad_research | broad_cue | allowed |
| MAYA | named ruling | specific_case_or_statute | specific_ruling_cue | targeted |
| MAYA-AMIR | docket | specific_case_or_statute | docket_detected | targeted |
| R02 | docket | specific_case_or_statute | docket_detected | targeted |
| NATION-STATE | docket | specific_case_or_statute | docket_detected | fast_lane_hit |
| ACADEMIC | academic chapter | academic_research | academic_cue | allowed |
| P02 | docket | specific_case_or_statute | docket_detected | targeted |
| B8 | short doctrine | narrow_doctrine | — | targeted |

All 9 classified as intended. One correction during validation: `multi_facet`
no longer promotes short single-doctrine questions to `broad_research` on claim
count alone (now requires ≥2 question marks or ≥140 chars) — this is what moved
B8 from `broad_research` to `narrow_doctrine`.

## Source diversity effect

Broad/academic runs now plan and retain a genuinely mixed pack instead of a
single-type one, e.g.:

- D1 planner mix `{case 5, statute 1, academic 4}` → merge kept
  `{case 7, statute 2, academic 5}`.
- ACADEMIC planner mix `{case 6, report 2, statute 1, academic 3, regulation 1}`
  → merge kept `{case 7, report 1, statute 3, academic 2, regulation 1}`.
- Specific-case runs stay narrow: P02 planner `{case 5}`, Perplexity targeted.

## A/B control: no regression attributable to the policy

Control runs (`x-disable-source-depth: 1`) on the two refusing broad queries:

| id | policy on | control (policy off) |
|---|---|---|
| D1 | 0 footnotes, `insufficient_sources_limitation` | 0 footnotes, same refusal |
| B8 | 0 footnotes, same refusal | 0 footnotes, same refusal |
| ACADEMIC | 0 footnotes (2 runs) | 1 footnote |

D1 and B8 refuse identically with the policy disabled — the refusal comes from
the pre-existing sufficiency gate (no direct case law acquired), not from depth
budgeting. ACADEMIC and D3 flipped between 0 and 1 footnote across repeats in
both arms; footnote yield on these refusal-prone questions is run-to-run
variance around the same gate, not a deterministic delta.

## Open items (backlog, not blockers)

1. Sufficiency gate refuses broad doctrinal questions (D1, B8) even when the
   pack contains topical statutes and scholarship — the dominant quality
   limiter now, independent of this track.
2. Academic-mode yield: the diversity directive shifts the planner away from
   academic-heavy mixes; consider a higher academic floor for
   `academic_research` once (1) is addressed.

## Artifacts

- `reports/source-depth/TABLE.md`, `_all.json`, per-query `*.json`
- `reports/source-depth/control/*` — policy-off control runs
- `scripts/legal-research-v1-source-depth-validation.ts` (`ONLY=`, `CONTROL=1`)
