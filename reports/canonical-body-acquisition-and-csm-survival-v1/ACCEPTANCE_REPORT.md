# canonical_body_acquisition_and_csm_survival_v1 — acceptance report

Scope respected: no new LLM pass, no global pool inflation, no fixed footnote target,
no weakened identity/integrity gates, no fixture answers, no Hebrew style change.

## 1. What was implemented

| Area | Change |
|---|---|
| Relay diagnostics | `lib/courtRelayDiagnostics.ts` (now merged into `lib/courtEgress.ts`): one row per fetch — transport, relay vs upstream status, content-type, bytes, magic header, extracted chars, error stage, final classification. |
| Relay routing | `lib/officialFetch.ts`: **relay-first** for allowlisted `*.court.gov.il` hosts (the Supabase Edge egress is reset by the origin on *every* request), direct fetch only as fallback. Official cap 5→8/run; relay cap 3→10, spacing 1000→300 ms. |
| Provenance | `canonicalAuthorityAcquisition.ts` registers discovery-returned URLs as `search_first` so the relay gate treats them as trusted; guessed derivations stay suppressed. |
| Discovery precision | `canonicalRegistryDiscovery.ts`: the `official_host_targeted` allowance is **removed** — exact docket evidence in the result title or URL is now mandatory. |
| Cross-authority leakage | `lib/canonicalDiscoveryUrls.ts`: the targeted-source bypass is removed. The discovered-URL list is shared per run, and an untagged URL was being probed for the *wrong* authority. |
| Body identity | `canonicalAuthorityAcquisition.ts`: a docket hit anywhere in 20 000 chars is no longer proof. The docket must appear in the **document header (first 3 000 chars)** *and* a distinctive party token from the canonical label must appear in the body. |
| CSM survival | `stages/claimSourceMatch.ts`: deterministic survival/re-anchoring for body-acquired canonical authorities and directly relevant doctrinal scholarship, with `canonical_survival` rows + summary. Re-anchors only when the block text names the source or a verified claim/facet tag matches; hard legal-area mismatches still drop. |
| Tests | `src/test/canonicalSurvival.test.ts` (identity tokens); discovery test updated to the stricter rule. Full suite: 31 files / 307 tests green. |

## 2. Manual relay parity tests (decisive)

Same URL, same headers, two transports:

| URL | Direct edge | Relay |
|---|---|---|
| `…Download?fileName=23056580.T31.SUM&path=HebrewVerdicts/23/580/056/t31&type=4` | network error (`error sending request …`), 0 bytes | **200 `application/pdf`, 128 061 bytes, 27 636 extracted chars** |
| second Supreme Court judgment PDF | network error | **200 `application/pdf`, 364 164 bytes, 55 167 extracted chars** |

**The relay is healthy.** Body acquisition is no longer blocked by transport.

## 3. Live runs

| Case | run_id | ms | footnotes | canonical attempts | bodies |
|---|---|---|---|---|---|
| Q1 reasonableness (post-fix) | `227adcd9-47c4-4e60-925d-4b631d6a71aa` | 269 537 | 3 | 2 | 0 |
| Q2 administrative promise (post-fix) | `d822a1d6-e34a-45a6-97b1-b11ecb664dc0` | 269 031 | 2 | 2 | 0 |
| Q3 proportionality | `37391871-9861-4f94-889d-93c0858f9103` | 239 527 | 4 | 2 | 0 |
| AW7 academic | `f9455556-9d8c-4ee8-be59-5e8c2942fbed` | 178 043 | 2 | 2 | 0 |
| Q2 statutory | `73e33704-d700-4a3d-8105-3fd156875ede` | — | 0 | 0 | run did not persist a terminal answer |
| Q1 / Q2 pre-fix baseline | `92066114…`, `c139e27f…` | ~219 000 | 4 / 1 | 2 / 2 | 0 |

## 4. Two real defects found and fixed (the important result)

1. **Wrong body accepted as a canonical authority.** In the pre-fix Q1 run,
   `בג"ץ 389/80 דפי זהב` was recorded as `body_acquired`, `body_identity_validated=true`,
   6 000 chars — from a **2023 judgment PDF that merely cites 389/80**. The old check
   accepted a docket appearing anywhere in the text. This is a citation-integrity bug and
   it is now impossible (header + party token required).
2. **Cross-authority URL leakage.** In Q2 both `135/75` and `5018/91` were probed with the
   *same* URL, derived for the first docket, because targeted discovery URLs bypassed the
   per-docket check. Fixed.

## 5. Remaining gap (honest)

Canonical bodies are still 0/8 in the live runs, but the cause has moved:

- transport — solved (relay proven, 200 + extraction).
- identity — solved (no more false positives).
- **URL discovery for pre-1997 judgments is the blocker.** דפי זהב (1980), גנור (1989),
  סאי-טקס (1975), גדות (1991) have no derivable `supremedecisions` document path and
  targeted search returns no URL carrying their exact docket, so the run ends in
  `no_derivable_url` — the correct, honest outcome, versus the previous silent
  wrong-body attachment. Modern dockets (5658/23, 1715/97-era) do resolve to real relay-fetchable PDFs.
- `court_egress` / `court_relay_fetch_diagnostics` are computed but not visible under the
  persisted metadata keys inspected here; per-run relay rows should be wired into the
  retrieval telemetry object next.

## 6. Recommendation

Next track: **canonical URL resolution for historic judgments** — an official/verified
docket→document index (Supreme Court archive index pages, gov.il decision collectors) fed
into the same relay path, plus persisting the relay diagnostic rows in metadata. Footnote
counts will not rise materially until historic bodies can be fetched; forcing them without
a body would violate the integrity rules that were just tightened.
