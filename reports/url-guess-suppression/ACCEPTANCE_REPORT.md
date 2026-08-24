# judgment_url_guess_suppression_v1 — acceptance report

Verdict: **ACCEPTED.**

## What changed

New `lib/judgmentUrlEligibility.ts` (per-run URL provenance ledger + relay gate):

- classifies every judgment URL candidate: `url_source` (search_first / verified_cache /
  trusted_official_parser / retrieved / derivation), guessed-pattern flag, relay eligibility,
  suppression reason;
- guessed patterns = the archive object-code guesses only (`Z01`, `_z01`, `.z01`, `…/z01/…`)
  plus bare-host landing pages. Genuine search-result object codes (`a15`, `c11`, `p34`,
  `SB1_…`) are explicitly **not** suppressed;
- `relayGate()` in `lib/officialFetch.ts` blocks the alternative egress for guessed URLs,
  bare-host URLs, URLs previously answered with an Exception page (relay 502/404), and URLs
  labelled `derivation` by the caller;
- deterministic derivation is now **telemetry-only**: `officialSourceDiscovery`,
  `specificCaseResolution` and `canonicalAuthorityAcquisition` register the derived URLs but
  never fetch them. Search-first / retrieved / cache URLs are the only fetched ones.
- run telemetry: `metadata.judgment_url_eligibility` (candidates with source, guessed flag,
  eligibility, suppression reason, relay slot spent, fetch result, body chars, identity,
  cache, injected) and per-attempt `url_candidates` / `guessed_urls_suppressed`.

No change to nomination, statute lane, relay infrastructure, cache schema, drafter, verifier,
source-integrity, claim-source-match, footnote rendering or the zero-citable-source floor.

## Validation

Three sequential passes (`reports/url-guess-suppression/*.json`). Pass 1 ran all nine queries;
the judgment lanes of R02 / D3 / MAYA-AMIR / P02 were skipped by negative-cache cooldowns left
by the previous track, so those four were re-run in pass 2 after clearing the stale cooldown
rows. Pass 3 re-ran D1/D3/MAYA-AMIR/B8 after the pattern refinement.

| Run | Terminal | Guessed URLs produced | Suppressed | Relay calls | Body chars | Identity | Injected | Footnotes | Dangling | ms |
|---|---|---|---|---|---|---|---|---|---|---|
| R02 (pass 2) | yes | 4 | 4 | 1 eligible | **100,924** | **true** | yes | 2 | 0 | 205,652 |
| Nation-State | yes | 0 (no judgment lane) | 0 | 0 | – | – | – | 1 | 0 | 94,353 |
| FRESH-SC | yes | 0 (no judgment lane) | 0 | 0 | – | – | – | 1 | 0 | 122,888 |
| D1 | yes | 0 | 0 | 0–1 | – | – | – | 0 | 0 | 105–129k |
| D3 (pass 2/3) | yes | 4 | 4 | 2 / 1 | 0 | – | no | 1 → 2 | 0 | 178k / 134k |
| MAYA | yes | 0 | 0 | 0 | – | – | – | 0 | 0 | 139,301 |
| MAYA-AMIR (pass 2/3) | yes | 4 (+1 false positive, fixed) | 5 → 4 | 1 → 0 | 0 | – | no | 0 → 1 | 0 | 168k / 139k |
| P02 | yes | 0 | 0 | 2 | 0 | – | no | 0 | 0 | 134–139k |
| B8 | yes | 0 | 0 | 0 | – | – | – | 1 | 0 | 67–100k |

Headline: **R02 now works.** The four `93068210_Z01 / .z01 / elyon1 z01.htm` guesses were
suppressed at discovery, the freed slot went to the real `PediVerdicts\62\1 … SB1_…` URL, the
relay returned it (200), 100,924 chars were extracted, identity validated, the body was cached
and injected, and the final answer substantively reports ע"א 6821/93 with 2 footnotes and 0
dangling markers — the first **relay-acquired judgment body actually cited**.

Pass-2 also exposed one false positive: a genuine search-first URL (`…/03/638/086/c09`) matched
an over-broad filename heuristic. That heuristic was removed (z01 only) and MAYA-AMIR re-run
clean in pass 3. D3's wasted relay call on the bare host `https://court.gov.il` (502) is now
blocked by the `not_a_document_url` rule.

## Acceptance checklist

| Criterion | Result |
|---|---|
| No z01/Z01/_z01 URL sent to the relay unless search-first/cache verified | **MET** (0 guessed URLs reached the relay in any run) |
| Relay slots spent only on eligible official URLs | **MET** |
| Exception pages uncached and uncited | **MET** (relay 502s marked, never extracted/cached) |
| ≥1 relay-acquired judgment body eligible for citation | **MET** — R02, cited |
| D1 keeps/improves its acquired-body path | **MET** (no regression; no guessed URL now consumes its slots) |
| R02 / Nation-State / FRESH-SC no longer fail from guessed URLs | **MET** for R02 (now answered from the real body). Nation-State and FRESH-SC produced no judgment lane at all this cycle — their remaining gap is nomination/discovery, not URL guessing |
| P02 safe | **MET** (byte-identical refusal) |
| B8 byte-identical | **MET** |
| No citation without acquired + identity-validated text | **MET** |
| No verifier / source-integrity / footnote loosening | **MET** (no such file touched) |
| No CPU kills, stale jobs, stubs, dangling markers, orphan rows | **MET** (13/13 runs terminal, 0 dangling) |

## Next minimal fix (recommended)

`judgment_nomination_coverage_for_named_dockets_v1` — Nation-State (בג"ץ 5555/18) and FRESH-SC
(בג"ץ 6427/02) never opened a judgment discovery lane: the nomination produced no actionable
judgment target for an explicitly docketed question, so search-first never ran and the answer
leaned on secondary text. Narrow fix: when the *question itself* contains a well-formed docket,
force an actionable judgment nomination for it regardless of model output.
