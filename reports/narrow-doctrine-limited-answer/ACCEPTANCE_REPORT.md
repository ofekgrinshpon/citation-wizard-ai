# narrow_doctrine_limited_doctrinal_answer_v1 — Acceptance Report

Status: **Stage 1 PASS · Stage 2 PASS on track criteria (D1 blocked by pre-existing retrieval timeout) · Stage 3 not yet run**

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

Telemetry (persisted in sufficiency): `depth_mode`, `limited_doctrinal_answer_allowed`,
`narrow_limited_doctrinal_reason`, `doctrinal_fallback_combination`, `doctrinal_fallback_declined_reason`,
`acquired_doctrinal_source_count`, `direct_doctrinal_source_count`, `corroborating_source_count`,
`primary_authority_missing`, `exact_docket_or_case_holding_blocked`, `found_only_used_for_support`,
`branch_before`, `branch_after`.

## Stage 1 — fixtures

`src/test/narrowDoctrineLimitedAnswer.test.ts` — 3/3 pass (allowed case, explicit-docket block,
insufficient-doctrinal-support block). Full suite: 105/105 pass. Typecheck/build clean.

## Stage 2 — mini live smoke

| Run | Runtime | Branch | Footnotes | allowed | reason | acq/direct | basis |
|---|---|---|---|---|---|---|---|
| B8-DOCTRINE (מהי דוקטרינת ההבטחה המנהלית?) | 212 s | **limited_doctrinal_answer** | 3 | true | two_acquired_doctrinal_secondaries | 2/2 | doctrinal_secondary_limited |
| D1 (מבחני מידתיות) | 824 s | retrieval abort (no sufficiency telemetry) | 0 | n/a | n/a | n/a | n/a |
| R02 (ע"א 6821/93) | 141 s | docket_limitation | 0 | false | task_intent_not_doctrinal / case_holding | 0/0 | insufficient |

Notes:
- **B8 regression fixed.** Before this track B8 declined with `depth_mode_not_broad` and produced
  0 footnotes; it now branches `insufficient_sources_limitation → limited_doctrinal_answer` with
  3 footnotes, the narrow caveat rendered ("היקף התשובה: …"), and no holding-style phrasing
  ("בית המשפט קבע" absent).
- **R02 safety preserved**: refusal intact, no substitute authority, narrow fallback explicitly declined.
- **D1** hit the known long-retrieval abort (824 s) and never reached sufficiency, so it is a
  pre-existing retrieval-variance issue, not a regression of this gate. It did *not* fall into
  `insufficient_sources_limitation`.

## Verdict

**ACCEPTED for the narrow limited-doctrinal mechanism** (eligibility, branch, wording, telemetry,
safety controls). **CONDITIONAL on end-to-end stability**, pending the Stage 3 full sweep; the
remaining bottleneck is D1-class retrieval runtime, unchanged by this track.
