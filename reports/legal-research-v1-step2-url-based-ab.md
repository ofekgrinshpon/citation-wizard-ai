# Step 2 (cap=12) — URL-based A/B re-analysis

**Method.** Recomputed the flag-off/flag-on overlap of `drafter.used_sources` using **normalized URLs** rather than `candidate_id`, since candidate IDs are freshly assigned per run and produced a false 0.0 overlap in the first pass.

**Normalization** (Postgres, applied to both `used_sources[].url` and anchor candidate URLs):
- `supremedecisions.court.gov.il/…Download?…fileName=X` → `sup:X`
- `gov.il/…spokmanship_court?skip=N` → `govct:N`
- `he.wikisource.org/wiki/PAGE` → `ws:PAGE`
- `main.knesset.gov.il/…rid=N` → `kn:N`
- `toledano.co.il/<slug>/…` → `tol:<slug>`
- other: lowercased, fragment stripped, trailing `/` stripped, query stripped
- overlap key = `normalized_url|source_type`

## Per-fixture URL overlap

| Fixture | off | on | ∩ | ∪ | Jaccard | lost | new | anchor cited off / on |
|---|---|---|---|---|---|---|---|---|
| R1_MandateIncomeTax | 12 | 4 | 3 | 13 | 0.231 | 9 | 1 | ✅ / ✅ |
| R2_NationStateBGHC | 5 | 4 | 1 | 8 | 0.125 | 4 | 3 | ✅ / ✅ |
| R3_CaseLawDocket | 7 | **0** | 0 | 7 | 0.0 | 7 | 0 | ✅ / ✅ (empty draft) |
| R4_StatutoryInterp | 5 | 2 | 1 | 6 | 0.167 | 4 | 1 | ✅ / ✅ |
| R5_RecentAmendment | 1 | **0** | 0 | 1 | 0.0 | 1 | 0 | — / — |
| R6_ReformCodification | 4 | 4 | 0 | 8 | 0.0 | 4 | 4 | — / — |
| R7_AcademicHeavy | **0** | 3 | 0 | 3 | 0.0 | 0 | 3 | — / — |
| R8_InsufficientSources | 7 | 2 | 0 | 9 | 0.0 | 7 | 2 | — / — |
| D_R2_NationStateBGHC (docket) | 4 | 5 | 3 | 6 | **0.5** | 1 | 2 | ✅ / ✅ (docket URL present both) |
| D_R3_Rotman (docket) | 5 | 1 | 0 | 6 | 0.0 | 5 | 1 | ✅ / ✅ (docket URL absent both — cited via analogical cases) |
| D_District_Tax (docket) | 1 | 1 | 1 | 1 | **1.0** | 0 | 0 | ✅ / ✅ (docket URL preserved) |

Median URL Jaccard 0.125; mean ≈ 0.20 — far below the ≥0.85 bar we hoped for. Even flag-off vs flag-off would not hit 0.85 given retrieval reranking + drafter selection stochasticity, but the deltas below are attributable to the cap.

## Centrality of what was lost — R1 / R5 / R8

**R1_MandateIncomeTax** (Mandate-era statute question — statute coverage is *the* substance)
Lost 9 URLs including **all six wikisource regulations/statutes**:
- `ws:חוק סדרי השלטון והמשפט (ביטול…)` — israeli_law
- `ws:פקודת סדרי השלטון והמשפט (הוראות נוספות)` — israeli_law
- `ws:תקנות מס הכנסה (זיכוי בעד נטול יכולת)` — israeli_law
- `ws:תקנות מס הכנסה (קביעת סכום תקבול)` — israeli_law
- `ws:תקנות ביטוח בריאות ממלכתי` — israeli_law
- `ws:תקנות הבטיחות בעבודה` — israeli_law

Also lost: `tol:aa-6077-20|caselaw` (income-tax appeal), `tol:bagatz-5658-23|caselaw`, `runilawreview:kamir|journal_article`.
Gained: one Supreme Court PDF (`SA1_7_3899-04.pdf`).
**Verdict: cap-caused loss of primary-statute coverage** — off had 6 israeli_law entries, on had 0. The docket anchor (`mandate_continuity_s11`) is still `cited:true` on both sides, but the statute-role diversity collapsed. **Central**, not tangential.

