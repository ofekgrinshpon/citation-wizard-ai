# research_richness_execution_unblock_v1_live_web_validation

Read-only live run against the deployed `legal-research-v1`. No code changes, no deploys.
Raw telemetry: `reports/research-richness-execution-unblock-v1/live/results.json`

Run IDs: AW4 `7133e525`, AW9 `25f3e144`, AW7 `3faf009e`, Q3 `f5005eca`, Q2 `5e1fed6d`.

## 1. web_tier_health

| Fixture | attempted | succeeded | failed | HTTP | avg ms | web results | admitted | class |
|---|---|---|---|---|---|---|---|---|
| AW4 | 27 | 17 | 10 | 200×17, 429×10 | 4648 | 79 | 53 | rate_limited |
| AW9 | 27 | 18 | 9 | 200×18, 429×9 | 5046 | 79 | 56 | rate_limited |
| AW7 | 10 | 4 | 6 | 200×4, 429×6 | 2951 | 15 | 12 | rate_limited |
| Q3 | 14 | 3 | 11 | 200×3, 429×11 | 1241 | 12 | 4 | rate_limited |
| Q2 | 5 | 4 | 1 | 200×4, 429×1 | 4598 | 18 | 14 | rate_limited |

Total 83 calls, 46 succeeded (55%), 0 × 401. Quota is restored; remaining failures are provider
rate limiting (429) under parallel fan-out, correctly classified and surfaced by `web_tier_health`
(`disabled_or_misconfigured: false`, safe message, no credential leakage).

Body acquisition: admitted web candidates flow into the pool
(AW4 31 admitted integrity rows, AW9 29, AW7 20, Q3 23, Q2 19).

## 2. Perplexity utilization by intended role

| Fixture | primary_statute | binding_case_law | scholarship | persuasive/gov | cited from web |
|---|---|---|---|---|---|
| AW4 | 3q / 10 res / 9 adm | 11q / 45 / 32 | 9q / 24 / 12 | 3q / 0 / 0 | 1 |
| AW9 | 3q / 14 / 8 | 10q / 35 / 26 | 8q / 25 / 21 | 4q / 5 / 1 | 1 |
| AW7 | 2q / 0 / 0 | 2q / 5 / 2 | 4q / 10 / 10 | 1q / 0 / 0 | 0 |
| Q3 | 2q / 3 / 1 | 4q / 0 / 0 | 6q / 9 / 3 | 2q / 0 / 0 | 0 |
| Q2 | 1q / 8 / 4 | 1q / 0 / 0 | 2q / 10 / 10 | – | 0 |

Web search now genuinely executes and admits sources (139 admitted across the set), but very
little of it reaches footnotes. Recurring drop reason for case-law role:
`class_unknown_not_admitted_for_binding_case_law` (e.g. Canada SCC *R. v. Oakes* dropped as
`unknown`), plus `bad_source` for Wikipedia mirrors.

## 3. Official discovery / canonical acquisition

Trigger now fires in every fixture (`depth_mode_eligible`, `max_dockets: 2`) — the previous
`docket_cap_zero` is gone.

| Fixture | depth mode | attempted | acquired | failure |
|---|---|---|---|---|
| AW4 | academic_research | 2 (Mizrahi 6821/93, 1715/97) | 0 | `no_derivable_url` |
| AW9 | academic_research | 0 | 0 | `registry_not_triggered` (no reliance doctrine in registry) |
| AW7 | academic_research | 2 (Dapei Zahav 389/80, 935/89) | 0 | `no_derivable_url` |
| Q3 | broad_research | 2 | 0 | `no_derivable_url` |
| Q2 | narrow_doctrine | 2 | 0 | `no_derivable_url` |

Identity validation never ran because no body was ever fetched: the registry seeds have no
official URL and no discovery step supplies one, so acquisition ends before any probe.

## 4. Academic cue

AW4 / AW9 / AW7 → `academic_mode: true`, depth mode `academic_research`. Fix confirmed.
Q3 → `broad_research`, Q2 → `narrow_doctrine` (correct, unchanged).

## 5. Claim-source plan ceiling

Academic runs now use per-claim ceilings of 6–8 (previously fixed 4):
AW4 C1–C4 = 8 (eligible 14–17), C5 = 6; AW7 = 6/8/7/6 (eligible 5–8); AW9 = 6 (eligible only 1–3).
Non-academic runs remain at 4 (Q3, Q2). Compliance 100% — zero disallowed refs emitted in any run.
Strong local scholarship did become *permitted* (AW4 14–17 eligible per block), but the drafter
still emitted only 1–2 refs per block, so the raised ceiling is not the binding constraint anymore.

## 6. Final answers

| Fixture | footnotes | distinct sources | roles | notes |
|---|---|---|---|---|
| AW4 | 3 | Basic Law, Barak (RUNI L. Rev.), Barak (HUJI PDF) | statute + 2 scholarship | no case-law anchor despite 45 case-law web results |
| AW9 | 2 | Basic Law (Nevo), HUJI reliance-patterns article | statute + scholarship | 1 doctrine-specific reliance article found; no administrative-law judgment |
| AW7 | 1 | HUJI article on review of secondary legislation | scholarship | concise, but anchor is tangential to professional-discretion |
| Q3 | 2 | HCJ 769/02 (official court PDF), Basic Law | judgment + statute | canonical proportionality authorities (Mizrahi, Beit Sourik) absent |
| Q2 | 1 | HCJ 6427/02 (official court PDF) | judgment only | **Basic Law itself not cited** — statute dominance lost |

Questionable / gaps: Q2 plan rows C1–C4 had `eligible_count: 0` → no statute ref was ever citable,
and the answer hedges ("במקורות שאותרו כאן"). AW7's single anchor is topically adjacent, not
on-point. No fabricated or unsafe citations in any run; all footnotes resolve to real sources.

## 7. Comparison to previous thin outputs

- AW4: 3 → 3 footnotes. Not materially richer, though the pool grew (13 → 31 admitted).
- AW9: 2 → 2 footnotes, but it *did* find one doctrine-specific reliance source (HUJI quantitative
  study on reliance practice) — a qualitative improvement over generic sources.
- AW7: 1 → 1 footnote; concise as expected for the genre, anchoring still weak.
- Q3: 4 → 2 footnotes; canonical proportionality authorities still not prioritized.
- Q2: 2 → 1 footnote and statute dominance regressed (case law only).

## Decision

**Follow-up needed for source priority / canonical acquisition** — not full ACCEPT.

Partially accepted components (verified working):
- Web tier restored and honestly instrumented (0 × 401, 46/83 succeeded, 429s classified).
- Academic cue detection correct for AW4/AW9/AW7.
- Role-diverse plan ceiling 6–8 active in academic runs, 100% compliance.
- Bounded canonical acquisition now triggers (`docket_cap_zero` eliminated).

Blocking richness gaps for the next track:
1. `no_derivable_url` — registry authorities have no official URL source; canonical acquisition
   needs discovery-fed URLs before probing.
2. `class_unknown_not_admitted_for_binding_case_law` discards credible foreign/official case-law
   domains (e.g. `decisions.scc-csc.ca`).
3. Q2 statute-dominance regression: statute rows had zero eligible refs.
4. Drafter emits 1–2 refs per block even when 8–17 are permitted — the ceiling is no longer the
   limiter; ref emission is.
