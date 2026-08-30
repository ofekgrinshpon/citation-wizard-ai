# academic_citation_authority_alignment_v1 — Acceptance Report

Deployed run set: AW1, AW4, AW7, AW8 (academic_writing path).

## What was implemented

- Academic claim categories (`doctrinal_background`, `academic_framing`, `theoretical_explanation`, `literature_synthesis`, `critique_or_counterposition`, `methodological_framing`) that accept acquired doctrinal secondary support, but never metadata-only/background-only sources.
- Wording-based escalation: binding formulations ("בית המשפט קבע", "ההלכה היא", "החוק קובע", explicit dockets/sections) are forced back to `court_holding` / `statutory` even inside academic mode, so primary-law claims still require primary authority.
- `PrimaryLanguageGuard` (`stages/academicAuthorityAlignment.ts`): deterministic, conservative Hebrew rewrites of unsupported binding-law phrasing into cautious academic framing; when no safe local substitution exists the block is reported, not mangled.
- Subject-matter fit check: a generally-legal but off-topic source cannot bind an academic claim.
- Discovery admission: in academic runs, academic/publisher sources found under case-law/statute queries are remapped to the scholarship lane instead of dropped as role-mismatched.
- Soft academic roles in planning: extra critique/counter-position and applied-example scholarship slots (reported when empty, never fabricated, never a refusal trigger).

## Results

| Run | genre | branch | footnotes | answer len | bullets | refs dropped by claim-source-match | drop reasons |
|---|---|---|---|---|---|---|---|
| AW1 | introduction | None | 2 | 3622 | 0 | 8 | insufficient_authority_for_claim_category, claim_mismatch, commentary_in_substantive_block |
| AW4 | theoretical_background | None | 4 | 3457 | 0 | 9 | commentary_in_substantive_block, insufficient_authority_for_claim_category, claim_mismatch, unrelated_legal_area |
| AW7 | argument_paragraph | None | 1 | 1264 | 0 | 1 | commentary_in_substantive_block |
| AW8 | generic_academic | insufficient_sources_limitation | 0 | 300 | 0 | 0 | — |

## Read

- AW1 and AW4 now render 2 and 4 footnotes respectively (previously 1–2 with up to 100% of drafter refs stripped); remaining drops are legitimate — `commentary_in_substantive_block`, `unrelated_legal_area`, and residual `claim_mismatch`.
- No run produced bullets, and no run produced unsupported binding-law phrasing: primary-law language without primary authority is either rewritten to cautious academic framing or reported.
- AW8 still ends in `insufficient_sources_limitation` — retrieval for that topic returned no acquired doctrinal body, so the refusal is correct behaviour, not category gating.
- Safety invariants hold: holdings and statutory text are still primary-only; background/metadata-only sources support nothing.

## Residual

- The dedicated `academic_authority_alignment` telemetry block is not surfacing in the run metadata payload (the underlying decisions are visible through `claim_source_match`); worth a small telemetry-plumbing follow-up.
- AW8-type topics remain acquisition-limited rather than gating-limited.