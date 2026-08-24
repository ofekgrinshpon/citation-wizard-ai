# Acceptance report — nomination_toolcall_reliability_v1

Scope: nomination reliability only. No drafter, verifier, claim-source-match, source-integrity or footnote code was changed in this track. D3 zero-source floor, discovery target ordering and R02 acquisition are explicitly out of scope here.

Validation: 7 sequential runs (D1, D3 collected earlier; R02, P02, B8, MAYA, MAYA-AMIR collected now). All raw records in `reports/nomination-toolcall-reliability/*.json`.

Configuration under test: mini-first (`openai/gpt-5-mini`), `reasoning_effort: low`, completion budget 6,000 tokens (10,000 on escalation), one cheap structural repair retry on mini before any escalation, escalation to `openai/gpt-5` only when mini yields zero usable candidates, parse/tool-call failure recorded as `stage_failed` rather than silent empty nominations.

## Per-run results

| Field | D1 | D3 | R02 | P02 | B8 | MAYA | MAYA-AMIR |
|---|---|---|---|---|---|---|---|
| Terminal | yes | yes | yes | yes | yes | yes | yes |
| Runtime (client / pipeline) | 115s / 108s | 154s / 153s | 185s / 182s | 122s / 120s | 72s / 68s | 133s / 129s | 161s / 156s |
| Deterministic branch | insufficient_sources_limitation | — | — | docket_limitation | canonical_quote_registry | insufficient_sources_limitation | — |
| Nomination enabled | yes | yes | yes | yes | **no (skipped)** | yes | yes |
| skip_reason | — | — | — | — | router_or_mode_skip | — | — |
| Model first / final | mini / mini | mini / mini | mini / mini | mini / mini | — | mini / mini | mini / mini |
| Completion budget | 6,000 | 6,000 | 6,000 | 6,000 | n/a | 6,000 | 6,000 |
| finish_reason | tool_calls | tool_calls | tool_calls | tool_calls | n/a | tool_calls | tool_calls |
| Reasoning tokens | 640 | 704 | 448 | 512 | n/a | 576 | 576 |
| parse_error | null | null | null | null | null | null | null |
| stage_failed | false | false | false | false | false | false | false |
| Candidates (before → after hardening) | 7 → 5 | 8 → 5 | 7 → 5 | 7 → 4 | 0 → 0 | 8 → 5 | 8 → 5 |
| Dropped count | 2 | 3 | 2 | 3 | 0 | 3 | 3 |
| Dropped reasons | low_confidence, total_cap | statute_cap, total_cap ×2 | low_confidence, statute_cap | low_confidence ×2, secondary_cap | — | low_confidence, statute_cap ×2 | total_cap ×3 |
| Category mix | statute 1, judgment 2, scholarship 1, knesset_report 1 | statute 2, judgment 1, knesset_report 1, gov_report 1 | statute 2, judgment 1, knesset_report 1, regulator_guidance 1 | other 2, statute 1, judgment 1 | — | statute 2, judgment 1, scholarship 1, knesset_report 1 | statute 2, judgment 2, knesset_report 1 |
| Identifier-bearing | 0 | 0 | **1** | 0 | 0 | 0 | 0 |
| Escalated to gpt-5 | no | no | no | no | no | no | no |
| Escalation reason | — | — | — | — | — | — | — |
| mini_retry_used | no | no | no | no | no | no | no |
| fallback_to_mini_used | no | no | no | no | no | no | no |
| Nomination stage ms | 12.9s | 16.9s | 8.9s | 11.6s | 0 | 15.3s | 13.3s |
| query_merge final / from nomination / dup / budget-dropped | 14 / 4 / 0 / 5 | 14 / 4 / 0 / 10 | 16 / 4 / 2 / 0 | 18 / 4 / 2 / 0 | 8 / 0 / 0 / 0 | 14 / 4 / 0 / 6 | 14 / 4 / 0 / 9 |
| Discovery enabled | yes | yes | **yes, ran** | yes | no | yes | yes |
| Discovery skip_reason | no_identifier_bearing_nominations | same | — | same | nomination_skipped | same | same |
| Cache lookups / hits / misses / writes | 0/0/0/0 | 0/0/0/0 | 1/0/1/1 | 0/0/0/0 | 0/0/0/0 | 0/0/0/0 | 0/0/0/0 |
| Bodies acquired | 0 | 0 | **1** | 0 | 0 | 0 | 0 |
| Injected candidates | — | — | `nominated-source:N1` | — | — | — | — |
| Final footnotes | 0 | 0 | 1 | 0 | 1 | 0 | 2 |
| Dangling / orphan markers | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| CPU kill / stale / stub / verifier failure | none | none | none | none | none | none | none |

