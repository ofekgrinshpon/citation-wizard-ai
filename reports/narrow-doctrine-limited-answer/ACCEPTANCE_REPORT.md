# narrow_doctrine_limited_doctrinal_answer_v1 — Acceptance Report

Status: **Stage 1 PASS · Stage 2 PASS · D1 focused retry PASS · Stage 3 full sweep 10/10 PASS**

## What was implemented

`stages/sourceSufficiency.ts`
- New fallback **combination D** for `depth_mode = narrow_doctrine`, evaluated only when the run would
  otherwise end in `insufficient_sources_limitation`.
- Eligibility (all required): depth_mode narrow_doctrine · no explicit docket · no case-holding request
  (`user_task_intent = case_holding`, `case_law_synthesis` profile, or docket + `requires_judgment_body`) ·
  no official statute-text requirement · no missing required anchor · doctrinal task intent ·
  **and** either ≥2 acquired integrity-passing verifier direct/partial doctrinal secondaries, or
  ≥1 direct secondary plus ≥1 corroborating acquired source.
- New basis value `doctrinal_secondary_limited`; branch reported as `limited_doctrinal_answer`.
- Invariant preserved: `found_only_used_for_support` is always false; metadata-only/found-only
  sources still cannot support a claim; no sufficiency threshold was relaxed.

`stages/drafterV2.ts` + `stages/claimSupportCategory.ts`
- Prompt instructions for the limited answer: explain the doctrinal framework from scholarship,
  state explicitly that no binding judgment text or official statute text was read in full, and
  forbid "בית המשפט קבע"-style phrasing and any reproduction of statutory wording.
- New Hebrew caveat `NARROW_LIMITED_DOCTRINAL_NOTICE_HE` replaces the broad generic notice for this branch.

Telemetry (persisted under `drafter.source_sufficiency`): `depth_mode`,
`limited_doctrinal_answer_allowed`, `narrow_limited_doctrinal_reason`, `doctrinal_fallback_combination`,
`doctrinal_fallback_declined_reason`, `acquired_doctrinal_source_count`, `direct_doctrinal_source_count`,
`corroborating_source_count`, `primary_authority_missing`, `exact_docket_or_case_holding_blocked`,
`found_only_used_for_support`, `branch_before`, `branch_after`.

## Stage 1 — fixtures

`src/test/narrowDoctrineLimitedAnswer.test.ts` — 3/3 pass (allowed case, explicit-docket block,
insufficient-doctrinal-support block). Full suite: 105/105 pass. Typecheck/build clean.

## Stage 2 — mini live smoke

| Run | Runtime | Branch | Footnotes | allowed | reason | acq/direct | basis |
|---|---|---|---|---|---|---|---|
| B8-DOCTRINE | 212 s | **limited_doctrinal_answer** | 3 | true | two_acquired_doctrinal_secondaries | 2/2 | doctrinal_secondary_limited |
| D1 | 824 s | retrieval abort (no sufficiency telemetry) | 0 | n/a | n/a | n/a | n/a |
| R02 | 141 s | docket_limitation | 0 | false | task_intent_not_doctrinal / case_holding | 0/0 | insufficient |

## D1 focused retry (gate before Stage 3)

Same query and config as D1-SWEEP, one run only.

| Field | Value |
|---|---|
| Branch | none (normal draft; sufficiency satisfied) |
| Runtime | **142 s** (vs 824 s abort) |
| Terminal status | `done` — clean terminal, no reaper |
| Retrieval completed | yes (analyzer → planner → retrieval → verifier → drafter, all stages observed) |
| Acquired bodies | 8 |
| Doctrinal eligible | 4 (before 4 → after 4) |
| Narrow limited-answer logic invoked | no — run never reached the insufficiency precondition |
| Abort before this track's logic | n/a — no abort |
| Stale/stub/orphan/CPU markers | none; answer 2,964 chars, 1 footnote, non-placeholder qa_log |
| Discovery precision | pool 103 → 17, suppressible listing ratio → 0.000, O(n) guard ok |

Verdict: **clean** → Stage 3 authorized and run once.

## Stage 3 — full sweep (10 queries, single run)

| Run | Runtime | Terminal | Branch | Fns | depth_mode | branch_before → branch_after | acq/direct/corr | found_only used |
|---|---|---|---|---|---|---|---|---|
| ACADEMIC | 161 s | done | draft | 4 | academic_research | insufficient → research_guidance_task_supported | 4/3/1 | false |
| NATION-STATE-ACADEMIC | 131 s | done | draft | 3 | narrow_doctrine | doctrinal_anchor_present (unchanged) | 4/0/5 | false |
| PAYWALL | 121 s | done | draft | 3 | narrow_doctrine | doctrinal_anchor_present (unchanged) | 3/0/3 | false |
| MMM | 161 s | done | draft | 2 | narrow_doctrine | doctrinal_anchor_present (unchanged) | 1/0/1 | false |
| B8-DOCTRINE | 131 s | done | draft | 3 | narrow_doctrine | doctrinal_anchor_present (unchanged) | 4/4/0 | false |
| D1-SWEEP | 151 s | done | draft | 1 | broad_research | insufficient → limited_doctrinal_fallback_B | 3/1/2 | false |
| D3 | 131 s | done | draft | 1 | broad_research | insufficient → limited_doctrinal_fallback_B | 3/0/3 | false |
| DARKPATTERNS | 201 s | done | draft | 2 | narrow_doctrine | doctrinal_anchor_present (unchanged) | 0/0/2 | false |
| R02 | 131 s | done | **docket_limitation** | 0 | — | — | — | false |
| P02 | 101 s | done | **docket_limitation** | 0 | — | — | — | false |

All 10 runs terminal `done`, 0 failures, runtime 101–201 s (no run near the previous 824 s class).
Discovery precision held in every run: final suppressible listing ratio 0.000, O(n) guard ok.

Acceptance criteria:
- D1 draft with cited support — **met** (1 footnote, fallback B, caveat rendered).
- B8 not falling back to `insufficient_sources_limitation` — **met** (reached
  `doctrinal_anchor_present` directly this time, 3 footnotes).
- R02/P02 remain `docket_limitation` with no substitute authority — **met**; narrow fallback
  explicitly not allowed on either.
- No sufficiency threshold relaxed; `found_only_used_for_support` false in all runs — **met**.
- No answer contains "בית המשפט קבע"; the limited-scope Hebrew caveat ("היקף התשובה") is present
  exactly on the two limited-answer runs (D1-SWEEP, D3) — **met**.

Note on coverage: in this sweep no run needed the *narrow* (combination D) path — the two
narrow_doctrine candidates for it (B8, NATION-STATE) already qualified via
`doctrinal_anchor_present`, and D1/D3 used the pre-existing broad combination B. The narrow path's
live behaviour is evidenced by Stage 2's B8 run (`limited_doctrinal_answer`, 3 footnotes,
`two_acquired_doctrinal_secondaries`), plus Stage 1 fixtures. Eligibility telemetry
(`narrow_limited_doctrinal_reason`) was still computed and recorded on every narrow_doctrine run.

## Verdict

**ACCEPTED.** Mechanism, wording, telemetry and safety controls all validated; Stage 3 is 10/10 with
stable runtimes, and the earlier D1 retrieval abort did not reproduce. Remaining monitoring item
(outside this track): retrieval-runtime variance — D1 has now run 142 s and 151 s cleanly, but the
824 s abort class should stay under observation.
