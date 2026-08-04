# research_pack_hierarchy_v1 — 8-fixture validation report

Run date: 2026-08-04 · Engine: `legal-research-v1` (smoke mode) · No code changes in this run.
Raw per-fixture dumps: `reports/hierarchy-validation/<ID>.json`.

## 1. Classification summary

| Fixture | Query | Branch | Drafted | Classification |
|---|---|---|---|---|
| R08 | מבחן המידתיות (survey) | — (normal draft) | yes (10 used, 7 fn) | **hierarchy-pass** |
| R03 | הלכת השיתוף | — (normal draft) | yes (5 used, 3 fn) | **hierarchy-pass** |
| R04 | הרמת מסך | `insufficient_sources_limitation` | no | **not evaluable — no draft / no used_sources** |
| R09 | מבחן ההשתלבות | `insufficient_sources_limitation` | no | **not evaluable — no draft** (refusal correct & clean) |
| R02 | בנק המזרחי | — (normal draft) | yes (8 used, 5 fn) | **out-of-scope discovery failure** |
| R01 | קעדאן (control) | `docket_limitation` | no | **not evaluable — no draft** (retrieval variance this run) |
| B8 | canonical quote control | — (normal draft) | yes (6 used, 4 fn) | **hierarchy-pass** |
| P02 | fake docket control | `docket_limitation` | no | deterministic refusal — **as expected** |

No stubs, no verifier failures, `ok=true` on all 8, `hierarchy_order_applied=true` on all 8.

## 2. Per-fixture metrics (drafted fixtures)

### R08 — מבחן המידתיות — hierarchy-pass
- first_primary_position: **1**
- first_secondary_position: **6**
- primary_before_secondary_passed: **true**
- mixed_hierarchy_footnotes_count: 8 (all 8 **split**, `mixed_hierarchy_footnotes_split=8`)
- commentary_head_count (head 3): **0** · commentary_head5: 0 · primary_head5: 5
- head_cap_passed: **true**
- statute_identity_dedup_count: 0
- unrelated_excluded_from_carried_pack_count: 0 (carried pack 20)
- footnote 1 source type: **caselaw** — בג"ץ 3752/10 (usable judgment, full_text)
- used_sources order: judgment ×2 → statute/regulation ×3 → scholarship/commentary ×5
- Acceptance: first citation is the usable judgment, not scholarship ✅; no scholarship-only opening ✅.
  (Note: R08 drafted in this run, so it is evaluable — the earlier "retrieval variance" caveat does not apply here.)

### R03 — הלכת השיתוף — hierarchy-pass
- first_primary_position: **1** · first_secondary_position: **3**
- primary_before_secondary_passed: **true**
- mixed_hierarchy_footnotes_count: **0** ✅ (acceptance criterion met — no commentary+commentary+judgment compound)
- commentary_head_count: 1 · commentary_head5: 3 · primary_head5: 1 · head_cap_passed: **true** (only one usable primary exists, and it leads)
- statute_identity_dedup_count: 0
- unrelated_excluded_from_carried_pack_count: 0 (carried pack 21)
- footnote 1 source type: **caselaw** — רע"א 2299/23 (full_text)
- used_sources order: usable judgment → metadata-only judgment (ע"א 52/80) → commentary ×3

### R02 — בנק המזרחי — out-of-scope discovery/composition failure
- first_primary_position: 1 · first_secondary_position: 6 · primary_before_secondary_passed: true
- mixed_hierarchy_footnotes_count: 3 (all split) · commentary_head_count: 0 · head_cap_passed: true
- statute_identity_dedup_count: 0 · unrelated_excluded: 0 (carried pack 11)
- footnote 1 source type: `supreme_court_il` but titled **"מסמך מאתר אתר ממשלתי (gov.il)"** — an untitled gov.il document
- used_sources order: judgment → commentary ×2 → judgment → commentary ×4
- **Verdict:** hierarchy ordering behaved correctly on the pack it was given, but the pack still lacks a properly identified בנק המזרחי (ע"א 6821/93) judgment document; the closest item is a mistitled aggregate. This is a **discovery/acquisition/title-recovery failure, not a hierarchy failure**, and is explicitly reported as unresolved.

### B8 — canonical quote control — unchanged / hierarchy-pass
- first_primary_position: **1** · first_secondary_position: **2** · primary_before_secondary_passed: true
- mixed_hierarchy_footnotes_count: 1 (split) · commentary_head_count: 2 · commentary_head5: 4 · primary_head5: 1 · head_cap_passed: **true** (single usable primary, leads the pack)
- statute_identity_dedup_count: 0 · unrelated_excluded: 0 (carried pack 10)
- footnote 1 source type: **caselaw** — עע"מ 4614/05 (substantive_excerpt)
- Behaviour unchanged from prior baseline; canonical-quote branch intact.

## 3. Non-drafted fixtures

| Fixture | Refusal text | Cited sources | Pack telemetry |
|---|---|---|---|
| R04 | `insufficient_sources_limitation` — "לא נמצאה במקורות פסיקה ישירה…" | 0 | carried pack 16, **statute_identity_dedup_count = 1** (a duplicate statute mirror was collapsed in the pool before drafting) |
| R09 | `insufficient_sources_limitation` | 0 | carried pack 13, refusal clean, no noisy sources surfaced in the answer |
| R01 | `docket_limitation` (בג"ץ 6698/95 not acquired this run) | 0 | carried pack 9 |
| P02 | `docket_limitation` (ע"א 99999/99) | 0 | carried pack 2 — deterministic refusal, no fabrication |

## 4. Acceptance verdicts

| Criterion | Result |
|---|---|
| R08 — first used source / first citation is the usable judgment, not scholarship | ✅ pass (drafted this run) |
| R03 — no mixed primary/secondary compound footnotes | ✅ pass (`mixed_hierarchy_footnotes_count = 0`) |
| R04 — duplicate statute mirrors collapsed | ⚠️ partial — dedup fired (`count = 1`) but the fixture refused, so no cited footnotes to inspect; **not evaluable at the footnote level** |
| R09 — refusal clean, unrelated sources not shown as research material | ✅ pass |
| R01 — stable | ⚠️ regressed to `docket_limitation` this run — retrieval variance, not a hierarchy effect (hierarchy telemetry is inert on refusals) |
| B8 — unchanged | ✅ pass |
| P02 — deterministic refusal | ✅ pass |
| R02 — out of scope | ✅ reported as discovery/composition failure |
| No metadata-only holdings / no commentary as primary authority | ✅ every drafted fixture has a usable judgment at position 1 |
| No stubs / verifier failures | ✅ 8/8 `ok=true` |

## 5. Observations for the next track

1. **`unrelated_excluded_from_carried_pack_count` is 0 on all 8 fixtures.** Either no `unrelated` verdicts reach the carried-pack stage (they are dropped earlier in `candidatePool`), or the counter is not being incremented. Worth a one-line telemetry check before relying on this field.
2. **Mixed-footnote splitting is very active on survey-shaped answers** (R08: 8 splits). Splitting works, but the high rate suggests the drafter still attaches commentary to primary-supported propositions; the fix is currently downstream-only.
3. **R02's title quality is the blocker**, not ordering: a `supreme_court_il` document titled "מסמך מאתר אתר ממשלתי (gov.il)" is unusable as footnote 1 even when hierarchy places it first. Title recovery for gov.il/court documents is the natural next target.
4. **R01/R04/R09 refusal variance** — three of eight fixtures refused this run vs. prior baselines. Acquisition stability, not hierarchy, is the limiting factor on evaluability.