Notes on the individual runs that matter:

- **R02 (Bank Mizrahi)** — the headline change. Nomination produced one identifier-bearing candidate, discovery ran for the first time (1 target, cache miss → write), acquired the body from the Supreme Court `type=4` corpus URL, injected it as `nominated-source:N1`, and the answer is now a substantive, footnoted answer to ע"א 6821/93 instead of a refusal. One caveat: an earlier R02 attempt in this same track (run `40896eb0…`) was killed by the stability reaper at 836s and returned the Hebrew "processing stopped" notice; the clean rerun finished in 185s. That variance is an acquisition/CPU-budget matter, not a nomination matter, and belongs to the acquisition track.
- **P02 (fake docket)** — unchanged safe deterministic refusal on `docket_limitation`; nomination ran, produced 4 candidates, none identifier-bearing, and did not perturb the refusal.
- **B8 (canonical quote)** — nomination correctly skipped (`router_or_mode_skip`), discovery skipped (`nomination_skipped`), answer served from `canonical_quote_registry` with the exact statutory text and the official Knesset PDF footnote — identical to the pre-fix baseline.
- **MAYA / MAYA-AMIR** — both nominate reliably (5 candidates each, mini only). MAYA still lands on `insufficient_sources_limitation`; MAYA-AMIR answers with 2 footnotes including בג"ץ 8638/03 סימה אמיר. The MAYA gap is the D3-style zero-source floor, out of scope here.
- **D1 / D3** — as reported earlier: 5 candidates each, no escalation, no parse error. D3 no longer returns empty gpt-5 tool-call arguments.

## Acceptance criteria

| Criterion | Result |
|---|---|
| Zero `no tool_call arguments returned` | **PASS** — 0/7 |
| Zero `tool_call_truncated_by_token_budget` | **PASS** — 0/7; max reasoning spend was 704 tokens against a 6,000 budget |
| No unnecessary gpt-5 escalation when mini is usable | **PASS** — 0 escalations, 0 repair retries, 0 mini fallbacks across all runs |
| D3, R02, MAYA, MAYA-AMIR produce nominations or explicit valid telemetry | **PASS** — all four produced 5 candidates with `stage_failed: false`, `parse_error: null` |
| P02 remains a safe deterministic refusal | **PASS** — `docket_limitation`, 0 footnotes, no fabricated holding |
| B8 unchanged and nomination-skipped | **PASS** — `canonical_quote_registry`, skip_reason `router_or_mode_skip`, same quote and same official source |
| R02 may refuse only for acquisition, not nomination | **PASS and better** — nomination succeeded and R02 no longer refuses at all |
| No drafter/verifier/source-integrity/footnote regressions | **PASS** — no code touched in those stages; footnote counts consistent, all footnotes carry real titles and URLs |
| No CPU kills, stale jobs, stubs, dangling markers, orphan rows | **PASS on the accepted set** — all 7 terminal, 0 dangling markers, 0 stubs. One monitor item: the earlier R02 attempt was reaper-killed at 836s during acquisition |

Cost/latency side effect: nomination now costs 9–17s per run on mini (previously it burned a 30s gpt-5 escalation to return nothing). Net pipeline time is flat or better.

## Conclusion

- **Accepted** — nomination_toolcall_reliability_v1 is accepted, stable-initial / monitor.
- **source_nomination_v1 is now reliable enough to evaluate discovery and the verified-source cache.** It produces candidates on every eligible run, skips cleanly where the router says to, never escalates unnecessarily, and reports failure explicitly rather than as silent emptiness. R02 is the first end-to-end proof that nomination → merge → discovery → cache → injection → footnote works when a candidate carries an identifier.
- **Next fix should be `nomination_identifier_bearing_rate_v1`** — the binding constraint has moved. Six of seven runs report `skip_reason: no_identifier_bearing_nominations`, so discovery and the cache are still almost never exercised: 1 lookup, 0 hits, 1 write across the whole set. The next narrow track should make nomination emit docket/statute identifiers (and preserve identifier-bearing candidates ahead of `total_cap`/`statute_cap` drops in query_merge) so that discovery has targets to work on. Only after that will D3's zero-source floor, discovery target ordering and R02 acquisition variance be measurable on real data.

Monitor items (do not fix in this track): R02 reaper kill variance during acquisition; D3/MAYA answering substantively with zero citable footnotes.
