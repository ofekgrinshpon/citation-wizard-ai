# Statute/regulation authority recognition for practical answers — validation report

Track: `authority_type_sufficiency_v1` → follow-up `practical_statute_authority_recognition_v1`
Date: 2026-08-03 · 10 sequential runs · raw telemetry: `reports/authority-sufficiency/*.json`
Runner: `scripts/legal-research-v1-authority-sufficiency-validation.ts`

## 1. Results table

| # | Question | Profile | Suff. passed | Basis | Reason | statute_only | Branch | Used | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| P08 | תביעות קטנות — שלבים, סכום, אגרות | `practical_steps` | ✔ | usable_judgment | `thin_governing_statute_pack_present` | false | — | 10 | **Fixed** — bounded practical answer |
| P12 | פיקדון שכירות | `practical_steps` | ✔ | governing_statute | `thin_governing_statute_pack_present` | **true** | — | 3 | Pass (statute-only, disclosed) |
| P10 | צוואות הדדיות ס' 8א | `statutory_institution` | ✔ | insufficient→doctrinal | `doctrinal_anchor_present` | false | — | 4 | Pass |
| P14 | הרמת מסך בחברות משפחתיות | `case_law_synthesis` | ✔ | usable_judgment | `case_law_synthesis_supported` | false | — | 7 | Pass — real judgments, no fake synthesis |
| P07 | בטלות יחסית | `statutory_institution` | ✖ | insufficient | `no_statutory_caselaw_or_doctrinal_anchor` | false | `insufficient_sources_limitation` | 0 | Pass (limited, as expected) |
| P05 | תום לב ס' 12 | `statute_section_definition` | ✔ | usable_judgment | `required_anchor_satisfied` | false | — | 7 | Pass |
| C2 | הלכת השיתוף (control) | `case_law_synthesis` | ✔ | usable_judgment | `case_law_synthesis_supported` | false | — | 5 | Pass — strictness preserved |
| P02 | fake docket ע"א 99887-04-22 | — | — | — | — | — | **none** | 0 | **Fail — `[stub]` answer** |
| P01 | בג"ץ 6698/95 קעדאן | — | — | — | — | — | `docket_limitation` | 0 | Pass (acquisition failed this draw) |
| B8 | ציטוט ס' 1 חו"י כבוד האדם | — | — | — | — | — | `canonical_quote_registry` | 1 | Pass |

## 2. Acceptance criteria

| Criterion | Result |
|---|---|
| P08 no longer blanket-refuses | **Pass** — 4-part practical answer from the regulations |
| P08 does not invent max claim amount / fee | **Pass** — says the ceiling is set in the regulations and the current figure must be checked in the official fee source; no number invented (`exact_amounts_allowed=false`) |
| P12 / P10 remain answered | **Pass** |
| P14 limited unless real authority | **Pass** — answered from actual judgments, not thin statute |
| P07 may remain limited | **Pass** — honest limitation |
| C2 strict | **Pass** |
| P01 / B8 unchanged | **Pass** |
| P02 unchanged | **Fail** — see §4 |
| No metadata-only holdings | **Pass** |
| No commentary as primary authority | **Pass** |
| No verifier failures | **Pass** |
| No stubs | **Fail (P02 only)** |

## 3. What the fix actually did

- **Morphology-tolerant Hebrew stemming** (`stemHebrew`/`stemSet`, prefix ו/ב/ל/ה/כ/מ + light plural trimming, stems ≥3), used **only** for sufficiency domain matching — never for dockets, quotes or anchors. This is what let `ואגרות` match `אגרות` and `תביעה` match `בתביעות` in P08.
- **`isGoverningStatuteLike(..., { allowThinText: true })`** for `practical_steps` only: an official/primary statute or regulation counts even when `text_usability=metadata_only`, labelled `thin_governing_statute`.
- **Bounded-answer contract** when only thin authority exists: mandatory disclosure line ("המקורות שאותרו הם חקיקה/תקנות רלוונטיות, אך לא אותר נוסח מלא/פסיקה ישירה…"), `exact_amounts_allowed=false`, no quoting of amounts/deadlines/section text.
- Both P08 and P12 rendered the disclosure line verbatim, so the contract is being honoured by the drafter, not just recorded in telemetry.

## 4. The one defect — P02 returns a stub instead of `docket_limitation`

Telemetry for P02:

```
exact_docket_source_found        false
near_match_sources_ignored_count 18
text_acquisition_attempted       true
last_acquisition_failure_reason  no_local_document_match
final_docket_branch_reason       no_exact_docket_source
missing_docket_limitation_fired  false
drafter.ok                       false
drafter.error                    no_usable_candidates
answer                           "[stub] …"
```

The exact-docket guard did its job — all 18 near-name commentary hits were correctly vetoed, so the safety property (no substantive answer on a fake docket) holds. The bug is ordering: with **zero** usable candidates the drafter aborts on `no_usable_candidates` *before* the deterministic `docket_limitation` branch is evaluated, so the user gets the internal stub string instead of the honest Hebrew refusal. Previous runs fired the refusal because a few near-matches survived into the drafter.

Scope of the fix: evaluate `specific_case`/docket branches ahead of the `no_usable_candidates` early return in `drafterV2.ts`. One-line-ish ordering change, no gate logic touched.

## 5. Recommendation

Close `practical_statute_authority_recognition_v1` as **stable-initial / monitor** (9/10 clean, P08 objective met), and open a narrow **deterministic-branch ordering** fix for the zero-candidate stub path, validated on P02 + B2 + M1.
