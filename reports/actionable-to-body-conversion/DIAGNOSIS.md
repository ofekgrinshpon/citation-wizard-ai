# Read-only diagnosis — actionable_to_body_conversion_rate_v1

Status: **diagnosis only, no code changes.**
Evidence: the 7-run `source_nomination_v2` validation suite
(`reports/nomination-identifier-bearing-rate/*.json`) plus a read of
`stages/officialSourceDiscovery.ts`, `stages/verifiedSourceCache.ts`,
`stages/queryMergeAndBudget.ts`, `stages/claimSourceMatch.ts`.

## 0. The question

`source_nomination_v2` fixed the *front* of the pipeline: 6/6 eligible runs now
produce actionable, identifier-bearing targets (was 1/7). But **0 bodies were
acquired in all 7 runs**, and 3 runs (D1, R02, MAYA) finished with 0 footnotes.
Where does an actionable source die between nomination and a footnote?

## 1. The funnel, measured

Across the 5 nomination-enabled runs (D1, D3, R02, MAYA, MAYA-AMIR):

| Stage | Count | Loss |
|---|---|---|
| Actionable nominations produced | 17 | — |
| Passed to discovery as targets | 10 | −7 (discovery target cap of 2/run) |
| Actually attempted (network) | 4 | −6 (lane/cooldown skips) |
| Reached an origin | 4 | 0 |
| Returned a usable body | **0** | −4 (all `blocked_by_origin`) |
| Injected as candidates | **0** | — |
| Cited in a footnote | **0** | — |

Every footnote in the suite (D3 ×3, B8 ×1, MAYA-AMIR ×2) came from **ordinary
retrieval**, not from a nominated actionable target. Nomination currently
contributes queries, not bodies.

## 2. The four loss buckets, in order of size

### L1 — Statutes have no acquisition lane at all (4 of 6 skips)

`officialSourceDiscovery.ts:412-417`: the live lane is entered only when the
nomination has a normalized docket, or when it is a **judgment** with
`known_name_no_docket`. Anything else falls through to
`attempt.reason = "no_docket_no_live_lane"`.

A statute never has a docket. So every statutory actionable nomination is
skipped without a single network attempt:

- D1 — `חוק בתי דין רבניים (נישואין וגירושין), תשי"ד-1954` → `no_docket_no_live_lane`
- D3 — both statutory targets (N1, N2) → `no_docket_no_live_lane`
- R02 — `חוק-יסוד: כבוד האדם וחירותו` → `no_docket_no_live_lane`
- MAYA — same statute as D1 → `no_docket_no_live_lane`

This is the single largest and most fixable loss. The system *already* knows how
to fetch statutory text — `statuteTextAcquisition.ts` and the canonical-quote
registry did exactly that for B8 — but discovery does not route statutes there.
The competence exists; the wiring doesn't.

### L2 — Supreme Court origin blocking kills every judgment attempt (4 of 4 attempts)

All four judgment attempts that reached the network came back
`blocked_by_origin:חסימת בקשה לא מורשת`:

| Run | Target | URLs tried |
|---|---|---|
| D1 | ע"א 6821/93 בנק המזרחי | `supremedecisions…type=2` ×2, `elyon1…htm` |
| MAYA | בג"ץ 1715/97 לשכת מנהלי ההשקעות | `93/…_Z01.txt&type=2`, `.z01&type=2`, `elyon1…htm` |
| MAYA-AMIR | בג"ץ 8497/00 סימה אמיר | same 3-shape derivation |
| R02 | ע"א 6821/93 | not attempted — negative cache cooldown from the D1 failure |

Two observations:

1. The **`type=4` last-resort probe is not being used here.** `type4_last_resort_probe_v1` demonstrated that `type=4` corpus URLs return real PDFs where `type=2` returns WAF pages, but the URL lists in these attempts contain only `type=2` and `elyon1` shapes. The probe is either gated behind the canonical/registry lane or ordered after an early bail on the first block. Either way, the one derivation known to work is not reaching nominated targets.
2. **Derivation, not blocking, is likely the real cause for the older cases.** `official_judgment_source_discovery_v1` already established that these "WAF blocks" are the origin's response to a *wrong document code* (`Z01` guessed where the real code is e.g. `a15`). We are not being throttled; we are asking for files that do not exist under the derived path. Retrying, backing off, or adding headers will not help — search-first discovery of the true `fileName` will.

Corroborating: MAYA-AMIR's answer cites **סימה אמיר בג"ץ 8638/03** (via cwj.org.il),
while discovery derived and failed on **8497/00**. The docket the model nominated
and the docket that actually exists differ, and ordinary retrieval found the real
one. Deterministic derivation from a model-supplied docket is structurally fragile.

