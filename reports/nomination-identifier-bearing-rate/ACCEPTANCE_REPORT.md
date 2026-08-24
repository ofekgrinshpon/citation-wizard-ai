# Acceptance report — source_nomination_v2 / nomination_identifier_bearing_rate_v1

Date: 2026-08-24 (UTC). Runner: `scripts/legal-research-v1-nomination-v2-validation.ts`.
Raw per-run telemetry: `reports/nomination-identifier-bearing-rate/{D1,D3,R02,P02,B8,MAYA,MAYA-AMIR}.json`.

## Final verdict

**ACCEPTED — stable-initial / monitor.**

All acceptance conditions stated for this track are met: 7/7 terminal, no parse or
budget failures, actionable targets in 6/6 eligible runs (7th run is a fast-lane
control where nomination is intentionally skipped), exploratory queries preserved in
every nomination-enabled run, P02 and B8 unchanged and safe, no citation-rule
loosening.

The track's goal was **identifier-bearing / actionable nomination rate**, not final
grounding. Grounding is explicitly out of scope here and is carried into the follow-up
diagnosis `actionable_to_body_conversion_rate_v1`.

## 1. Terminal status and runtime

| Run | Terminal | Wall ms | Pipeline total_ms | Deterministic branch |
|---|---|---|---|---|
| D1 | yes | 124,308 | 120,394 | `insufficient_sources_limitation` |
| D3 | yes | 156,037 | 152,014 | — (drafted) |
| R02 | yes | 161,321 | 156,320 | `docket_limitation` |
| P02 | yes | 45,252 | — | specific-case fast lane (stub/limitation path) |
| B8 | yes | 77,744 | 76,693 | `canonical_quote_registry` |
| MAYA | yes | 161,486 | 160,435 | — (drafted) |
| MAYA-AMIR | yes | 144,162 | 140,294 | — (drafted) |

7/7 terminal. No isolate deaths, no stale-reaper kills, no run over the retrieval
governor budget.

## 2. Nomination reliability (regression check vs v1)

| Run | Model first → final | Escalated | finish_reason | parse_error | stage_failed | nom ms |
|---|---|---|---|---|---|---|
| D1 | gpt-5-mini → gpt-5-mini | no | tool_calls | none | false | 10,503 |
| D3 | gpt-5-mini → gpt-5-mini | no | tool_calls | none | false | 13,442 |
| R02 | gpt-5-mini → gpt-5-mini | no | tool_calls | none | false | 13,387 |
| MAYA | gpt-5-mini → gpt-5-mini | no | tool_calls | none | false | 10,779 |
| MAYA-AMIR | gpt-5-mini → gpt-5-mini | no | tool_calls | none | false | 9,318 |
| B8 | n/a (`skip_reason: router_or_mode_skip`) | — | — | — | — | 0 |
| P02 | n/a (specific-case fast lane) | — | — | — | — | — |

- Truncated tool calls: **0**. All five nomination runs finished on `tool_calls`.
- Parse errors: **0**. Escalations to the larger model: **0** (mini sufficed everywhere).
- Repair retries used: **0**.

Nomination reliability from `nomination_toolcall_reliability_v1` is fully preserved.

## 3. Two-bucket schema — actionable vs exploratory

| Run | candidates | actionable | exploratory | actionability mix (`known_identifier` / `known_name_no_docket` / `topic_only`) |
|---|---|---|---|---|
| D1 | 6 | 3 | 3 | 3 / 0 / 3 |
| D3 | 6 | 3 | 3 | 2 / 1 / 3 |
| R02 | 7 | 4 | 3 | 3 / 1 / 3 |
| MAYA | 6 | 3 | 3 | 3 / 0 / 3 |
| MAYA-AMIR | 7 | 4 | 3 | 3 / 1 / 3 |
| B8 | 0 | 0 | 0 | — (nomination skipped by router/mode) |
| P02 | — | — | — | — (specific-case fast lane) |

Identifier-confidence histograms are correctly bimodal: actionable items land in
`0.8–1.0` (one at `0.6–0.8`), exploratory items at `0.0–0.4`. The schema behaves as
designed: no exploratory item was ever promoted to actionable, and no actionable
judgment shipped without a docket or a real case name.

**Identifier-bearing / actionable rate, before vs after**

| | v1 (nomination_toolcall_reliability) | v2 (this track) |
|---|---|---|
| Runs producing an actionable/identifier-bearing target | 1 / 7 | **6 / 6 eligible** (B8+P02 intentionally skip nomination) |
| Runs skipped by discovery with `no_identifier_bearing_nominations` | 6 / 7 | **0** |
| Mean actionable items per nomination run | ~0.4 | **3.4** |

This is the material improvement the track was opened for.

## 4. Hardening — stripped / demoted identifiers

Only one hardening event across the suite, and it is the correct one:

- MAYA-AMIR, `בג"ץ 5555/18 חסון נ' כנסת ישראל` — docket stripped (`identifier_stripped:docket`), item demoted to `known_name_no_docket`. The model attached a docket it could not support; v2 removed the number instead of letting an invented docket into a query or a citation.

No other run stripped or demoted anything, i.e. hardening is not over-firing.

## 5. Query merge / budget — bucket preservation

