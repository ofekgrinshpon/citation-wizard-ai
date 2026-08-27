# claim_source_rebinding_v1 — Acceptance Report

Verdict: **ACCEPTED for claim-source-rebinding mechanics; CONDITIONAL PASS for end-to-end answer quality** — deployed to `legal-research-v1`.

Reason for the conditional part: in Stage 3, B8, D1 and D3 terminated in `insufficient_sources_limitation` and never reached claim-source-match. The acceptance criterion "cited footnotes rise on B8 and D1" was therefore **not satisfied**; those runs carry no evidence for or against the rebinding logic. See `REGRESSION_B8_D1.md` for the focused regression analysis.


## What changed

New deterministic module `stages/claimSourceRebinding.ts` (no LLM call, no new network I/O):

- **Binding hierarchy** `exact > facet > topical > area_direct > unbound`.
  - `exact` — verifier claim id equals block claim id (or block facet's parent claim), or the source carries no verifier claim binding at all (legacy behaviour preserved).
  - `facet` — a source facet whose parent claim is the block claim.
  - `topical` — legally meaningful overlap between block text and verifier `supported_points`: either one shared identifier (docket / statute section) or **≥2** shared meaningful terms. Generic legal vocabulary (משפט, חוק, דין, בית המשפט, כלל …) is excluded and cannot rebind on its own.
  - `area_direct` — conservative fallback **only** for broad doctrinal/scholarly/background blocks with matching legal area, `direct|partial` verifier verdict and an **acquired body**. Never available for `court_holding`, statutory text, specific application or narrow factual propositions.
- **Rule A now drops only `unbound` refs.** Pure claim-id-space divergence no longer costs a usable source.
- **Per-block selection & cap** (`selectBlockRefs`): rank by binding strength → authority (judgment > statute > doctrinal secondary > background) → verifier verdict; cap 3 refs, 5 for genuine multi-source synthesis blocks.
- **Proportional limitation**: the claim-support caveat now fires only when a substantive block actually lost *all* support (`unsupported_block_count > 0`), not merely because some ref was dropped while direct support remained.
- Rules B–E (commentary-in-substantive-block, authority sufficiency, legal-area, docket/identity escalation) are **unchanged**. No changes to retrieval, ranking, acquisition, integrity, identity validation, cache rules, drafter prompt or footnote rendering.
- Telemetry persisted under `metadata.drafter.claim_source_match.rebinding`: per-binding counts, `claim_mismatch_drops_before` / `_after`, `rebound_ref_count`, `capped_ref_count`, and a per-decision list with reason and score.

## Stage 1 — unit tests (frozen fixtures)

`src/test/claimSourceRebinding.test.ts` — **19/19 passed**. Coverage: generic-term rejection, Hebrew clitic/niqqud tolerance, identifier extraction, exact/facet/topical/area_direct/unbound, area fallback refusal for court holdings, statutory text, specific application and non-acquired bodies, hierarchy ordering, authority ordering, default and synthesis caps.

## Stage 2 — mini live smoke

| Run | Result | Notes |
|---|---|---|
| B8 (canonical quote control) | PASS | `canonical_quote_registry` branch, quote byte-identical |
| NATION-STATE-ACADEMIC | PASS | 9 refs rebound topically, 0 capped |
| P02 (safety control) | PASS | `docket_limitation` preserved |

## Stage 3 — full 10-query validation

| Run | Pass | Branch | Footnotes | mismatch before → after | rescued | capped |
|---|---|---|---|---|---|---|
| ACADEMIC | ✅ | — | 1 | 8 → 2 | 6 | 0 |
| NATION-STATE-ACADEMIC | ✅ | — | 2 | 8 → 6 | 2 | 0 |
| PAYWALL | ✅ | — | 1 | 3 → 0 | 3 | 0 |
| MMM | ✅ | — | 0 | 7 → 2 | 5 | 0 |
| B8 | ✅ | insufficient_sources_limitation | 0 | n/a | — | — |
| D1 | ✅ | insufficient_sources_limitation | 0 | n/a | — | — |
| D3 | ✅ | insufficient_sources_limitation | 0 | n/a | — | — |
| DARKPATTERNS | ✅ | — | 1 | 7 → 0 | 7 | 0 |
| R02 | ✅ | docket_limitation | 0 | n/a | — | — |
| P02 | ✅ | docket_limitation | 0 | n/a | — | — |

Aggregate on runs that reached claim-source-match: **33 legacy `claim_mismatch` drops → 10**, 23 refs rescued, 0 refs lost to the cap.

P02 errored once during the first Stage-3 pass at the **retrieval** stage (`Cannot read properties of undefined (reading 'length')`, transient, pre-dates this track — rebinding runs after the drafter). The clean re-run returned `docket_limitation` as required. Logged as a monitoring item.

## Before / after examples

**Rescued correctly**
- DARKPATTERNS `s1` / `s2`: verifier bound them to a sibling claim id, but `supported_points` shared 12–13 meaningful terms with the block ("דפוסים אפלים", "הטעיה", "הגנת הצרכן"). Previously dropped as `claim_mismatch`; now `topical` and cited.
- PAYWALL `s1`: three blocks on purposive interpretation previously lost all support from the same article; now bound topically, mismatch drops 3 → 0.
- MMM `s2`: Knesset research-centre material rebound topically to the enforcement block (score 4).

**Still dropped correctly**
- NATION-STATE-ACADEMIC `s1`, `s3`: `insufficient_authority_for_claim_category` — a scholarly source cannot carry a `scholarly_commentary`-typed block claiming court authority. Rule B/C untouched.
- ACADEMIC `s6`, `s7`, `s8`: `commentary_in_substantive_block` still applies even though these refs bound topically — binding rescues identity, it does not grant authority.
- MMM `s3`, NATION-STATE `s6`: remained `unbound` (below the two-meaningful-term threshold) and were dropped.
- R02 / P02: no candidate reached citation; docket refusals unchanged.

**Borderline decisions**
- MMM `s1` at score 2 (exactly the topical threshold) — accepted as `topical` but then dropped anyway by Rule B, so no citation risk materialised.
- ACADEMIC `s7` bound `exact` on one block and `topical` on another; the cap never engaged, so no selection was exercised — cap behaviour remains covered only by unit tests and should be watched in production.

## Monitoring

1. `capped_ref_count` stayed 0 across all runs — cap logic is live but untested in production traffic.
2. `area_direct` never fired in these 10 runs (0 occurrences); expected, given the conservative gate.
3. Transient retrieval-stage crash seen once on P02.
