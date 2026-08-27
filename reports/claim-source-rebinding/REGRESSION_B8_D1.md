# Focused regression analysis — B8 and D1

Scope: why the Stage-3 runs of B8 and D1 branched to `insufficient_sources_limitation`
before claim-source-match, versus the frozen candidate-funnel runs where B8 cited 1
footnote and D1 cited 2. Read-only: existing telemetry (`qa_logs.metadata.drafter.*`)
and `reports/candidate-funnel/funnel.json`. No new sweep, no code changes.

## 1. Side-by-side telemetry

| Field | B8 funnel (`6259e5ba`) | B8 Stage 3 (`5608ec11`) | D1 funnel (`a60272be`) | D1 Stage 3 (`f635bd0d`) |
|---|---|---|---|---|
| depth_mode | narrow_doctrine | narrow_doctrine | broad_research | broad_research |
| user_task_intent | doctrinal_explanation | doctrinal_explanation | doctrinal_explanation | doctrinal_explanation |
| answer_strategy | explain_law | explain_law | synthesize_doctrine | synthesize_doctrine |
| requires_judgment_body | true | true | true | true |
| drafter input sources | 6 | **3** | 4 | 5 |
| secondary local cache hits / lookups | 6 / 8 | **2 / 2** | 6 / 8 | **2 / 2** |
| secondary bodies acquired | 7 | **2** | 8 | **3** |
| doctrinal-eligible sources | 4 | **1** | 2 | **0** |
| ineligibility reasons | not_doctrinal_type: 2 | not_doctrinal_type: 2 | not_doctrinal_type: 2 | not_doctrinal_type: 5 |
| sufficiency verdict | sufficient (`doctrinal_anchor_present`) | **insufficient** (`no_statutory_caselaw_or_doctrinal_anchor`) | sufficient (`limited_doctrinal_fallback_B:two_doctrinal_secondaries`) | **insufficient** (`no_usable_judgment_authority`, fallback declined: `no_eligible_acquired_doctrinal_support`) |
| claim-source-match ran | yes | no (`deterministic_branch:insufficient_sources_limitation`) | yes | no (same) |
| cited footnotes | 1 | 0 | 2 | 0 |

## 2. Where the divergence happens

Both runs diverge **upstream of sufficiency and far upstream of claim-source-match**:

- The planner output is byte-comparable across the two epochs (same task intent,
  strategy, authority requirements, `plan_confidence: high`, no overrides). The
  `source_use_intent_planning_v1` contract was already live during the funnel runs.
- The verifier gate names and eligibility reasons are unchanged (`not_doctrinal_type`
  is the same reason string that also appeared in the funnel runs).
- What collapsed is the **pool of candidates that reached secondary body acquisition**:
  local secondary lookups fell 8 → 2 in both runs, so acquired bodies fell 7 → 2 (B8)
  and 8 → 3 (D1). With fewer acquired doctrinal bodies, `doctrinal_eligible_count`
  fell 4 → 1 (B8) and 2 → 0 (D1).
- Those counts sit exactly on the sufficiency thresholds: B8's narrow-doctrine path
  needs a doctrinal anchor (previously satisfied by 4 eligible secondaries, now 1);
  D1's broad-research fallback B needs **two** eligible acquired doctrinal secondaries
  (previously 2, now 0 → `no_eligible_acquired_doctrinal_support`).
- Sufficiency then set `deterministic_branch = insufficient_sources_limitation`, which
  short-circuits the drafter, so claim-source-match — and hence rebinding — was
  `claim_match_ran: false` in both runs.

## 3. Attribution

| Candidate cause | Verdict | Evidence |
|---|---|---|
| **Retrieval / acquisition variance** | **Primary cause** | Secondary lookups 8 → 2 and acquired bodies 7 → 2 / 8 → 3 with identical plans, thresholds and gate names. D1's Stage-3 web attempts failed on `http_403` and `not_substantive:navigation_or_link_shell`; B8 attempted no web fetch at all because no eligible candidate survived to that stage. Discovery in both epochs is dominated by `local_retrieval` returning gov.il court-listing rows, which is inherently unstable run to run. |
| Planner / `source_use_plan` change | Ruled out | Identical intent, strategy, confidence, authority requirements, zero overrides in both epochs. |
| Verifier coverage | Contributing, not causal | Fewer acquired bodies mean fewer verifiable sources, but no verifier rule or threshold changed; the reason distribution is the same shape. |
| Sufficiency gate | Threshold sensitivity, not a change | Same reason codes and same fallback rules; the runs simply landed on the other side of an unchanged 1-vs-2 eligible-secondary boundary. B8 at `doctrinal_eligible_count = 1` and D1 at `0` are brittle margins. |
| Source typing / eligibility | Secondary contributor | `not_doctrinal_type` rejected 5 of 5 D1 sources in Stage 3 (institutional/statute-page material that cannot serve as a doctrinal anchor). Same rule as before, applied to a worse pool. |
| Side effect of claim-source-match selection / limitation code | **Ruled out** | `claimSourceRebinding.ts` is imported only by `claimSourceMatch.ts`, and telemetry records `claim_match_ran: false` with `claim_match_not_run_reason: deterministic_branch:insufficient_sources_limitation` in both runs. The new code never executed. |

## 4. Conclusion

The regression is **retrieval/acquisition variance amplified by brittle sufficiency
thresholds**, not a side effect of `claim_source_rebinding_v1`. The rebinding mechanics
remain accepted on the runs where they actually executed (NATION-STATE-ACADEMIC,
ACADEMIC, PAYWALL, MMM, DARKPATTERNS: 33 legacy mismatch drops → 10, 23 refs rescued).
End-to-end answer quality stays a conditional pass until the candidate pool for
doctrinal questions is stabilised.

Suggested next tracks, in evidence order:

1. `discovery_precision_and_listing_suppression_v1` — stop gov.il court-listing rows
   from consuming the candidate pool that doctrinal secondaries need.
2. `secondary_acquisition_retry_and_cache_warmth_v1` — reduce run-to-run variance in
   local hits / `http_403` / navigation-shell failures.
3. Only then re-measure B8/D1 footnote yield; do not re-tune sufficiency thresholds
   before the input pool is stable.