### L3 — Negative cache cooldown suppresses retry across runs (1 skip, growing)

`verifiedSourceCache.ts:109-111`: a failure writes a negative row with a
7-day base cooldown doubling per failure, capped at 60 days. R02 was skipped with
`cooldown_until:2026-08-31` because D1 had failed the same docket minutes earlier.

Correct as designed — but it means one bad derivation attempt suppresses the
canonical Mizrahi judgment for a week, including after a fix ships. The cooldown
keys on the docket, not on the *derivation strategy that failed*, so a new lane
(e.g. `type=4`, or search-first) inherits the old lane's punishment.

### L4 — The discovery target cap drops 7 of 17 actionable nominations

Every run shows `targets: 2` while nomination produced 3–4 actionable items.
Because the cap is applied before the lane check, a run can spend both target
slots on items that will be skipped anyway (D3 spent both on statutes → zero
network attempts) while a genuinely fetchable judgment never gets a slot. The cap
is not the binding constraint today (L1/L2 would fail anyway), but it will become
one the moment L1 is fixed.

## 3. Downstream: what happens to a body-less actionable source

Even when a nominated case *is* found by ordinary retrieval, it usually cannot be
cited, because the post-draft gates require read text:

- `metadata_only_holding_gate` — MAYA: the 1715/97 hamoked page was classified `reference_only`, 4 blocks stripped, 4 ref occurrences removed. Correct behaviour: a metadata page cannot carry a holding.
- `claim_source_match` — MAYA/D1: refs dropped for `commentary_in_substantive_block`, `analogical_for_black_letter`, `claim_mismatch`.
- `source_sufficiency` — D1: `no_statutory_caselaw_or_doctrinal_anchor` → limitation, 0 footnotes.

None of these gates is wrong. They are the reason the answers are not fabricated.
The problem is upstream starvation: with no acquired bodies, the gates have
nothing admissible left, and the run lands on a limitation or (worse, see below)
on uncited prose.

## 4. The one genuine quality defect this exposes

**MAYA produced 2,376 characters of substantive doctrinal prose with 0 footnotes.**
D1 and R02 handled the same starvation correctly (short limitation / refusal); MAYA
did not. There is no floor enforcing "if zero citable sources survive, do not
present multi-paragraph doctrinal analysis as an answer." That is a correctness
risk independent of retrieval, and it is the highest-severity item here.

## 5. Ranked recommendations (not implemented)

| # | Fix | Expected conversion gain | Risk |
|---|---|---|---|
| R1 | **Statute lane in discovery** — route `statute`/`bill`/`regulation` nominations to the existing `statuteTextAcquisition` path instead of `no_docket_no_live_lane`. | 4 of 6 skips become real attempts, against origins that are *not* blocking. Likely the largest single win. | Low — reuses a proven, already-gated acquisition path. |
| R2 | **Zero-citable-source floor** — when no source survives the gates, force the limitation/short-answer shape; never emit multi-paragraph doctrinal prose uncited. | Closes the MAYA defect. | Low. Pure output-shape guard. |
| R3 | **Search-first for nominated judgments** — resolve the real `fileName`/document code before deriving a URL, and treat the model's docket as a hint to verify rather than a key to derive from. Also fixes the 8497/00 vs 8638/03 class of error. | Turns 4 hard failures into candidate resolutions. | Medium — new discovery step, needs identity validation to avoid citing the wrong case. |
| R4 | **Make `type=4` reachable from the nomination lane**, not only the canonical/registry lane. | Cheap partial of R3 for cases whose code is derivable. | Low. |
| R5 | **Key the negative cache on (docket, strategy)** and invalidate rows on discovery-version bump, so a fix ships without a 7–60 day shadow. | Unblocks validation of R3/R4. | Low. |
| R6 | **Apply the discovery target cap after the lane check**, so slots go to fetchable targets. | Prevents R1 from being immediately re-bottlenecked. | Low. |

Suggested order: **R2 (safety) → R1 (largest, lowest risk) → R5 → R6 → R3/R4**.

## 6. Explicit non-findings

- Nomination is not the bottleneck any more. Quality, hardening and bucket balance are all sound.
- Query merge is not dropping nomination work: 0 nomination queries lost to budget in any run.
- The verifier and the citation gates are not over-firing; they are correctly refusing to cite metadata-only and commentary sources.
- No fabricated dockets, titles or bibliographic details appeared in any final answer.
