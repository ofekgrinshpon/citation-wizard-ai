# doctrinal_candidate_pool_stabilization_v1 — Acceptance Report

**Verdict:** ACCEPTED for pool-stabilization mechanics and telemetry;
CONDITIONAL PASS for end-to-end doctrinal stability (one variance failure, see §4).

## 1. What shipped

| Component | Behavior |
|---|---|
| `stages/doctrinalCandidateStabilization.ts` | Pure, deterministic helpers: conservative listing suppression, doctrinal reconsideration predicate, pre-sufficiency pool snapshot, bounded recovery decision. |
| `stages/secondaryBodyAcquisition.ts` | New optional inputs: `suppress_listings`, `support_by_candidate` (reconsideration), `restrict_to_candidate_ids`, per-pass `limits`, `recovery_pass`. Reports `listing_suppressed`, `reconsidered_candidate_ids`. |
| `index.ts` | Pass 1 now suppresses clear listing pages. After the verifier and before the drafter/sufficiency: pool snapshot → bounded recovery pass → post-recovery snapshot → telemetry at `metadata.drafter.candidate_pool_stabilization`. |

Sufficiency thresholds, claim-source-match, judgment identity, docket limitation,
statute authority and footnote rules were **not** modified.

## 2. Guardrail compliance

1. **Recovery may fail safely.** Recovery never marks anything eligible. It only
   attempts acquisition; eligibility still requires acquired body + source
   integrity + doctrinal typing. On failure the normal insufficiency branch runs
   and `recovery.failures[]` records per-candidate `failure_reason`,
   `web_result`, `substantive_reason`, plus `eligibility_gain`.
2. **Signals are not eligibility.** `assessDoctrinalReconsideration` grants one
   acquisition attempt only; `isAcquiredEligibleDoctrinal` requires
   `body_acquired` and rejects metadata-only / listing / not-citable integrity.
   Unit-tested.
3. **Conservative listing suppression.** Only clear index/listing/search/category
   pages are dropped. A candidate with strong article/report identity plus a
   plausible body/download path is never suppressed (`strong_identity_with_body_path`),
   and candidates with an acquired body are never suppressed. Unit-tested.
4. **Variance tested.** B8 and D1 each run twice plus safety controls (below).

Recovery budget: max 3 candidates, 2 local lookups, 1–2 web attempts,
10s (narrow) / 15s (broad, academic) wall clock, and it aborts if the global
retrieval budget is exhausted.

## 3. Stage 1 — unit tests

`src/test/doctrinalCandidateStabilization.test.ts` — 11/11 pass
(listing suppression, protection of strong identity, reconsideration accept/reject,
eligibility requires acquired body, snapshot counters, recovery trigger and its
non-trigger cases, budget caps).

## 4. Stage 2 — live smoke + variance

| Run | Result | Branch | Footnotes | doctrinal_eligible before→after | Recovery |
|---|---|---|---|---|---|
| B8 #1 | PASS | normal | 4 | 2 → 2 | not needed (floor met) |
| D1 #1 | PASS | normal | 2 | 4 → 4 | not needed |
| B8 #2 | PASS | normal | 2 | 3 → 3 | not needed |
| D1 #2 | PASS | normal | 2 | 3 → 3 | not needed |
| P02 (fabricated docket) | PASS | `docket_limitation` | 0 | 0 → 0 | skipped (`task_intent_not_doctrinal:case_holding`) |
| R02 (real docket control) | PASS | `docket_limitation` | 0 | 0 → 0 | skipped |

Both B8/D1 repeats stayed above the eligibility floor; no insufficiency branch.

## 5. Stage 3 — full sweep (10 queries)

9/10 pass. Failure: **D1-SWEEP** → `insufficient_sources_limitation`, with
`doctrinal_eligible = 1` and recovery not firing (`no_promising_skipped_candidates`).

Diagnosis and follow-up: a re-run of the identical query (`D1-DIAG`) passed with
`doctrinal_eligible = 2` and a normal answer — i.e. the failure is **retrieval /
acquisition variance**, not a stabilization defect. The new
`reconsideration_rejections` histogram now shows exactly why promising
direct/partial candidates are not reconsidered, e.g. for D1-DIAG:

```
already_attempted: 1
primary_law_or_case_law: 1
listing_suppressed:integrity_index_or_listing: 3
```

That the sweep's D1 pool had 22/30 candidates classed `index_or_listing`
confirms the remaining instability is upstream (retrieval quality), which is the
next natural track — this one deliberately did not touch thresholds.

Safety controls in the sweep (R02, P02) both held `docket_limitation`.

## 6. Telemetry

`metadata.drafter.candidate_pool_stabilization`:
`snapshot_before` / `snapshot_after` (totals, verifier direct/partial, secondary and
institutional typing, index_or_listing, not_citable, acquired bodies,
doctrinal/institutional eligible, blocked_not_doctrinal_type,
skipped_no_body_acquisition_attempted, reconsiderable ids, reconsideration_rejections),
plus `listing_suppressed(_ids)`, `reconsidered_candidate_ids` and the full
`recovery` record (ran, reason, candidate_ids, budget, acquired ids, stop_reason,
ms, per-candidate failures, eligibility_gain).

Durable stage marks: `doctrinal_pool_recovery_start` / `_done` / `_failed`.

## 7. Recommendation

Ship default-on and monitor `recovery.ran`, `recovery.eligibility_gain` and
`reconsideration_rejections` for one week. Open a follow-up track on the upstream
listing-heavy retrieval pools (index_or_listing ≈ 70% of candidates on D1).
