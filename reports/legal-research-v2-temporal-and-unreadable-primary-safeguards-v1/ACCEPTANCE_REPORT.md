# legal_research_v2_temporal_and_unreadable_primary_safeguards_v1 — Acceptance Report

## 1. Files changed (V2 only)

| File | Status | LOC (added/changed) |
|---|---|---|
| `supabase/functions/legal-research-v2/verification/temporalValidity.ts` | new | ~190 |
| `supabase/functions/legal-research-v2/verification/primaryProvenance.ts` | new | ~165 |
| `supabase/functions/legal-research-v2/types.ts` | edited | ~20 |
| `supabase/functions/legal-research-v2/agent/prompt.ts` | edited | ~8 |
| `supabase/functions/legal-research-v2/agent/researchAgent.ts` | edited | ~2 |
| `supabase/functions/legal-research-v2/verification/verify.ts` | edited | ~4 |
| `supabase/functions/legal-research-v2/drafting/draft.ts` | edited | ~18 |
| `supabase/functions/legal-research-v2/index.ts` | edited | ~70 (incl. eval token slot) |
| `src/test/legalResearchV2.safeguards.test.ts` | new | 10 tests |

## 2. Flow placement

Question → Intake → Research Agent → Memo → **baseline verification (identity/body/span/support unchanged)** →
**A. temporal assessment → at most one targeted temporal repair + reverify → temporal gate** →
**B. primary-gap detection → at most one authoritative-derivative fallback + full reverification → provenance annotation → deterministic disclosure block** →
Drafter (with advisories) → deterministic citation renderer → answer.

Verifier trust rules were not loosened; a derivative source passes the same identity/body/span/support checks.

## 3. Confirmations

- V1 untouched; no production routing to V2; V2 remains internal-only (403 without smoke credentials).
- Default models unchanged: agent/drafter `google/gemini-3.1-pro-preview`, verifier `google/gemini-3.7-flash`. Terra not promoted.
- No modes, source-count targets, ranking, pools, or diversity caps added.
- Tests: 48 files / 539 tests pass (10 new).

## 4. Live acceptance (3 runs, one each)

| Test | run_id | Latency | Steps | Prompt/Completion tokens | Cited | Invariant errors |
|---|---|---|---|---|---|---|
| T1 protection money (temporal) | 36844e4f | 205.7s | 19 | 312,701 / 18,976 | 3 | 0 |
| T2 Bavli (unreadable primary) | ac0d7232 | 121.0s | 23 | 434,398 / 7,357 | 1 | 0 |
| T3 doctrinal rabbinical-property regression | c1685bd2 | 241.0s | 20 | 272,546 / 14,694 | 1 | 0 |

### T1 — temporal failure reproduced and prevented
Telemetry: `temporal_sensitive_claims: 3`, `current_verified: 3`, `unresolved: 0`, `contradicted: 0`, `temporal_repairs: 1`.
The prior Terra-era failure ("no dedicated protection-money offence") does **not** recur: the answer now states s. 428A of the Penal Code (6 years, aggravated tiers), the evidentiary presumption and s. 428B forfeiture, all verified against current Knesset legislative material. The 2025 civil-compensation bill claim was **rejected** (`span_not_found`) and surfaced as an explicit limitation paragraph instead of being asserted.
Note (quality, not correctness): footnote 2 is a Wikipedia page — verified as a body but weak as authority.

### T2 — unreadable primary fallback
Telemetry: `primary_unreadable: ["בג\"ץ 1000/92"]`, `derivative_fallback_attempted: true`, `derivative_supported_authorities: []`, `derivative_disclosure_shown: false`.
The official court text was unreadable; the fallback path ran and the run recovered a **verified full judgment body** (judgments.org.il mirror) carrying the operative holding verbatim, so support stayed `primary_direct` and no derivative disclosure was needed. Two verified claims, one citation, no fabrication.

### T3 — regression preserved
Three verified claims, zero unsupported, no temporal downgrade of the 1994 Bavli holding, no derivative disclosure, one citation (Bar-Ilan law-review PDF). Old-but-valid doctrinal propositions were not gated.

## 5. Blockers / open items

1. Official court egress (`supremedecisions.court.gov.il`) still unreadable — the fallback masks it but does not fix it.
2. Cost per run remains high (272k–434k prompt tokens); the temporal check adds one batched call plus, when triggered, one repair cycle.
3. Source-quality (not correctness) gap: encyclopaedic sources can be cited when they pass all four checks.
4. Derivative disclosure path was exercised in unit tests but not yet on a live run where no primary mirror exists.

Stopping here per track scope.