**R5_RecentAmendment** (Criminal Procedure Amend. 87)
Off: 1 sup PDF. On (first run): 0. Rerun cap=12 (`run_id=5d5d397d-fba5-41a9-91c6-68baeb029815`, 48 s): **also failed** — `ok=false`, 0 used_sources, 0 usable, dropped_by_cap=3 (2× scholarship, 1× binding_case_law). **Two consecutive failures under cap=12 while flag-off produced a usable answer.** The dropped queries include the scholarship queries that would have caught the legislative-history background the question explicitly asks for.

**R8_InsufficientSources** (crypto/NFT tokenization — the fintech-statute question)
Off: 7 URLs including 3 core wikisource statutes:
- `ws:חוק החברות` (Companies Law)
- `ws:תקנות מס קניה (טובין)` (Purchase Tax Reg.)
- `ws:תקנות ניירות ערך (פרטי התשקיף…)` (Securities Reg.)

On: 2 URLs — none of the primary statutes above; only one govct caselaw + one unrelated journal.
**Verdict: cap-caused loss of the exact statutes the question is about.** Central.

## Central-vs-tangential summary

| Fixture | Cap-caused loss | Role of lost items | Verdict |
|---|---|---|---|
| R1 | 6 israeli_law wiki pages + 2 caselaw | statute/regulation → 0 on the "on" side | **central** |
| R2 | 4 items across roles | mixed academic + one supreme PDF | mostly tangential; docket anchor preserved |
| R3 | 7 items | full set — but "on" produced empty draft (likely drafter-side, not cap) | inconclusive; noise |
| R4 | 4 journal_articles | analytic scholarship on §39 | partial coverage loss; central statute (חוק החוזים) preserved |
| R5 | 1 sup PDF; ~3 queries dropped | scholarship + binding | **central** — 2/2 reruns fail |
| R6 | pure churn | both sides have 4 diff journal_articles | LLM noise, not cap |
| R7 | flag-off was already `ok=false` | — | pure noise |
| R8 | 3 primary statutes | Companies Law, Purchase Tax, Securities | **central** |
| D_R2 | 1 mild loss | anchor URL preserved | **safe** |
| D_R3 | 4 land-law tol: cases + 1 caselaw; only 1 unrelated new | anchor status "cited" is spurious on both sides (no 8622/07 URL) — retrieval diversity narrowed | risk elevated but pre-existing |
| D_DT | 0 | docket URL preserved 1:1 | **safe** |

## Required-anchors preservation (URL-level)
- D_R2, D_DT: docket URL present in used_sources on **both** sides → truly preserved.
- D_R3: docket URL present on **neither** side (a pre-existing retrieval issue, not caused by cap); anchor status flag is misleading.
- R1 statute anchor: `cited:true` both sides but on-side lost 6 statute URLs, so the anchor is now "cited" through a single wikisource entry rather than 6 → **coverage degraded even where anchor flag is preserved**.

## Latency delta (re-tallied from prior run)
Median 156 s → 147 s (−9 s, −6%); mean 162 s → 145 s (−17 s, −10%). Unchanged from the first pass.

## Recommendation — **A. Abandon Step 2 (keep cap disabled)**

Rationale:
1. **R1 and R8 show cap-caused loss of primary statutes/regulations** — exactly the sources these questions are about. This is not tangential churn.
2. **R5 fails twice in a row under cap=12** with `ok=false` and 0 sources, while flag-off produced a usable (if thin) answer. The dropped-by-cap queries were the scholarship queries for the legislative-history portion of the question.
3. Docket runs (R2 / D_R2 / D_District_Tax) are safe under cap=12, but the two docket-anchor "wins" don't offset the losses on statute-heavy runs. D_R3's anchor-URL absence on both sides is a pre-existing retrieval issue and would not be helped or hurt by the cap.
4. Latency win is ~9–17 s median/mean. Not worth the statute-coverage risk demonstrated on R1/R5/R8.

Cap=15 (Option B) would keep more queries but the pattern (over-aggressive drops on statute/scholarship roles for statute-heavy questions) is a **role-mix** problem, not a raw-count problem — a bigger cap only postpones it. Guardrails (Option C — protect `primary_statute` + `regulation` roles the way `required_anchor` queries are already protected) would be the *only* variant with a chance of shipping, but the user's constraints explicitly ask to not implement guardrails yet, and the ~10% latency win is small enough that abandoning is the honest call.

**Proposed next step:** move to Step 3 (analyzer model A/B). Keep `LR_PLANNER_QUERY_CAP` code in place (flag defaulted off, opt-in via header) so it remains available if Step 3 lands and role-diversity guardrails are approved later.
