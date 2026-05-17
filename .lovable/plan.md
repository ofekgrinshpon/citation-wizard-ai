**Review findings**

The last Deep run shows the prior pass only partially worked:

- Query expansion is working: `expanded_queries` includes `סעד זמני`, `צו מניעה זמני`, `מאזן הנוחות`, `סיכויי ההליך`, `ראיות לכאורה`.
- The junk-source problem is currently controlled: no traffic/livestock/marine-pollution regulations appeared in the latest source mix.
- The backend itself is healthy, but the pipeline still overloads the DB vector RPCs.
- Four `match_legal_chunks` calls still ran concurrently and all four hit `statement timeout`; the only vector contribution came from the separate caselaw-filtered RPC.
- Candidate recall is ineffective: low-threshold pool produced only `fresh=1`, then `recovered=0`.
- Claim Verification completed only partially: two batches timed out, one batch succeeded; because aggregate status became `success`, strict pruning removed 15 of 19 source-pack items.
- Final answer had 6 footnotes, but only 3 unique source cards were actually cited (`cards_cited=3/19`, 16%). This explains why it “doesn’t seem like it works”: sources exist, but verification/pruning/drafting are not turning them into broad anchored support.
- Telemetry is incomplete: `metadata.claim_verification` and `metadata.coverage_gap` are not persisted even though logs print those values, making post-run review harder.

**Root cause**

The strict proof rule is correct, but the orchestration is too brittle:

1. Vector retrieval still fires too many heavy RPCs at once.
2. Claim Verification treats “some batch succeeded” as enough for strict pruning, even when most sources were never verified because their batches timed out.
3. Candidate recall cards are added to `sourceCards` before verification, and `vector_candidates_promoted` currently means “added to pack for verification,” not “proved by verification.”
4. Coverage/verification diagnostics are log-only, not saved in `qa_logs.metadata`.

**Implementation plan**

1. **Make vector retrieval DB-safe**
   - Replace the current `Promise.all` vector fan-out with bounded sequential or 2-at-a-time execution.
   - Keep the query cap, but reduce actual concurrent `match_legal_chunks` pressure so statement timeouts stop cascading.
   - Keep original query + capped expanded/planner queries; no baseline retuning.
   - Preserve the low-threshold candidate pool as recall-only.

2. **Make Claim Verification all-or-safe, not partial-strict**
   - Track which source IDs were actually seen by successful verification batches.
   - If any verification batch times out/fails, do **not** strict-prune unverified standard-retrieval cards.
   - Strict-prune only sources that were actually evaluated and found non-supporting.
   - Candidate-pool cards remain strict: they enter final sourcePack/footnotes only when they receive `direct_support` or `partial_support`.

3. **Fix recall-vs-proof telemetry semantics**
   - Rename/repurpose counters so:
     - `vector_candidates_low_threshold` = raw fresh low-threshold candidates.
     - `candidate_pool_cards_added` = recall candidates temporarily inserted for verification.
     - `candidates_recovered_by_claim_verification` = only direct/partial verified candidate-pool cards.
     - `vector_candidates_promoted` = actual direct/partial verified promotions, not temporary additions.
   - Keep `candidates_kept_unverified` honest and only for safe-prune fallback cases.

4. **Persist verification and coverage diagnostics**
   - Add `metadata.claim_verification` with supported/partial/unsupported counts, batch status, duration, and pruned IDs.
   - Add `metadata.coverage_gap` with `cards_in`, `cards_cited`, `claims_total`, `claims_anchored`, `footnotes`, and samples.
   - Keep logs, but make database review authoritative.

5. **Keep citation floor strict**
   - No parser-side relaxation.
   - No drafter prompt changes.
   - No sourcePack admission without Claim Verification for candidate-pool sources.
   - No soft-min quota filling.
   - No baseline retuning.

6. **Validation**
   - Re-run the temporary-injunction Deep query and verify:
     - `expanded_queries` still include `מאזן הנוחות`, `סיכויי ההליך`, `ראיות לכאורה`.
     - vector RPC timeouts are eliminated or materially reduced.
     - no traffic/livestock/marine-pollution regulations.
     - at least 3 anchored footnotes when verified sources exist.
     - every final cited source has direct/partial claim fit or is a preserved statutory/user-document anchor.
     - `candidates_recovered_by_claim_verification` counts only actual direct/partial candidate recoveries.
   - Then run Q1/Q6/Q21 and the existing regression harness without retuning baselines.