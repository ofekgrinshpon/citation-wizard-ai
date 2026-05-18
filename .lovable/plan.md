## Goal

Make the V3 `expected_anchors` actually influence the answer, not just sit in telemetry. After Step 2, on Q3 the user should see Bank Mizrahi, Basic Law §8, Basic Law §4, and ידיעת מנהלי ההשקעות / proportionality material appear (or be honestly marked as not-found) in the footnotes — not the current grab-bag.

## Architecture (no V2 deletion)

```text
question
   │
   ├──► V2 planner ──► V2 retrieval (search_targets) ──┐
   │                                                    │
   └──► V3 LegalResearchPlan ──► V3 anchor retrieval ──►┤──► merge ──► V2 verification ──► V2 ledger ──► drafter
                                                        │
                              (per-anchor: local hybrid + Perplexity fallback)
```

V3 anchor retrieval runs in parallel with V2 retrieval (no added wall time). Results are merged into the existing V2 candidate pool *before* verification, so the existing verifier/ledger/drafter/citation engine/Rule 37 path stays untouched.

## Scope of changes

**New file**
- `supabase/functions/legal-qa/anchorRetrievalV3.ts`
  - Input: `LegalResearchPlanV3.expected_anchors`
  - Per anchor, build 1–2 targeted queries from `name` + `section` + `docket` (e.g. anchor A3 → `"בנק המזרחי 6821/93"` + `docket:"ע\"א 6821/93"`).
  - Local: reuse existing `match_legal_chunks` (vector) + `search_legal_chunks_text` (text). No new RPC.
  - External fallback (Deep only): single Perplexity call per anchor that returned 0 local hits, gated by existing `TIER_A_DOMAINS` / `TIER_B_DOMAINS`, using the existing completion guards (citation-shape regex + URL allowlist). No verified_sources cross-check.
  - Output: `{ anchor_id, status: 'found_local'|'found_external'|'not_found', candidates: SourceCard[] }[]`
  - Cap: 2 candidates per anchor (≤16 total for 8 anchors).
  - Timeout: 20 s per anchor, `Promise.allSettled` so one slow anchor doesn't sink the batch.

**Edited**
- `supabase/functions/legal-qa/researchV3Pipeline.ts`
  - After V2 returns its candidate set and before V2 verification, await the anchor-retrieval results (already running in parallel since dispatch).
  - Merge anchor candidates into the V2 candidate pool with a `v3_anchor_id` provenance tag. De-dupe by source URL / chunk id (anchor wins on tie so the anchor stays traceable).
  - Stamp telemetry into `metadata.v3_anchor_retrieval`: `{ per_anchor: [{anchor_id, status, local_n, external_n, ms}], total_added, total_deduped }`.
  - Keep `v3_path = "deep_v3_step2_anchor_retrieval"`.

**Untouched (explicitly)**
- `aiProvider.ts`, V2 planner, V2 verification, V2 ledger, drafter, citation engine, Rule 37, anchor pass, post-processing, async dispatcher, SSE, Fast path.

## Telemetry contract additions

`qa_logs.metadata.v3_anchor_retrieval`:
```json
{
  "per_anchor": [
    { "anchor_id": "A3", "status": "found_local", "local_n": 2, "external_n": 0, "ms": 180 }
  ],
  "total_added": 9,
  "total_deduped": 2,
  "wall_ms": 4200
}
```

Plus a per-footnote stamp in the existing drafter output so we can answer "which footnotes are anchor-backed?" — adds `v3_anchor_id` to source-card metadata when present; the drafter does nothing with it, but the ledger snapshot in `metadata.ledger_v2` will show coverage.

## Validation (Q3 only, Deep, RESEARCH_V3=true)

Acceptance gates:
1. `v3_path = deep_v3_step2_anchor_retrieval`
2. `legal_research_plan_v3.status = success` (unchanged from Step 1)
3. `v3_anchor_retrieval.per_anchor` has 5 entries (one per A1–A5)
4. At least 3 anchors have `status != "not_found"`
5. The final answer's footnotes include **at least 2 of**: Bank Mizrahi (`ע"א 6821/93`), Basic Law: Human Dignity §8, Basic Law: Freedom of Occupation §4, `בג"ץ 1715/97 לשכת מנהלי ההשקעות`
6. V2 telemetry intact (`retrieval_v2`, `verification_v2`, `ledger_v2`, `drafter` all present)
7. No V1 fallback
8. Total wall ≤ current Deep wall + 5 s (anchor track is parallel)

If gate 5 fails on Q3 specifically, that's a tuning issue (Perplexity prompt for anchor lookup), addressed by iterating only on `anchorRetrievalV3.ts` — V2 stays put.

## Risk register

- **Risk**: anchor retrieval finds garbage (broken_title placeholders, wrong cases). **Mitigation**: reuse the existing `broken_title` filter and the Perplexity completion guards already in `_shared`; cap to 2 candidates/anchor.
- **Risk**: anchor candidates push the verifier over its claim budget. **Mitigation**: anchors are merged into the existing candidate pool, not into new claims — claim count is unchanged.
- **Risk**: parallel Perplexity calls (5 anchors × 1 call) blow budget. **Mitigation**: external fallback only when local returns 0; Deep already runs Perplexity in parallel for V2 search_targets, so the marginal cost is small. Cap external fallback at 5 calls / question.
- **Risk**: drafter ignores anchor candidates because V2 verifier ranks them low. **Mitigation**: give anchor-tagged candidates a small score boost (additive, capped) at merge time — minimal change, easy to revert.

## Out of scope for Step 2

- Hard "must-cite" enforcement (Step 3 candidate).
- Coverage scoring / regression assertions in `eval/regression/`.
- Removing or refactoring V2 planner / `search_targets`.
- Fast mode (V3 stays Deep-only until Deep is stable).
- Citation engine, Rule 37, anchor pass — all stay as-is.

## Rollout

1. Add `anchorRetrievalV3.ts` + wire in `researchV3Pipeline.ts` behind the existing `RESEARCH_V3=true` env flag (already on).
2. Deploy `legal-qa`.
3. Rerun Q3 only, validate gates above.
4. If green, rerun Q1, Q6, Q21, Q22 from regression baselines for sanity (no acceptance bar, just no V2 telemetry loss / no V1 fallback / answer produced).
5. Memory note under `.lovable/memory/architecture/legal-qa-v2-pipeline.md` describing the V3 anchor merge.
