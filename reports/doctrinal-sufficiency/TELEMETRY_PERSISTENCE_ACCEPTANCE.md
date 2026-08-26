# doctrinal_sufficiency_telemetry_persistence_v1 — Acceptance Report

Date: 2026-08-26 · Function: `legal-research-v1` · Verdict: **ACCEPTED**

## 1. Root cause (there was no persistence bug)

The telemetry was never null in `qa_logs`. It was written under a **nested path**:

```
qa_logs.metadata.drafter.source_sufficiency
qa_logs.metadata.drafter.doctrinal_typing
qa_logs.metadata.drafter.claim_support_categories
qa_logs.metadata.drafter.claim_source_match
qa_logs.metadata.drafter.source_depth_policy
```

The previous validation runner read the **top level** of `metadata`, so every field
came back `-`/null. Smoke mode does **not** write a reduced metadata block — the full
object is persisted for smoke and production runs alike (`lib/telemetry.ts` writes
`row.metadata` verbatim, updating the pre-created trace row).

Genuine gap found: on **deterministic branches** (`docket_limitation`,
`statute_section_limitation`, `canonical_quote_*`, `insufficient_sources_limitation`)
the drafter returned before `claimSourceMatch` ran and did not attach
`doctrinal_typing`, so those two fields *were* null on refusal runs with no reason
recorded. That is what this patch fixes.

## 2. Changes (telemetry only, no logic touched)

- `stages/drafterV2.ts` — all 6 deterministic-branch returns now carry
  `doctrinal_typing` (computed before any branch) and
  `claim_source_match: claimSourceMatchNotRun(<branch>)`, an explicit
  `{ stage_not_run: true, stage_not_run_reason: "deterministic_branch:<name>" }`
  marker instead of a missing field.
- `stages/claimSourceMatch.ts` — `ClaimSourceMatchReport` gains optional
  `stage_not_run` / `stage_not_run_reason`.
- `index.ts` — new consolidated, never-null
  `metadata.drafter.doctrinal_sufficiency_trace` (depth mode, branch,
  sufficiency ran/result/reason, fallback combination + declined reason,
  eligible secondary refs and ineligibility histogram, typing remap count,
  claim-match ran flag + not-run reason, category and overstatement counts,
  input source count, footnote count). Pre-drafter exits (11 sites) now write
  `doctrinal_sufficiency_trace: { ran: false, reason: "pipeline_exit_before_drafter", exit_phase }`.

No sufficiency, claim-match, typing, drafter-instruction, identity, cache, relay,
depth-policy, planner or nomination rule was modified. Type check: 15 pre-existing
errors, unchanged, none in the touched code.

## 3. Re-run of the 9-query sequence (post-patch)

| # | Run | ms | fn | depth_mode | branch | sufficiency | claim_match | fallback |
|---|-----|----|----|-----------|--------|-------------|-------------|----------|
| 1 | D1 | 142.8s | 1 | broad_research | — | true / case_law_synthesis_supported | ran, 6 categories | not needed (sufficient) |
| 2 | B8 | 166.8s | 0 | narrow_doctrine | insufficient_sources_limitation | false / no_statutory_caselaw_or_doctrinal_anchor | not run (branch) | declined: `depth_mode_not_broad` |
| 3 | D3 | 166.8s | 0 | broad_research | — | true / doctrinal_anchor_present | ran, 6 categories | not needed |
| 4 | ACADEMIC | 192.4s | 0 | academic_research | — | true / statutory_procedural_pack_present | ran, 6 categories | not needed |
| 5 | FRESH-SC | 150.2s | 0 | specific_case_or_statute | — | true / shape_not_gated | ran, 6 categories | n/a |
| 6 | R02 | 151.8s | 0 | specific_case_or_statute | docket_limitation | not reached | not run (branch) | n/a |
| 7 | NATION-STATE | 126.6s | 0 | specific_case_or_statute | — | true / shape_not_gated | ran, 6 categories | n/a |
| 8 | P02 | 147.1s | 0 | specific_case_or_statute | docket_limitation | not reached | not run (branch) | n/a |
| 9 | MAYA-AMIR | 116.8s | 0 | specific_case_or_statute | docket_limitation | not reached | not run (branch) | n/a |

Claim categories by block (where the stage ran):
- D1: court_holding / statutory / court_holding / court_holding / doctrinal_synthesis / scholarly_commentary
- D3: statutory / statutory / doctrinal_synthesis / court_holding / doctrinal_synthesis / contextual_background
- ACADEMIC: court_holding ×2 / scholarly_commentary ×2 / contextual_background / statutory
- FRESH-SC: court_holding ×6 · NATION-STATE: court_holding ×5 + doctrinal_synthesis

`authority_overstatements`: 0 in all 9 runs. Typing remaps: 0 in all 9 runs.
Eligible doctrinal secondaries: 0 in all 9 runs; ineligibility histogram is
`not_doctrinal_type` (majority) + `no_acquired_body_text`.

Markers: `dangling_marker_count = 0`, `orphan_source_row_count = 0`, no stubs, no
stale terminal rows in all reported runs.

## 4. Acceptance checks

- **No null core telemetry** — `source_sufficiency`, `doctrinal_typing`,
  `claim_support_categories` are populated or carry an explicit
  `stage_not_run` / `sufficiency_ran: false` + branch reason. PASS.
- **D1/B8/D3/ACADEMIC attributable** — see §5. PASS.
- **No behavior change** — refusal/answer branches match the pre-patch run for the
  same questions (B8 refusal, R02/P02/MAYA docket_limitation). PASS.
- **No CPU kills / stubs / dangling / orphans** — one caveat below.

Caveat (non-blocking): the first P02 attempt (`run_id 2e6f6ada…`) left a stale
`trace_status: in_progress` row — the isolate died during retrieval before any
terminal write. The immediate re-run completed normally in 147s with the expected
`docket_limitation` refusal. Single transient occurrence, not reproducible, and
unrelated to this patch (the trace row exists precisely to make such deaths visible).

## 5. Attribution of the earlier 0/0/1/0 footnote results

- **D1** — earlier run refused at `insufficient_sources_limitation`
  (`no_usable_judgment_authority`); the re-run reached the drafter and produced
  1 footnote. Retrieval-variance, not a gate defect.
- **B8** — `narrow_doctrine` depth. Sufficiency failed
  (`no_statutory_caselaw_or_doctrinal_anchor`) and the doctrinal fallback was
  **declined by design** (`depth_mode_not_broad`). Deterministic refusal.
- **D3** — sufficiency passed (`doctrinal_anchor_present`), claim-match ran and
  tagged 6 blocks, but no source survived per-claim matching to a citable footnote.
- **ACADEMIC** — sufficiency passed (`statutory_procedural_pack_present`);
  6 blocks tagged, no footnote survived claim-match.

## 6. Finding carried into the parent track

The `substance_based_doctrinal_sufficiency_v1` fallback is currently **inert in
practice**: `doctrinal_eligible_count = 0` and `typing_remapped_count = 0` in all
9 runs, because candidate secondaries arrive without acquired body text
(`no_acquired_body_text`) or with a non-doctrinal `source_type`
(`not_doctrinal_type`). The fallback path is correct and safely gated, but it can
only fire once secondary/scholarly sources are actually acquired with bodies.
That is an acquisition-side gap, not a sufficiency-rule gap.
