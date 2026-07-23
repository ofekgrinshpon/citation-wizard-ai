# Legal Research v1 — Quality Audit v2 (Rerun on current pipeline)

Golden set: `reports/quality-audit/golden-set.json` (version: draft-2)
Runs completed: 18/18 · errors: 0 · ran_at: 2026-07-23
Prior audit (2026-07-16) archived at: `reports/quality-audit/archive-2026-07-16/`

## Headline

- **0/18 stubs.** Every question produced a full answer with `drafter.ok=true`. The 5 stub failures from 2026-07-16 (Q03, Q09, Q14, Q16, Q18) are no longer reproducible on the current pipeline.
- **No fabricated citations** (all footnotes carry either a `url` or a `sources[]` entry). **No forbidden claims** detected. **No severe truncation** — every `completeness.truncated` is `false`. (The `scoring-sheet.csv` still marks `severe_truncation=TRUE` on every row; that is a stale heuristic bug — the check compares an object to the string `"complete"`. Ignore that column in the CSV; use `runs/*.json → completeness.truncated` as ground truth.)
- **One genuine drafter-side failure:** **Q18 (anchor preservation)**. Retrieval succeeded (the official Knesset PDF is source #1), the required primary is *present in used_sources*, but the drafter refused to reproduce §1 verbatim and instead wrote a meta-response asking the user for permission to copy the text. This is a drafter-writing / anchor-preservation regression, not a retrieval failure.
- **Two heuristic-only "missing primary" flags** left after ignoring the truncation bug: Q05 ("דברי הסבר להצעת החוק") and Q06 ("התיקון הספציפי הרלוונטי"). Both are descriptive requirements; manual read of the used_sources shows the actual documents are present (Q05 cites `16.12-explanatory.pdf` — the explanatory memorandum; Q06 cites the amendment file). These are false positives of the fuzzy-token check.
- The remaining flagged rows (Q09 / Q14 / Q16 / Q18) name a *specific* required primary that the tokenizer can't match against the used_sources titles; in Q18's case the drafter *did* cite the right file but the answer body doesn't include the statute text — so Q18's flag is real, Q09/Q14/Q16's flags are heuristic-only.

## Aggregate

| Metric | 2026-07-16 | 2026-07-23 |
|---|---:|---:|
| Stubs (`no_usable_candidates`) | 5/18 | **0/18** |
| Answers with `drafter.ok=true` | 13/18 | **18/18** |
| Median `total_ms` (non-stub) | ~121s | ~137s |
| Verifier `direct` verdicts (sum) | 3 | **34** |
| Verifier `partial` verdicts (sum) | 40 | **107** |
| Verifier `tangential` (sum) | 6 | 35 |
| Verifier `unrelated` (sum) | 75 | 124 |

`direct` verdicts jumped 3 → 34 across the corpus and `partial` almost tripled — the verifier is admitting substantially more candidates than on 2026-07-16, which is why the stubs disappeared. Latency ticked up modestly (larger candidate pools reaching the verifier, more work through the drafter).

## Per-question snapshot (rerun)

| Q | Category | ok | ms | prose | fn | used | direct/partial/tang/unrel | Real issue after manual review |
|---|---|---|---:|---:|---:|---:|---|---|
| Q01 | docket_holding | ✓ | 157s | 1372 | 5 | 8 | 6/12/2/2 | — |
| Q02 | docket_holding_missing_source | ✓ | 119s | 2610 | 5 | 3 | 0/3/7/5 | Correctly refuses to invent a holding; opens with "אין ברשותי את פסק הדין". |
| Q03 | statutory_interpretation | ✓ | 132s | 2337 | 5 | 4 | 1/3/1/9 | — (was a stub last audit; now recovered) |
| Q04 | statutory_interpretation | ✓ | 127s | 2908 | 5 | 7 | 1/6/1/10 | — |
| Q05 | amendment_history | ✓ | 112s | 1705 | 4 | 6 | 4/4/1/8 | Explanatory memorandum is present in used_sources; CSV flag is a fuzzy-match FP. |
| Q06 | amendment_history | ✓ | 140s | 2456 | 6 | 6 | 2/9/2/9 | Amendment file present in used_sources; CSV flag is a fuzzy-match FP. |
| Q07 | mandate_ordinance | ✓ | 161s | 1969 | 5 | 10 | 1/17/3/2 | — |
| Q08 | mandate_ordinance | ✓ | 162s | 2671 | 5 | 5 | 2/9/3/14 | — |
| Q09 | academic_doctrine | ✓ | 133s | 3051 | 9 | 6 | 1/5/2/3 | Doctrinal answer produced; canonical anchor case not cited by name. Heuristic FP, but a real "landmark-case anchor" gap worth watching. |
| Q10 | academic_doctrine | ✓ | 138s | 2208 | 8 | 6 | 1/6/3/2 | — |
| Q11 | thin_corpus | ✓ | 138s | 1616 | 5 | 6 | 0/6/3/9 | — |
| Q12 | thin_corpus | ✓ | 179s | 3632 | 8 | 12 | 2/11/0/8 | — |
| Q13 | practical_implications | ✓ | 137s | 2224 | 5 | 4 | 2/2/1/14 | — |
| Q14 | practical_implications | ✓ | 161s | 2977 | 6 | 4 | 2/2/1/6 | Answers AML reporting duties; used_sources include the `צו` but not the anchor statute חוק איסור הלבנת הון התש"ס-2000. Minor primary-coverage gap. |
| Q15 | mixed_sources | ✓ | 181s | 3181 | 12 | 10 | 2/10/4/14 | — |
| Q16 | mixed_sources | ✓ | 150s | 3475 | 8 | 9 | 5/6/2/9 | — (was a stub last audit) |
| Q17 | overclaim_trap | ✓ | 135s | 2395 | 8 | 6 | 3/3/3/2 | — |
| Q18 | anchor_preservation | ✓ | 98s | 822 | 4 | 3 | 0/3/0/2 | **Real failure.** Official Knesset PDF cited as #1, but drafter refused to reproduce §1 verbatim and asked the user for permission to copy it. |

## Stability note — 2026-07-16 → 2026-07-23

| Q | Old status | New status | Likely reason | Still actionable? |
|---|---|---|---|---|
| Q03 | STUB (retrieved 10, verifier 0/0/1/9) | Full answer, used=4, direct=1, partial=3 | Verifier now admits statutory candidates it previously called unrelated; retrieval + verifier both moved. | No — not reproducible today. Would need a stress fixture to keep watching. |
| Q09 | STUB (retrieved 6, verifier 0/0/2/4) | Full answer, used=6, direct=1, partial=5 | Same — verifier admission shifted. | No — but the canonical landmark case is still not explicitly anchored; that's a separate "landmark-case anchor" question, not the old failure. |
| Q14 | STUB (0 candidates) | Full answer, used=4 including the correct AML `צו` | Retrieval recovered — Perplexity + local search now surface the `nevo.co.il` order and related material. On 2026-07-16 no candidate was returned at all. | No — the empty-retrieval failure is not reproducing. |
| Q16 | STUB (retrieved 5, verifier 0/0/3/2) | Full answer, used=9, direct=5, partial=6 | Verifier admission + retrieval both moved. | No. |
| Q18 | STUB (0 candidates) | Full answer, but drafter refuses verbatim quote | Retrieval fully recovered (Knesset PDF is source #1). New failure is downstream, in the drafter. | **Yes — but now it's a drafter/anchor-preservation problem, not a retrieval one.** |

**Interpretation.** The five 2026-07-16 stubs were a mix of (a) transient retrieval variance for Q14/Q18 and (b) verifier-admission variance for Q03/Q09/Q16. On today's run both fronts moved in the right direction — 34 `direct` verdicts (vs 3) and 107 `partial` (vs 40) — and no question stubbed. The old failure mode is **not currently actionable**; there is no persistent stub pattern to fix.

The one surviving item from that list, **Q18**, has migrated from a retrieval failure to a drafter failure: the anchor-preservation drafter now has the official source in hand and still declines to inline the statute text. That is a concrete, reproducible quality bug.

## `answer` vs `sources_only` — only for still-failing questions

Only **Q18** shows a genuine answer-quality failure after this rerun. Reusing the raw `sources_only` capture from `reports/differential-audit/sources_only/Q18.sources_only.json`:

| | `answer` (today) | `sources_only` (today) |
|---|---|---|
| Recommended sources | 3 | 5 |
| Official Knesset source present? | ✓ (source #1: `m.knesset.gov.il/.../yesod3.pdf`) | ✓ (same PDF appears at rank #1) |
| §1 verbatim text in output | ✗ | n/a (mode does not draft) |
| Additional tier surfaces anything material? | — | 5 items (kolzchut mirrors, Knesset committee doc, HUJI article, extra Knesset PDF). None are more official than the answer-mode primary already is. |

So on Q18 the issue is **not** that `sources_only` had a better source that `answer` failed to admit — both paths have the correct primary. The drafter simply refuses to reproduce the statute verbatim from a PDF-only source it has cited.

## Dominant blocker (this audit)

There is no dominant blocker at the retrieval / verifier / admission layers on this audit. The pipeline is producing full, sourced answers on 18/18 questions with the primary sources in used_sources for the large majority. The only clean, reproducible defect is:

**Drafter anchor-preservation on verbatim-quote requests (Q18).** The drafter has the right official source, will *cite* it, but will not *quote* it. Everything else is either resolved, or a heuristic-only flag on a descriptive requirement, or a "landmark case not named" nuance in Q09.

Secondary observations worth queuing (not blockers today):
- **Landmark-case anchoring on doctrine questions** (Q09): system explains the doctrine well but doesn't consistently name the canonical decisions.
- **Anchor statute vs implementing order** (Q14): the implementing `צו` is cited; the parent statute isn't. Minor.

## Recommended next track

**D — Drafter writing / citation quality**, narrowly scoped to *anchor preservation on verbatim-quote requests*.

Rationale:
- It is the only reproducible objective failure on today's audit.
- It is small in blast radius (the drafter path for anchor-preservation queries) and doesn't touch retrieval or verifier — both of which recovered on their own between audits.
- The proposed 2026-07-16 tracks (A source admission, B deterministic statute path, C verifier recall) are aimed at a stub pattern that is no longer reproducing; implementing them now risks over-fitting to a non-persistent failure mode.
- Option E (skip fixes, go to academic-chapter spike) is defensible but leaves Q18 broken; a small drafter fix first is a better sequence.

Do not implement yet — this report is the deliverable. Awaiting your call on whether to open a scoped track D for anchor-preservation drafting.

## Files

- Per-question raw outputs: `reports/quality-audit/runs/Q01.json` … `Q18.json` (also mirrored at `/mnt/documents/quality-audit/runs/`).
- Objective checks JSON: `reports/quality-audit/checks.json` (note: `severe_truncation` column is a stale heuristic and should be ignored; every run's `completeness.truncated` is `false`).
- CSV scoring sheet: `reports/quality-audit/scoring-sheet.csv` (same caveat about the truncation column).
- Prior audit (2026-07-16) preserved at: `reports/quality-audit/archive-2026-07-16/`.
