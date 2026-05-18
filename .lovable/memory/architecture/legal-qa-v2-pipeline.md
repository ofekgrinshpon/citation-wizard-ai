---
name: Research V2 pipeline
description: New simplified 5-stage legal-qa pipeline (ResearchPlan → per-claim retrieval → verification → ledger → drafter), gated by RESEARCH_V2 env flag. Plan in .lovable/plan.md.
type: feature
---

**Goal:** replace the over-engineered chain (router/decomposition/legalResearchPlanner/issueMap/candidateClaims/sourceRoleClassifier/sourcePackGateV2/legalClaimMap) with one reasoning stage + claim-scoped retrieval + claim-scoped verification + a ledger the drafter consumes directly. Target: 5–8 strong footnotes, not 32 repetitive ones.

**Core principle:** Think broadly, prove narrowly, write simply.

**New modules (additive, behind `RESEARCH_V2=true`):**
- `supabase/functions/legal-qa/researchPlan.ts` — single `callPlannerJSON` (`stage="research_plan_v2"`) returns `{ thesis, claims[4-8], counter_claims }`. Each claim carries `search_targets`, `required_evidence`, `hedge_if_partial`.
- `supabase/functions/legal-qa/claimRetrieval.ts` — parallel per-claim hybrid retrieval (`search_legal_chunks_text` + `match_legal_chunks` when embed fn supplied). Read-only RPCs. Returns `{ claimId, candidates[≤6 Fast / ≤8 Deep], externalQueries[] }`. External fan-out only for Deep + missing evidence types (academic/committee/news).
- `supabase/functions/legal-qa/ledger.ts` — verification + ledger assembly. One planner call per claim in parallel (`stage="verify_v2:<id>"`). 4-tier rubric (direct/partial/tangential/unrelated). Verdict rule unchanged from existing `claimVerification.ts`. Only supported + partially_supported survive; partially_supported entries carry `hedge=true` and the claim's `hedge_if_partial` template.

**Drafter contract (when wired):** consumes ledger entries only — `{ claim, sources[≤3] }` plus thesis. No raw source pack, no discovery, no rejected sources. Card→Claim contract, citation engine, Rule 37, anchor enforcement unchanged.

**Telemetry (qa_logs.metadata, flat shape):**
- `research_plan` — `{ used, model, duration_ms, status, claim_count, counter_count, thesis_chars }`
- `retrieval_v2` — `{ per_claim: [{claim_id, local_n, external_n, top_score}], total_candidates, claims_with_zero }`
- `verification_v2.runs` — array of StageRun (one per claim)
- `ledger_v2` — `{ kept, dropped, supported, partially_supported, total_sources, claim_ids_kept[], claim_ids_dropped[] }`

**Migration order (in plan):**
1. Add new modules (done). 2. Wire Deep behind flag in `index.ts`. 3. Validate on existing eval baselines. 4. Flip Deep default. 5. Migrate Fast. 6. Delete legacy planners (`legalResearchPlanner.ts`, `legalResearchDecomposition.ts`, `issueMap.ts`, `candidateClaims.ts`, `legalClaimMap.ts`, `sourceRoleClassifier.ts`, `sourcePackGateV2.ts`, `roleAwarePromptHelper.ts`) and absorb `legalIssueRouter.ts` into ResearchPlan preamble. 7. Reduce `dynamicRerank.ts`, `legalSourcePack.ts`, `queryExpansion.ts`, `decomposition.ts`.

**Out of scope (kept verbatim):** citation engine, Rule 37, anchor enforcement, async Deep dispatcher + polling, SSE Fast, compact prompt idea, academic writing mode.
