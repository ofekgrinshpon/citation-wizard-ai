# official_fetch_profile_v1 — acceptance report

Verdict: **PARTIAL** (safe to keep; primary acceptance criterion not met for `*.court.gov.il`)

## What was implemented (scope-clean)

New shared helper `supabase/functions/legal-research-v1/lib/officialFetch.ts`:

- Browser-like profile on official/high-trust hosts only (Chrome UA, `Accept`,
  `Accept-Language: he-IL,...`, same-origin `Referer`, redirects + query params preserved).
  No cookies minted, no challenge solving, no auth/paywall bypass.
- Serialisation, caps and backoff for burst-limited `*.court.gov.il`:
  single in-flight chain, max 5 official court fetches/run, ≥700 ms spacing,
  exponential backoff (0.9→4 s), hard stop after 3 consecutive resets/403s.
- Block-page detection kept (`looksLikeBlockPage`, existing per-caller `inspectText`);
  block pages are never extracted or cached.
- Full per-attempt telemetry (`metadata.official_fetch`): host, status, content-type,
  content-length, redirect flag, block-page flag, reset/rate-limit flag, error, ms, skip reason.

Wired into: `judgmentTextAcquisition.fetchBytes`, `tryWrapperResolve`,
`statuteTextAcquisition.fetchCapped`. Ledger reset per run in `index.ts`.
No drafter / verifier / source-integrity / claim-source-match / footnote / mirror /
corpus / URL-derivation changes.

## Validation (8 sequential runs, all terminal, no CPU kills, no stubs, no stale jobs)

| Run | branch | official fetches | block pages | bodies acquired | cache writes | footnotes | dangling | ms |
|---|---|---|---|---|---|---|---|---|
| D1 | insufficient_sources_limitation | 0 | 0 | 0 | 0 | 0 | 0 | 124 s |
| D3 | drafted | 1 court + 3 gov/knesset/nevo | 0 | 1 (Basic Law, 28 396 ch) | 1 | 1 | 0 | 151 s |
| MAYA-AMIR | drafted | 1 | 0 | 0 | 0 | 2 | 0 | 140 s |
| R02 | docket_limitation | 3 (+1 skipped by cap) | 0 | 0 (cache hit 28 396 ch statute) | 0 | 0 | 0 | 162 s |
| MAYA | drafted-lite (insufficient_sources) | 1 court + nevo | 0 | 1 (Rabbinical Courts Act, 10 813 ch) | 1 | 0 | 0 | 122 s |
| NATION-STATE | drafted | 3 (+1 skipped by cap) | 0 | 0 | 0 | 1 | 0 | 128 s |
| P02 | docket_limitation | 0 court, 3×gov 403 | 0 | 1 (CPR statute) | 1 | 0 | 0 | 117 s |
| B8 | canonical_quote_registry | 0 court, knesset PDF 200 | 0 | 0 | 0 | 1 | 0 | 84 s |

## Findings

1. **Block pages are gone.** Zero `חסימת בקשה לא מורשת` interstitials across all 8 runs
   (previously the dominant failure). Nothing block-shaped was extracted or cached.
2. **Official statute/knesset/gov hosts now fetch cleanly** with the profile:
   `fs.knesset.gov.il`, `main.knesset.gov.il`, `m.knesset.gov.il` (PDF/DOC 200),
   `nevo.co.il` (200), producing 3 verified cache writes (D3, MAYA, P02) with real bodies.
3. **`*.court.gov.il` is now IP-blocked, not header-blocked.** Every request from the
   edge runtime failed at the transport layer (`connection error: Connection reset`),
   including the exact URL that, from a different egress IP with the *same* headers,
   returns a real 364 KB PDF (verified live during this validation:
   `.../fileName=15073390.t06&type=4` → HTTP 200, `application/pdf`, 364 164 bytes).
   Classification for this class updates from `fetch_profile_missing` to
   **`genuine_origin_block` at the egress-IP level**.
4. **Caps/backoff behaved exactly as specified.** R02 and NATION-STATE show the
   backoff ladder (0.3 s → 1.2 s → 2.2 s) and then `stopped_reason: repeated_connection_reset`
   with the 4th attempt skipped. No parallel court fetches, no hammering, ≤5 per run.
5. **Safety preserved.** P02 stayed `docket_limitation`; B8 stayed
   `canonical_quote_registry` with the byte-identical canonical quote; R02 refused rather
   than citing an unacquired judgment; zero dangling/orphan markers anywhere;
   no metadata-only holdings cited.

## Acceptance checklist

| Criterion | Result |
|---|---|
| A previously `blocked_by_origin` official court URL now yields a real body | **NOT MET** — court.gov.il resets at TCP/TLS from the edge egress IP |
| Previously blocked official *gov/knesset* URLs now yield real bodies | MET (3 statute bodies acquired + cached) |
| No block page cached or cited | MET |
| No citation without acquired + identity-validated text | MET |
| Serialised / capped / backed off | MET |
| No origin hammering | MET |
| P02 safe | MET |
| B8 byte-identical | MET |
| No verifier / integrity / footnote loosening | MET |
| No CPU kills, stale jobs, stubs, dangling markers, orphan rows | MET |

## Recommended next fix

The header hypothesis is now settled: headers were necessary but not sufficient, and the
residual barrier for `*.court.gov.il` is egress-IP level. Recommended order:

1. `official_court_egress_path_v1` — route only `*.court.gov.il` document fetches through a
   different egress path (allowlisted, rate-limited, single-flight, same browser-like profile),
   since the origin serves the same URLs normally from other IPs.
2. `actionable_extraction_budget_reservation_v1` — reserve extraction budget for actionable
   nominations before exploratory extraction (MAYA-AMIR class).
3. URL correctness — remove the `Z01`/`z01` derivation guesses (R02, NATION-STATE burned
   2 of 3 court slots on derived URLs that were wrong before they were blocked).
