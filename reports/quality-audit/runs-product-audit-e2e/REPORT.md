# Fresh end-to-end product audit — post `synthesis_source_pack_separation_v1`

Date: 2026-08-01 · 14 fresh queries (not the golden/debug set) · no code changes
Raw telemetry: `reports/quality-audit/runs-product-audit-e2e/*.json`
Runner: `scripts/legal-research-v1-product-audit-e2e.ts`

Track status recorded: **`synthesis_source_pack_separation_v1` = default-on / monitor.**

## 1. Results table

| # | Kind | Branch | research_mode / shape | Sufficiency | Source pack quality | Grade | Main defect |
|---|---|---|---|---|---|---|---|
| P01 | specific case holding (בג"ץ 6698/95 קעדאן) | `docket_limitation` | specific_case / case_holding | n/a (anchor missing) | 0 admitted | **too limited** | Landmark judgment exists online but no usable text acquired → honest refusal on a case we should answer |
| P02 | fake/unknown docket (ע"א 99887-04-22) | *none* | specific_case / case_holding | pass | 9 sources, all `commentary` incl. psakdin **listing/index** URLs | **unsafe** | Answered substantively about platform liability from commentary + listing pages instead of firing `docket_limitation` |
| P03 | statute section definition (ס' 1 חוק החוזים) | `statute_section_quote_refusal` | canonical_quote / quote | n/a | 1 statute, wikisource `substantive_excerpt` | **too limited** | Mirror text not accepted as verified → refusal on a trivially available section |
| P04 | canonical quote (ס' 8 חו"י כבוד האדם) | `statute_section_quote_refusal` | canonical_quote / quote | n/a | 1 Knesset PDF, `metadata_only` | **too limited** | Canonical-quote registry did not cover the limitation clause; PDF text not extracted |
| P05 | case-law synthesis (תום לב במו"מ, ס' 12) | *none* (framing correction active) | case_law_synthesis / analysis | pass | 10 sources; 1 judgment `full_text`, rest statute/commentary | **acceptable** | Framing correction suppressed synthesis rendering; answer is statute-led, cases never named despite a full-text judgment in the pack |
| P06 | misframed doctrine ("הלכת ההסתמכות ההפוכה") | `insufficient_sources_limitation` | case_law_synthesis / analysis | fail | 0 used | **good** | Correct honest refusal + "what was found" note |
| P07 | doctrine explanation (ביטול יחסי) | `insufficient_sources_limitation` | doctrine_explanation / analysis | fail | 0 used (relevant scholarship present but not admitted) | **too limited** | Real, well-documented doctrine refused; sufficiency gate requires direct case law |
| P08 | practical steps (תביעות קטנות) | `insufficient_sources_limitation` | practical_steps / list | fail | 0 used; statute + fee regulations found but unused | **too limited** | Statute/regulation-backed procedural answer is possible; gate demands caselaw |
| P09 | worker/contractor classification | `insufficient_sources_limitation` | doctrine_explanation / analysis | fail | 0 used; only reports/מבקר המדינה | **too limited** | Core labour-law doctrine (מבחן ההשתלבות) not retrieved at all |
| P10 | mutual wills (ס' 8א חוק הירושה) | `insufficient_sources_limitation` | doctrine_explanation / analysis | fail | 0 used; חוק הירושה + a district judgment file found | **too limited** | Statutory anchor present but discarded by the gate |
| P11 | constitutional doctrine (פגיעה + מידתיות) | *none* | doctrine_explanation / definition | pass | 14 sources, all `metadata_only`; 3 judgments metadata-only | **acceptable** | Correct doctrinal content, but no judgment named and every source is metadata-only — authority thin |
| P12 | tenant deposit (practical) | `insufficient_sources_limitation` | doctrine_explanation / analysis | fail | 0 used; חוק השכירות והשאילה found | **too limited** | Consumer-facing question refused despite governing statute in pack |
| P13 | specific case holding (ע"א 6821/93 בנק המזרחי) | `docket_limitation` | specific_case / case_holding | n/a | 0 admitted | **too limited** | Same as P01 — the single most cited Israeli judgment not acquirable |
| P14 | synthesis (הרמת מסך בחברות משפחתיות) | `insufficient_sources_limitation` | case_law_synthesis / analysis | fail | 0 used | **too limited** | No judgments retrieved; ס' 6 לחוק החברות not even offered as background |

Grades: good 1 · acceptable 2 · too limited 10 · unsafe 1.

## 2. Acceptance criteria

| Criterion | Result |
|---|---|
| No hallucinated holdings | **Pass** — no invented case names or holdings anywhere |
| No metadata-only holdings | **Pass** — `metadata_only_sources_used_as_holdings=false` on every synthesis-eligible run |
| No commentary as primary authority | **Fail (P02)** — whole answer rests on commentary; flag is `false` only because synthesis rendering was not active in `specific_case` mode |
| No fake/listing URLs cited | **Fail (P02)** — `psakdin.co.il/Court` index and near-empty court pages cited as footnotes |
| No generic procedure-only advice | **Pass** (by refusal, not by quality) |
| No false premise validation | **Pass** — P06 correctly rejected the invented doctrine; P05 correctly reframed "הלכת תום הלב" to ס' 12 |
| Anchored questions answer/refuse correctly | **Partial** — refusals are honest (P01/P13) but wrong-direction: the anchors are real and public |
| Synthesis uses usable authorities or limits honestly | **Pass** — P14/P06 limited honestly; P05 had one usable judgment but rendering was pre-empted by framing correction |

Regression check on the closed track: separation held everywhere. No stubs, no verifier failures, all 14 runs `ok=true`.

## 3. Diagnosis — the shape of the failure has changed

The safety layers all work. The system is now **over-refusing**: 10/14 answers are limitations, and most of them are on questions a competent Israeli lawyer answers from public material. Three distinct causes:

1. **Docket-anchored acquisition is failing on landmark Supreme Court cases** (P01, P13). `supremedecisions.court.gov.il` results are admitted as `metadata_only`; the acquisition step does not resolve them to text, so the exact-docket anchor stays unmet and `docket_limitation` fires. This is the single most damaging user-visible defect — the two most famous dockets in Israeli law both refuse.
2. **The sufficiency gate treats statute-only packs as insufficient** (P07, P08, P10, P12, P14). For `practical_steps`, statutory-definition and consumer questions, a governing statute plus regulations *is* sufficient authority; the gate requires direct case law and therefore discards it. This produces the "too limited" cluster and, for P08/P12, a bad product experience.
3. **Statute-text verification is too strict** (P03, P04). Wikisource `substantive_excerpt` and the official Knesset PDF were both present and both rejected, so a plain "quote §8" request refuses.

And one safety hole, opposite in sign:

4. **`specific_case` mode has no fallback refusal when the docket is unknown-but-noisy** (P02). Because near-name commentary pages *were* admitted, the missing-docket anchor logic did not fire, and the drafter produced a substantive platform-liability answer with listing-page footnotes. Compare F5/B2, where zero admissions correctly triggered refusal — the bug is that partial noise defeats the guard.

## 4. Recommended next tracks (in priority order, not started)

1. **Docket → judgment text resolution for `supremedecisions.court.gov.il`** (fixes P01/P13, likely most of the specific-case cluster).
2. **`specific_case` refusal hardening:** fire `docket_limitation` when no admitted source carries the *exact* requested docket, regardless of how many near-name commentary hits exist (fixes P02 — the only unsafe grade).
3. **Authority-type-aware sufficiency:** allow statute/regulation packs to satisfy sufficiency for `practical_steps`, `definition` and statutory-institution questions, while keeping the caselaw requirement for `case_law_synthesis` (fixes P07/P08/P10/P12).
4. **Statute-text acceptance:** treat the official Knesset PDF and a matching mirror as a verified pair for canonical quotes (fixes P03/P04).
5. **Framing correction × synthesis rendering interaction:** when a framing correction fires *and* group A is non-empty, still render the line-of-authority skeleton (P05).