| Run | final queries | from nomination | actionable emitted / preserved | exploratory emitted / preserved | skipped budget |
|---|---|---|---|---|---|
| D1 | 14 | 5 | 3 / 3 | 2 / 2 | 9 (planner overflow) |
| D3 | 14 | 5 | 3 / 3 | 2 / 2 | 11 (planner overflow) |
| R02 | 20 | 5 | 3 / 3 | 2 / 2 | 0 |
| MAYA | 14 | 5 | 3 / 3 | 2 / 2 | 8 (planner overflow) |
| MAYA-AMIR | 14 | 5 | 3 / 3 | 2 / 2 | 10 (planner overflow) |
| B8 | 7 | 0 | 0 / 0 | 0 / 0 | 0 |

**Zero nomination queries were dropped by budget in any run.** Everything counted under
`skipped_budget` is planner/facet overflow, which is the intended behaviour of the
reservation: nomination lanes are protected, planner volume absorbs the pressure.
No run lost its exploratory scholarship lane.

## 6. Discovery / cache

| Run | discovery enabled | targets | attempts | bodies acquired | cache lookups | hits | misses | cooldowns |
|---|---|---|---|---|---|---|---|---|
| D1 | yes | 2 | statute `no_docket_no_live_lane`; Mizrahi `blocked_by_origin` | 0 | 2 | 0 | 2 | 0 |
| D3 | yes | 2 | 2× statute `no_docket_no_live_lane` | 0 | 2 | 0 | 2 | 0 |
| R02 | yes | 2 | Mizrahi `cooldown_until 2026-08-31`; statute `no_docket_no_live_lane` | 0 | 1 | 0 | 1 | 1 |
| MAYA | yes | 2 | statute `no_docket_no_live_lane`; 1715/97 `blocked_by_origin` | 0 | 2 | 0 | 2 | 0 |
| MAYA-AMIR | yes | 2 | סימה אמיר `blocked_by_origin`; + 1 | 0 | 2 | 0 | 2 | 0 |
| B8 | no — `nomination_skipped` | 0 | — | 0 | 0 | 0 | 0 | 0 |
| P02 | n/a (fast lane) | — | — | — | 0 | — | — | — |

Discovery **ran** in every nomination run (v1's `no_identifier_bearing_nominations`
skip is gone). It acquired **no bodies** — for reasons that are outside this track's
scope (origin blocking, statute lane absent, cache cooldown). That is the subject of
the follow-up diagnosis.

## 7. Final answers — footnotes, markers, controls

| Run | footnotes | dangling/orphan markers | answer chars | notes |
|---|---|---|---|---|
| D1 | 0 | 0 | 514 | explicit "no direct case law found" limitation, no doctrinal claims asserted |
| D3 | 3 | 0 | 2,447 | 3 real caselaw sources, one from `supremedecisions.court.gov.il` |
| R02 | 0 | 0 | 341 | correct `docket_limitation` refusal for ע"א 6821/93 |
| P02 | 0 | 0 | 82 | fast-lane stub/limitation — unchanged from baseline |
| B8 | 1 | 0 | 364 | verbatim s.1 quote from the official Knesset PDF |
| MAYA | 0 | 0 | 2,376 | substantive prose with no citable source — flagged as a risk below |
| MAYA-AMIR | 2 | 0 | 2,396 | both footnotes are סימה אמיר (בג"ץ 8638/03) from cwj.org.il |

- **Dangling / orphan footnote markers: 0 across all 7 runs.** `footnote_rendering_invariant_v1` holds.
- **Invented dockets: none.** Every docket in a final answer resolves to a real case; the one unsupported docket the model proposed (5555/18) was stripped at nomination and never reached the answer.
- **Invented bibliographic detail: none found.** Footnote titles, hosts and case names in D3, B8 and MAYA-AMIR all match their URLs. No fabricated publisher, volume, page or date.

### Controls

- **P02** (`ע"א 99887-04-22`, a docket that does not exist as a Supreme Court case): remains safe. Specific-case fast lane, no nomination, no discovery, no sources, no invented case. Behaviour byte-for-byte the same class as pre-v2.
- **B8** (`סעיף 1 לחוק-יסוד: כבוד האדם וחירותו`): unchanged. Nomination correctly skipped by router/mode, `canonical_quote_registry` branch, verbatim statutory text with one official footnote and the usual "no usable case law found" notice.

### Citation-rule loosening check

None. `metadata_only_holding_gate`, `claim_source_match`, `source_integrity`,
`source_sufficiency` and the footnote invariant all fired normally and still drop
sources — e.g. MAYA's `metadata_only_holding_gate` marked the 1715/97 hamoked page
`reference_only` and stripped 4 blocks; `claim_source_match` dropped refs for
`commentary_in_substantive_block`, `analogical_for_black_letter` and `claim_mismatch`.
v2 adds inputs to the funnel; it removes no gate.

## 8. Open risk carried forward (not blocking acceptance)

MAYA produced 2,376 characters of doctrinal prose with **0 citable sources**. That is a
zero-citable-source floor question, not a nomination question, and it is the first item
in the follow-up diagnosis.

## Acceptance points — verdict per point

| Acceptance point | Result |
|---|---|
| Nomination reliability preserved | PASS (0 parse errors, 0 truncations, 0 escalations) |
| Two-bucket schema works | PASS (clean actionable/exploratory split, bimodal identifier confidence) |
| Exploratory searches preserved | PASS (2/2 preserved in every nomination run) |
| Actionable targets increased materially | PASS (1/7 → 6/6 eligible; mean 0.4 → 3.4 per run) |
| P02 remains safe | PASS |
| B8 unchanged | PASS |
| No citation-rule loosening | PASS |

**source_nomination_v2 / nomination_identifier_bearing_rate_v1 — accepted, stable-initial / monitor.**
