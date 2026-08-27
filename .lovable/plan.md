# claim_source_rebinding_v1

## Why

The funnel diagnostics showed the biggest late-stage loss in the pipeline: 4–12 source refs per run are dropped with `claim_mismatch`, including fully acquired, verifier-`direct` sources with 16,000+ characters of body text (B8, NATION-STATE-ACADEMIC, ACADEMIC, D1). The result is answers that lose their best citations at the last gate, then attach a "מגבלת ביסוס" notice they did not deserve.

Cause (in `stages/claimSourceMatch.ts`, Rule A): a source is bound to the retrieval-time `claim_id` the verifier judged it against, while the drafter tags each answer block with its own `claim_id`. When those two id-spaces diverge — reworded claims, merged claims, facet ids, blocks the drafter composed across claims — a perfectly good source fails a pure string-identity test.

## Goal

Stop dropping sources for id-space mismatch alone. Replace the strict string comparison with a rebinding step that asks the substantive question — does this source actually support the proposition in this block? — while leaving every safety gate (judgment identity, docket limitation, statute authority, authority-overstatement, commentary-in-substantive-block) exactly as it is today.

## Scope

Changes are confined to the claim/source binding layer:

1. **New stage `stages/claimSourceRebinding.ts`** — deterministic, no LLM call. For each (block, source) pair it computes a rebinding decision from evidence already in telemetry:
   - exact claim/facet id match (today's Rule A) → `bound_exact`
   - parent/child facet relation (`claim::fN`) in either direction → `bound_facet`
   - the verifier's `supported_points` for that source overlap the block text (normalized Hebrew token overlap, construct/prefix tolerant, reusing the normalizer from `specificCaseResolution.ts`) → `bound_topical`
   - source legal area matches block legal area **and** verifier verdict is `direct`/`partial` **and** the source has an acquired body → `bound_area_direct`
   - none of the above → `unbound`

2. **Rule A becomes rebinding-aware** in `claimSourceMatch.ts`: a ref is dropped as `claim_mismatch` only when the rebinding decision is `unbound`. Rules B–E run unchanged on every ref that survives, so authority level, commentary use, analogy and legal-area gates keep their current strictness.

3. **Binding strength is recorded, not just kept/dropped.** Each kept ref carries `binding: exact | facet | topical | area_direct`. A `court_holding` or docket-bearing block still requires a judgment-authority source, unchanged; topical rebinding never upgrades a secondary source into primary authority.

4. **Limitation text becomes proportional.** `CLAIM_SUPPORT_LIMITATION_HE` currently fires whenever *any* ref was dropped. It will fire only when a substantive block ends with zero kept refs, or when a main claim keeps only non-primary support. Refs dropped while the block still holds direct support no longer trigger a caveat.

5. **Telemetry** under `metadata.claim_source_match`: `rebinding` block with per-decision counts (`bound_exact`, `bound_facet`, `bound_topical`, `bound_area_direct`, `unbound`), `rebound_ref_count`, `claim_mismatch_drops_before/after`, and per-ref decision + evidence (overlap score, matched points) so the next funnel run can measure the delta directly.

## Not in scope

No change to retrieval, ranking, nomination, acquisition, source integrity, judgment identity validation, cache rules, footnote rendering, or drafter prompts. No new LLM call. R02 and P02 refusal behaviour must be byte-identical.

## Validation

Rerun the same 10 runs used by the funnel diagnostics: ACADEMIC, NATION-STATE-ACADEMIC, PAYWALL, MMM, B8, D1, D3, DARKPATTERNS, R02, P02. Regenerate the funnel with the existing read-only diagnostics script and compare against `reports/candidate-funnel/funnel.json`.

Acceptance:
- `claim_mismatch` drops of acquired, verifier-`direct` sources fall to near zero.
- Cited footnote count rises on at least ACADEMIC, B8, NATION-STATE-ACADEMIC and D1, all still traceable to acquired bodies.
- No block cites a source whose verifier verdict is `unrelated`.
- No `court_holding` block gains secondary-only support; `authority_overstatements` does not grow.
- R02 still refuses without the named judgment body; P02 still refuses the fabricated docket.
- Unwarranted "מגבלת ביסוס" notices disappear from runs that keep direct support.

Report to `reports/claim-source-rebinding/ACCEPTANCE_REPORT.md`, with the before/after funnel diff included.

## Technical notes

- `SourceMatchMeta` gains `supported_points: string[]` (already present on verifier verdicts, currently not carried into the drafter source).
- Topical overlap uses a conservative threshold; ties resolve to `unbound` (drop) so the change can only be as permissive as the evidence allows.
- The rebinding stage is pure and unit-testable; tests go in `src/test/claimSourceRebinding.test.ts` alongside the existing gate tests.
