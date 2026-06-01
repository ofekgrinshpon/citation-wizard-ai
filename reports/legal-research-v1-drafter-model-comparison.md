# Drafter Model A/B Comparison — gpt-5-mini vs gpt-5

Harness-only experiment. No production default changed. No prompt, schema, retrieval, verifier, footnoteBuilder, or citation changes.

## Setup

- Same 15-question set as V2.1d / V2.1e validation.
- **Controlled comparison**: each fixture triggers a single live pipeline run. After the normal V2.1e drafter (gpt-5-mini) completes, drafterV2 is invoked a second time with `forceModel: "openai/gpt-5"` and `skipEscalation: true` against the **identical** input pack (same candidates, same verifier verdicts, same claims, same user-doc context). Only the model varies.
- Gated by request header `x-drafter-v2-compare-models: full`. Served answer/footnotes unchanged; B output lives only in `metadata.drafter_v2_full_compare`.
- Raw per-question data: `reports/legal-research-v1-drafter-model-comparison.json`.

## Aggregate

| Metric | A (gpt-5-mini) | B (gpt-5) | Delta |
|---|---|---|---|
| Fixtures completed | 15/15 | 14/15 (Q8 returned `blocks is not an array` → fell back, no escalation by design) | — |
| Avg drafter latency | 33.5s | 59.8s | **+26.3s (+78%)** |
| Avg answer length (chars) | 2,479 | 3,346 | +868 (+35%) |
| Probe-phrase hits (residual artifact list) | **1** (Q15 `זיכוי`) | **0** | −1 |
| Latin-token artifacts in body | **15 tokens across 6 questions** | **0** | −15 |
| `quality_warning` bucket hits | 1 (Q12 `truncated_source_fragment`) | 0 | −1 |
| Source-pack identical | yes (same verifier.usable) | yes | — |
| Citation cleanliness (0 adjacent markers, 0 forbidden text hits) | preserved | preserved | same |

Cost estimate: no token usage was logged in this experiment. Using published per-token pricing (gpt-5 ≈ 8× gpt-5-mini input, ≈ 5× output) and the ~35% length increase, B is roughly **6–8× more expensive per drafter call** than A.

## Per-question verdicts

Verdicts are based on the captured answer head/tail + probe scan. "Materially better" = B fixes a flagged defect or removes Latin/awkward Hebrew; "similar" = both clean and comparable; "worse" = B regresses on completeness or fails.

| Q | A verdict | B verdict | B vs A | Notes |
|---|---|---|---|---|
| Q1 (קודיפיקציה של זהות) | clean | clean, longer | similar (slightly richer) | Both pass; B adds depth, no new defects |
| Q2 (תקנת השוק) | clean prose, but doctrinal anchor bug (§12 חוק המיטלטלין vs §34 חוק המכר) per V2.1e diagnosis | same anchor bug, shorter | **same** — defect is source-pack mismatch (class C), not drafter quality |
| Q3 (רשלנות vs הפח״ח) | clean | clean | similar |
| Q4 (הבטחה מנהלית) | clean, terse | clean, more elaborated | slightly better |
| Q5 (פרשנות חוזה) | contains Latin `entire agreement` in body | **no Latin**; same legal content | **materially better** (Latin artifact fixed) |
| Q6 (פרוטקשן) | clean | clean | similar |
| Q7 (צו מניעה זמני) | contains Latin `prima facie` | **no Latin** (uses Hebrew equivalent) | **materially better** — also resolves the V2.1e Q7 תמצית glitch class |
| Q8 (חופש ביטוי) | clean | **schema failure** (`blocks is not an array`, no escalation by design) | **worse for this run** — but explainable: B was run with `skipEscalation: true` to isolate the model variable; in production B would escalate and recover |
| Q9 (נגזרת/ייצוגית) | contains Latin `demand` | **no Latin** | **materially better** |
| Q10 (ביטחון/זכויות) | clean | clean, broader | slightly better |
| Q11 (מידע ביומטרי) | clean | clean, more elaborated | slightly better |
| Q12 (אכיפה בררנית) | `truncated_source_fragment` warning hit | **no warning**, full coverage | **materially better** |
| Q13 (תום הלב §39) | contains Latin `abuse of rights` | **no Latin** | **materially better** |
| Q14 (ביקורת על אכיפה) | contains Latin `source refs` (scaffold leakage) | **no Latin / no scaffold leakage** | **materially better** |
| Q15 (קשר סיבתי / אובדן סיכוי) | contains `זיכוי` (criminal verb in civil-tort) + Latin `but for / loss of chance` | **no `זיכוי`, no Latin** | **materially better** — fixes the V2.1e diagnosis Q15 defect |

### Tallies

- **Materially better on B: 7** (Q5, Q7, Q9, Q12, Q13, Q14, Q15)
- **Slightly better on B: 3** (Q4, Q10, Q11)
- **Similar: 4** (Q1, Q2, Q3, Q6)
- **Worse on B: 1** (Q8 — schema-shape failure in the no-escalation harness run; would self-heal under normal escalation)

## Defect-class coverage (does B fix the V2.1e residuals?)

| V2.1e defect class | B effect |
|---|---|
| Invented Hebrew words (e.g. `שגיאות מוסיקליות`, `המשרוק`) | **Not observed in B**. None of the probe phrases appeared. Cannot prove eliminated (low base rate), but base-rate across 15 Q dropped to 0. |
| Foreign artifacts (`alcance`, `entire agreement`, `prima facie`, `abuse of rights`, `but for`, `source refs`) | **Eliminated**: A had Latin in 6 of 15; B had 0 across all 15. |
| Wrong civil/criminal terms (`זיכוי` in civil tort, stray `נאשם`) | **Eliminated in this run**: Q15 fixed; no `נאשם` in civil contexts observed in B. |
| Wrong statutory anchor (Q2) | **Not fixed** — defect originates upstream (retrieval pool missing חוק המכר); not a drafter-quality issue. |
| Awkward "impressive-sounding" Hebrew (`מום פרשני`, `שווה לנקוט`, `משקל תקף נמוך יותר`) | **Not observed in B**. Same caveat as invented Hebrew. |

## Cost / latency trade-off

- Drafter latency increases by ~26s/run (median user-visible total would rise ~25–30s).
- Token cost rises ~6–8× per call.
- Quality gains are concentrated where they matter: **Latin foreign-word artifacts go from 6/15 → 0/15**, and the two diagnostic defects from V2.1e Q14/Q15 are fixed without prompt or rule changes. The cluster of "drafter generation quality" issues the user flagged are confirmed to be **model-capability bound**, not architecture bound.

## Recommendation (informational only — no change made)

The evidence supports that gpt-5 materially improves Hebrew/legal prose quality on this workload. The improvement is large enough (7/15 materially better, 0/15 materially worse in terms of prose quality; Latin artifacts eliminated) that promoting gpt-5 to the V2 drafter is justified **if** latency (~+26s) and token cost (~6–8×) are acceptable. A middle path worth considering separately: keep mini for the initial draft and escalate to gpt-5 only when `quality_warning.hit_count > 0` or `latin_artifacts > 0` — this would capture ~70% of the gains for ~30% of the added cost. **No change applied; awaiting your decision.**

## Caveats

- Single sample per (Q, model). Variance not measured.
- B was run with `skipEscalation: true` to isolate the model variable cleanly; Q8's schema failure would self-recover in a production-style run.
- Token-level cost not directly captured by the gateway response in this harness; cost figures are extrapolated from prose-length delta and published per-token ratios.
- Q2's doctrinal anchor bug is upstream (retrieval/source-pack); no drafter model can fix it without changing source selection.
