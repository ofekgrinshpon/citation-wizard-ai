
# Legal-QA Simplification Pass

## Core principle
**Think broadly, prove narrowly, write simply.** One reasoning stage plans, retrieval is claim-scoped, the drafter sees only the surviving ledger.

## Target pipeline (5 stages)

```text
question
  │
  ▼
┌──────────────────┐
│ 1. ResearchPlan  │  one strong reasoning call (gpt-5-mini, Deep: gpt-5)
│   thesis         │
│   claims[4-8]    │  each: {id, statement, kind, required_evidence,
│   counter_claims │                  search_targets[], hedge_if_partial}
└────────┬─────────┘
         ▼
┌──────────────────┐
│ 2. Per-claim     │  for each claim:
│    retrieval     │    local hybrid (text+vector) on claim.search_targets
│                  │    + Perplexity if required_evidence needs external
│                  │  → claim.candidate_sources[]   (cap ~6/claim)
└────────┬─────────┘
         ▼
┌──────────────────┐
│ 3. Verification  │  one planner call per claim (or batched):
│                  │    {claim, source} → direct | partial | tangential | unrelated
│                  │  drop tangential/unrelated
└────────┬─────────┘
         ▼
┌──────────────────┐
│ 4. Final ledger  │  keep only supported / partially_supported
│                  │  partial → mark hedge=true
│                  │  unsupported claims dropped silently
│                  │  counter-claims kept only if verified
└────────┬─────────┘
         ▼
┌──────────────────┐
│ 5. Drafter       │  input = ledger only (claim text + allowed source IDs +
│                  │           minimal citation-ready metadata per ID)
│                  │  no source pack, no discovery, no rejected sources
│                  │  output flows through existing citation engine, Rule 37,
│                  │  anchor enforcement, post-processing
└──────────────────┘
```

Target outcome: **5–8 strong footnotes**, not 32 repetitive ones.

