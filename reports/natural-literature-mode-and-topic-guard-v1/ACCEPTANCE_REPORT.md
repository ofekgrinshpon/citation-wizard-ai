# natural_literature_mode_and_topic_guard_v1 — Acceptance Report

## 1. Executive summary

Natural Hebrew literature-review prompts now reliably enter the academic-literature
machinery. All five live prompts (P1–P5) activated `academic_literature_mode` from
general signals (phrase signals + planner `literature_map` / `map_literature`), against
2/5 in the baseline. The facet contamination guard rejected the rabbinical-court /
family-property facet family on the proportionality-vs-reasonableness prompts (P3: 2
rejected of 4; P4: 20 rejected of 20 unrelated templates), and the P3 answer no longer
contains rabbinical-court doctrinal paragraphs — only one explicit "no source found"
sentence remains. Centre-of-gravity telemetry is now emitted per run and immediately
exposes the real bottleneck: `direct_scholarship_sources_in_pack = 0` in **all five**
runs. Richness did not materially improve (2–4 footnotes); this track fixed activation
and topic control, as scoped.

## 2. What changed

- `stages/naturalLiteratureMode.ts` (new): general activation detector
  (`סקירת ספרות`, `מפת ספרות`, `רקע תיאורטי`, `פרק ספרות`, `ספרות מחקרית`,
  `כתיבה אקדמית`, `לסמינריון`, `עבודה סמינריונית`, `תזה`, `מחקר אקדמי`, plus
  `user_task_intent=literature_map`, `answer_strategy=map_literature`, and
  `academic_writing` + source/literature request), explicit-exclusion detection,
  centre-of-gravity assessment and directives, report-only unused-pack telemetry.
- `stages/claimFacetExpansion.ts`: `guardFacetAgainstQuestion` — every proposed facet
  is scored for shared subject vocabulary with the current normalized question and
  rejected when its distinctive entity family (rabbinical court, family property,
  torts, tax, companies, criminal, labour, contracts, interim relief, burden of proof)
  is absent from the current prompt. Records land in `facet_contamination_guard`.
- `stages/drafterV2.ts`: accepts `literatureMode`; literature runs order scholarship
  before primary law (primary law is retained, not removed) and receive
  centre-of-gravity directives; richness assessment now runs for natural literature runs.
- `index.ts`: activation detection + durable `natural_literature_mode_activation`,
  `literature_source_center_of_gravity`, `unused_literature_pack_sources`,
  `facet_contamination_guard` and version telemetry; `run_id` threaded into facet
  expansion.
- Tests: `src/test/naturalLiteratureMode.test.ts` (11 deterministic cases). Full suite
  33 files / 326 tests pass.

## 3. What deliberately did not change

No new model call, no new retrieval stage, no new recovery layer, no drafter retry,
no citation minimum or fixed source count, no forced citations, no forced named-author
synthesis, no anonymous-paraphrase detector, no weakening of CSM / alignment /
verifier / citation integrity, no Hebrew-style changes, no fixture-specific IDs, and
case law / statutes remain permitted as context.

## 4. Literature-mode activation

| Run | Prompt | mode before | mode after | signals |
|---|---|---|---|---|
| P1 `18db2b38` | סקירת ספרות על עילת הסבירות | false | **true** | seqirat_sifrut, intent_literature_map, strategy_map_literature |
| P2 `d91dd8bc` | סקירת ספרות לסמינריון — הבטחה מנהלית | true | **true** | seqirat_sifrut, seminar, academic_writing_with_literature_request |
| P3 `9f84535a` | מידתיות מול סבירות | false | **true** | seqirat_sifrut, intent_literature_map, strategy_map_literature |
| P4 `e24c9c15` | רקע תיאורטי לסמינריון | n/a | **true** | reka_teoreti, seminar, academic_writing_with_literature_request |
| P5 `0d1e48ed` | פרק סקירת ספרות — הסתמכות מול רשות | n/a | **true** | seqirat_sifrut, perek_sifrut, academic_writing_with_literature_request |

Criterion A: **pass** (general signals, no hardcoded prompts).

## 5. Scholarship centre of gravity

| Run | scholarship in pack | direct | adjacent | case law | statute | cited scholarship | cited primary | crowded out | adjacent-as-direct |
|---|---|---|---|---|---|---|---|---|---|
| P1 | 4 | 0 | 4 | 1 | 1 | 3 | 1 | no | no |
| P2 | 2 | 0 | 2 | 1 | 2 | 1 | 1 | no | no |
| P3 | 0 | 0 | 0 | 3 | 0 | 0 | 2 | no (none available) | no |
| P4 | 1 | 0 | 1 | 1 | 0 | 1 | 1 | no | no |
| P5 | 2 | 0 | 2 | 5 | 0 | 0 | 2 | **yes** | no |

P2 no longer leans on the contract-law damages article as its main authority: it cites
`"כגודל הציפייה": היקף הביקורת השיפוטית על שינוי מדיניות עקבית של רשויות` — direct
administrative-law scholarship in substance — plus one statute. Criterion B: **partial
pass** — scholarship is protected and never mislabelled as direct, but P5 shows primary
law still crowding out available scholarship, and P3 had no scholarship in the pack at all.

## 6. Topic / facet contamination

- P3: 4 facets evaluated, 2 rejected — `תחולת הדין האזרחי על בית הדין הרבני` and
  `איזון משאבים וחלוקת רכוש` (`unrelated_central_entities:family_property`).
- P4: 20 facets evaluated, 20 rejected, including the full rabbinical-court family.
- P1, P2, P5: 8/8, 8/8, 8/8 accepted — no false positives on on-topic facets.
- The P3 answer contains **no rabbinical-court doctrinal content**; a single residual
  sentence states that no source was found on that sub-question, inherited from a claim
  formulated before facet filtering. No prior-question leakage otherwise.

Criterion C: **substantially pass**, with one residual negative-finding sentence to
clean up in the claim layer.

## 7. Before / after

| Run | baseline footnotes | now | baseline mode | now | latency |
|---|---|---|---|---|---|
| P1 | 3 | **4** | false | true | 179s (was 187s) |
| P2 | 1 | 2 | true | true | 193s (was 202s) |
| P3 | 2 | 2 (contamination removed) | false | true | 194s (was 167s) |
| P4 | — | 2 | — | true | 167s |
| P5 | — | 2 | — | true | 188s |

## 8. Unused direct pack sources

Zero rows in every run — not because the drafter used everything, but because
`direct_scholarship_sources_in_pack = 0` across all five. The unused-pack signal is
therefore currently uninformative; the loss happens before the pack, not at the drafter.

## 9. Latency

No measurable regression: 167–194s, within the baseline band (167–202s). The guard and
telemetry are deterministic, in-process and sub-millisecond.

## 10. Richness or activation only?

Activation and topic control only, as scoped. P1 gained one footnote and P3 lost its
contamination; overall citation depth is unchanged.

## 11. Primary remaining blocker

**Source acquisition** — specifically, direct (non-adjacent) Israeli administrative-law
scholarship never reaches the pack. In all five runs the pack held only adjacent
scholarship or pure primary law. Pack utilisation and drafter synthesis are *not* the
current bottleneck; the evidence now shows this unambiguously.

## 12. Recommendation

`continue_source_acquisition`
