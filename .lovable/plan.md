# five_mode_source_depth_policy_v1

Add one small deterministic stage that decides, before any query is planned, **how deep** the research should go — and let the existing planner, nomination, merge, Perplexity and acquisition stages read that decision. No new taxonomy of legal subjects, no new LLM call, no gate loosening.

## What changes for the user

A broad question like D1 (proportionality in constitutional review) will no longer plan a single Basic-Law text query and stop. It will be classified as `broad_research`, and the run must attempt primary law + several judgment lanes + at least one secondary-source lane. If those attempts fail, the answer may still be limited, but telemetry will record exactly which source category failed and why, instead of silently looking like a complete survey.

Narrow questions (exact quote, specific docket, single section) stay exactly as narrow and fast as today.

## The 5 depth modes

| mode | trigger (deterministic signals) | source_mix target attempts |
|---|---|---|
| `exact_source` | quote/verbatim cue + statute section, `output_shape=quote` | official 1, judgments 0, secondary 0 |
| `specific_case_or_statute` | explicit docket, or "מה נקבע ב…", or single-section lookup | specific primary 1, background 0-1, secondary 0 |
| `narrow_doctrine` | definition/comparison shape, short doctrinal question, no memo cue | primary 0-1, judgments 1-2, secondary 0-1 |
| `broad_research` | synthesis/memo/survey cues, multi-facet analysis shape, long question | primary 1, judgments 2-4, secondary 1, institutional 0-1 |
| `academic_research` | seminar / literature-review / "מצא לי מקורות" / bibliography cues | primary 1-2, judgments 2-4, secondary 2-4, institutional 1-3, bills 0-2 |

These are research-depth categories only. Numbers are **target attempts**, never required citations.

## Technical plan

### 1. New stage `stages/sourceDepthPolicy.ts`
- `classifySourceDepth({ question, analyzer, has_docket, has_statute_section, output_shape })` → `{ depth_mode, reasons[], source_mix, perplexity_policy, planner_directive_he, min_slots_by_source_type }`.
- Pure regex/structural signals reusing `detectDockets` and `detectStatuteSections`, in the same style as `researchMode.ts` / `routerProfiles.ts`. No model call, no doctrine dictionary.
- Exported constants: `SOURCE_DEPTH_VERSION = "five_mode_source_depth_policy_v1"`, `SOURCE_DEPTH_MODES`, `SOURCE_MIX` table.

### 2. Wire early in `index.ts`
Call it right after the claim analyzer and **before** `runQueryPlanner`, `runSourceNomination`, discovery and acquisition. Pass the decision down as a single `depth` object. The existing `router_profiles_v1` decision stays authoritative for budgets/ceilings; depth only *raises floors on source-type diversity*, never raises the query cap beyond `router.max_retrieval_queries`.

### 3. Planner (`stages/queryPlanner.ts` / `researchMode.ts`)
- Append `depth.planner_directive_he` to the planner user prompt.
- Extend the deterministic obligation audit: for `broad_research` require ≥1 primary-law query, ≥2 case-law queries, ≥1 secondary query where relevant; for `academic_research` add scholarship/institutional obligations; for `exact_source` / `specific_case_or_statute` audit that no broad literature queries were produced (drop the extras rather than adding).
- Reuse the existing `enforceModeTargets` widening path so a non-compliant planner output is deterministically topped up, not re-prompted.

### 4. Nomination (`stages/sourceNomination.ts`)
- Add `depth_mode` + `source_mix` to `SourceNominationInput` and to the user prompt (one short line, no schema change).
- Category caps become depth-aware: broad/academic allow more judgment + exploratory targets (still inside `NOMINATION_LIMITS`), exact/specific keep today's tight caps.

### 5. Query merge (`stages/queryMergeAndBudget.ts`)
- New optional `min_slots_by_source_type` in `MergeOptions`: before applying `total_cap`, keep at least the configured number of kept queries per `expected_source_type` (statute / case / academic / report). Extends the existing reserved-lane mechanism; required anchors stay protected; global cap unchanged.
- Report kept/dropped counts per source type.

### 6. Perplexity policy
- Gate the existing `runPerplexityRetrieval` call site on `depth.perplexity_policy`: `never` for `exact_source` (unless the official source could not be located), `targeted` for specific/narrow, `allowed` for broad/academic.
- Log `perplexity_called` + `perplexity_reason`. Discovery-only status and all downstream citation gates are unchanged.

### 7. Acquisition routing, gates, drafter, footnotes
Unchanged. No verifier, source-integrity, claim-source-match, sufficiency, footnote-rendering, relay or crawling change. Metadata-only sources remain bibliography-only.

### 8. Telemetry (`metadata.source_depth_policy`)
`depth_mode`, `reasons`, `source_mix`, planner queries by source type, nomination targets by source type, merge kept/dropped by source type, `perplexity_called`/reason, discovered / acquired / citable / bibliography-only counts by type, dropped sources with reasons, final footnote count, `drafted_despite_thin_pack` + reason, runtime delta, CPU/stale/stub/dangling flags.

### 9. Validation
New `scripts/legal-research-v1-source-depth-validation.ts`, sequential (same trigger/poll-by-`run_id` pattern as existing runners): D1, D3, MAYA, MAYA-AMIR, R02, Nation-State/Hasson, one seminar-style academic query, P02, B8. Output a per-run telemetry table plus verbatim answers, then `reports/source-depth/ACCEPTANCE_REPORT.md`.

## Acceptance criteria checked in the report
- Exactly 5 depth modes; decision made before planner/nomination/discovery/acquisition.
- D1 classified `broad_research`, plans judgment discovery + ≥1 secondary attempt.
- Narrow runs not bloated; B8 byte-identical or no slower; P02 still safely refuses; R02 no worse.
- Perplexity used only where the mode justifies it; no unacquired/unvalidated source cited.
- No gate loosening; bounded runtime delta; no CPU kills, stubs, stale jobs or dangling markers.
- Verdict accepted / partial / not accepted, and if not accepted, which link in the chain (mode, planner, nomination, merge, Perplexity, recall, acquisition, budget, gates, drafter) is the bottleneck.