## What's kept (unchanged)
- Card→Claim contract (still the drafter's input shape — just narrower)
- Citation engine (`_shared/citationEngine.ts` + `citationRules.ts`)
- Rule 37 repeated-citation logic
- `anchorPass.ts` enforcement
- Async Deep dispatcher + `legal-qa-status` polling + SSE for Fast
- Compact prompt (Pass D) — now trivially always-on because drafter input is already small
- `aiProvider` with stage telemetry, `StageRun` records in `qa_logs.metadata`
- `modeProfiles` for Fast vs Deep knobs (model, claim cap, per-claim source cap, external search on/off)
- Shadow A/B logger (optional)

## What's removed or merged

| Current | Action |
|---|---|
| `legalIssueRouter.ts` | **Absorb** into ResearchPlan prompt (domain bias as a single preamble line) |
| `decomposition.ts` (Stage A+B) | **Replace** — ResearchPlan covers main_issue/sub_issues implicitly via claims |
| `legalResearchDecomposition.ts` | **Remove** |
| `legalResearchPlanner.ts` | **Remove** — replaced by ResearchPlan |
| `issueMap.ts` | **Remove** — claims carry the doctrine signal |
| `candidateClaims.ts` | **Merge into** ResearchPlan (claims are now first-class output, not a separate stage) |
| `legalClaimMap.ts` (Stage D claim map) | **Remove** — replaced by verification + ledger |
| `sourceRoleClassifier.ts` | **Remove** — verification verdict subsumes "role" |
| `sourcePackGateV2.ts` | **Remove** — no global source pack anymore |
| `legalSourcePack.ts` | **Reduce** to a thin per-claim retrieval helper, or fold into index.ts |
| `roleAwarePromptHelper.ts` | **Remove** |
| `dynamicRerank.ts` | **Reduce** — per-claim retrieval returns small enough sets that aggressive rerank is unnecessary; keep only a simple top-k cosine+text blend |
| `queryExpansion.ts` | **Keep but downscope** — used only inside per-claim retrieval, driven by `claim.search_targets` |
| `paperMemory.ts` | **Keep** (academic mode), but cut its read paths from research mode |
| `critic.ts` / `criticRevision.ts` | **Remove** from research mode (academic mode can keep its own copy) — repair passes are the smell we're fixing |
| `citationQualityScorer.ts` | **Keep** as drafter post-check but no longer a feedback loop into retrieval |

`index.ts` (10.7k lines) shrinks substantially as the orchestration collapses to: `plan → retrieve(claims) → verify(claims) → ledger → draft`.

## New files

- `supabase/functions/legal-qa/researchPlan.ts` — single planner call, JSON tool schema, returns:
  ```ts
  type ResearchPlan = {
    thesis: string;
    claims: Array<{
      id: string;                              // C1..C8
      statement: string;
      kind: 'doctrinal'|'procedural'|'empirical'|'normative';
      required_evidence: Array<'statute'|'case'|'academic'|'committee'|'news'>;
      search_targets: string[];                // 2-4 Hebrew queries
      hedge_if_partial: string;                // hedge wording template
    }>;
    counter_claims: Array<{ id: string; statement: string; search_targets: string[] }>;
  }
  ```
- `supabase/functions/legal-qa/claimRetrieval.ts` — per-claim retrieval (local hybrid + optional Perplexity). Returns `{ claim_id, candidates: SourceCard[] }[]`.
- `supabase/functions/legal-qa/ledger.ts` — verification + ledger assembly. Output:
  ```ts
  type Ledger = Array<{
    claim_id: string;
    claim: string;
    support: 'direct'|'partial';
    hedge: boolean;
    source_ids: string[];   // 1-3 strongest
  }>;
  ```
- Verification reuses `claimVerification.ts` (already in repo) but with the simpler 4-label verdict.

## Telemetry contract (qa_logs.metadata)
Single, flat shape replacing the layered `stage_runs` we have now:
```
metadata.research_plan = { thesis, claim_count, counter_count, model, ms }
metadata.retrieval     = { per_claim: [{claim_id, local_n, external_n}], ms }
metadata.verification  = { per_claim: [{claim_id, direct, partial, tangential, unrelated}], ms }
metadata.ledger        = { kept, dropped, claim_ids_kept, claim_ids_dropped }
metadata.drafter       = { model, prompt_chars, answer_len, footnotes_n }
```
This gives one line per stage and replaces the ten+ overlapping fields we read today (`pass_d_compact`, `phase7:gate`, `sourcePackV2`, `decompositionV2`, etc.).

## Migration order (no big-bang)

1. **Add** `researchPlan.ts`, `claimRetrieval.ts`, `ledger.ts` behind a feature flag `RESEARCH_V2=true` (env on edge function).
2. **Wire** the new path in `index.ts` for Deep only, behind the flag. Fast keeps current path one release.
3. **Validate** on the existing eval set (Q1, Q2, Q6, Q21, Q22, basic-law, extort, procedural baselines under `eval/regression/`).
4. **Flip** Deep default to V2, keep V1 reachable for one release for diffing via shadowAbLogger.
5. **Migrate** Fast to V2 (same code, smaller per-claim caps from `modeProfiles`).
6. **Delete** the files in the "remove" column and the dead branches in `index.ts`.
7. Update memories under `.lovable/memory/logic/legal-qa/` to reflect the collapsed pipeline; archive stage-specific notes (phase7 gate, sourcePackV2, decomposition V2, claim_map) as historical.

## Risks & mitigations

- **Risk:** ResearchPlan call becomes too long / times out.
  Mitigation: single tool-call JSON, `reasoning_effort=minimal` on Fast, `low` on Deep; 30s/45s timeouts as today. Already proven on the existing planner stages.
- **Risk:** Per-claim retrieval is N× slower than one global pack.
  Mitigation: `Promise.all` over claims; cap claims at 6 (Fast) / 8 (Deep); per-claim local query is cheap (existing `match_legal_chunks` + `search_legal_chunks_text` already used).
- **Risk:** Footnotes drop too far (under 5).
  Mitigation: ledger guarantees ≥1 source per kept claim; if final kept claims < 3, retry retrieval round 2 on the dropped claims (config-only follow-up, no new code paths).
- **Risk:** Regression on baselines.
  Mitigation: flag-gated rollout + shadow A/B + existing regression harness.

## Out of scope for this pass
- Citation engine internals
- Rule 37 logic
- Anchor enforcement
- Academic writing mode (its own pipeline; reuses ResearchPlan only at the chapter level later)
- Auth, credits, RLS

## Deliverables
- New: `researchPlan.ts`, `claimRetrieval.ts`, `ledger.ts`
- Edited: `index.ts` (orchestration collapse), `modeProfiles.ts` (per-claim caps), `contracts.ts` (new types), memory index
- Removed (after flip): `legalResearchPlanner.ts`, `legalResearchDecomposition.ts`, `issueMap.ts`, `candidateClaims.ts`, `legalClaimMap.ts`, `sourceRoleClassifier.ts`, `sourcePackGateV2.ts`, `roleAwarePromptHelper.ts`, `legalIssueRouter.ts` (after absorb), plus their tests
- Reduced: `dynamicRerank.ts`, `legalSourcePack.ts`, `queryExpansion.ts`, `decomposition.ts`

Estimated `index.ts` reduction: ~10.7k → ~4–5k lines. Total module ~21k → ~10k lines.
