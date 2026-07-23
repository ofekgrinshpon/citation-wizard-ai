# Legal Research v1 — Quality Audit v1 Results

Golden set: `reports/quality-audit/golden-set.json` (version: draft-2)
Runs completed: 18/18 · errors: 0 · ran_at: 2026-07-16T09:14:37.809Z

## Headline

- **5/18 stub responses** — drafter never ran (`drafter.ok=false`, `error=no_usable_candidates`). These questions returned only the `[stub] התשובה תיווצר בשלב P5...` placeholder. This is the dominant objective failure mode.
- **13/18 questions produced real answers.** Of those, 1 (Q12) tripped an objective heuristic (`all_required_primary_missing`), but the answer contains explicit caveat language — likely a heuristic-match limitation, not a true failure. Needs your review.
- No fabricated citations detected on any run. No `forbidden_claim` heuristic hits. No severe truncation on any non-stub run.

## Stub-response diagnosis (Q03, Q09, Q14, Q16, Q18)

All 5 stubs share the same root cause chain: `retrieval → verifier → drafter=no_usable_candidates`.

| Q | Category | Candidates retrieved | Verified direct | partial | tangential | unrelated | usable |
|---|---|---:|---:|---:|---:|---:|---:|
| Q03 | statutory_interpretation | 10 | 0 | 0 | 1 | 9 | 0 |
| Q09 | academic_doctrine | 6 | 0 | 0 | 2 | 4 | 0 |
| Q14 | practical_implications | 0 | 0 | 0 | 0 | 0 | 0 |
| Q16 | mixed_sources | 5 | 0 | 0 | 3 | 2 | 0 |
| Q18 | anchor_preservation | 0 | 0 | 0 | 0 | 0 | 0 |

Two subtypes:
- **Retrieval-empty (Q14, Q18):** 0 candidates ever reached the verifier. Query planning + retrieval never surfaced anything for these queries.
  - Q18 is the anchor-preservation test (verbatim §1 Basic Law: Human Dignity and Liberty). The pipeline returned 0 candidates for a query where the required source is a Knesset URL. That is a real anchor-retrieval gap.
  - Q14 is the sector-specific AML question (currency service providers, 2014 order). 0 candidates suggests planner/retriever did not find the specific ministerial order.
- **Verifier-rejects-all (Q03, Q09, Q16):** candidates were retrieved (5–10 each) but the verifier classified 100% as `unrelated` or `tangential`, so 0 reached the drafter.
  - Q03: §32(9) Income Tax Ordinance (בעל שליטה) — 10 candidates, all rejected.
  - Q09: doctrine of בטלות יחסית — 6 candidates, all rejected.
  - Q16: employee-classification tests + pension — 5 candidates, all rejected.

## Aggregate verifier support (13 non-stub runs)

- direct: 3 (2%)
- partial: 40 (32%)
- tangential: 6 (4%)
- unrelated: 75 (60%)
- total verified claim-source pairs: 124

## Per-question objective checks

| Q | Cat | ok | stub | ans_len | fn | used | ver.direct/partial/tang/unrel | anchors | caveat | fab.cite | missing_req_primary | hard_fail |
|---|---|---|---|---:|---:|---:|---|---:|---|---:|---|---|
| Q01 | docket_holding | True | False | 2276 | 8 | 8 | 0/9/0/3 | 0 | True | 0 | - | - |
| Q02 | docket_holding_missing_s | True | False | 2010 | 3 | 2 | 0/2/0/7 | 0 | True | 0 | - | - |
| Q03 | statutory_interpretation | False | True | 82 | 0 | 0 | 0/0/1/9 | 0 | False | 0 | סעיף 32(9) לפקודת מס הכנסה [נוסח חדש] | stub_response_p5_never_ran |
| Q04 | statutory_interpretation | True | False | 3109 | 6 | 4 | 0/4/0/6 | 0 | True | 0 | - | - |
| Q05 | amendment_history | True | False | 1514 | 1 | 1 | 0/1/1/4 | 0 | False | 0 | דברי הסבר להצעת החוק | - |
| Q06 | amendment_history | True | False | 1494 | 1 | 1 | 1/0/0/9 | 0 | True | 0 | התיקון הספציפי הרלוונטי | - |
| Q07 | mandate_ordinance | True | False | 1538 | 4 | 4 | 0/4/0/7 | 0 | False | 0 | - | - |
| Q08 | mandate_ordinance | True | False | 3578 | 8 | 6 | 0/6/1/3 | 0 | True | 0 | - | - |
| Q09 | academic_doctrine | False | True | 82 | 0 | 0 | 0/0/2/4 | 0 | False | 0 | פסק דין מכונן (למשל בג"ץ 2911/94 באקי או פסיקה מקבילה) | stub_response_p5_never_ran |
| Q10 | academic_doctrine | True | False | 2645 | 5 | 3 | 0/3/2/4 | 0 | True | 0 | - | - |
| Q11 | thin_corpus | True | False | 2274 | 3 | 2 | 0/2/1/5 | 0 | True | 0 | - | - |
| Q12 | thin_corpus | True | False | 2553 | 1 | 1 | 0/1/0/9 | 0 | True | 0 | חוק החברות, סעיפים כלליים על חובת זהירות | all_required_primary_missing |
| Q13 | practical_implications | True | False | 415 | 1 | 1 | 1/3/0/6 | 0 | False | 0 | - | - |
| Q14 | practical_implications | False | True | 82 | 0 | 0 | 0/0/0/0 | 0 | False | 0 | חוק איסור הלבנת הון התש"ס-2000|צו איסור הלבנת הון (חובות זיהוי, דיווח וניהול ריש | stub_response_p5_never_ran |
| Q15 | mixed_sources | True | False | 3180 | 5 | 3 | 0/3/1/8 | 0 | True | 0 | - | - |
| Q16 | mixed_sources | False | True | 82 | 0 | 0 | 0/0/3/2 | 0 | False | 0 | פסיקת בית הדין הארצי לעבודה על מבחני יחסי עובד-מעביד (למשל דב"ע נג/3-30 חסון, סר | stub_response_p5_never_ran |
| Q17 | overclaim_trap | True | False | 1665 | 4 | 3 | 1/2/0/4 | 0 | False | 0 | - | - |
| Q18 | anchor_preservation | False | True | 82 | 0 | 0 | 0/0/0/0 | 0 | False | 0 | נוסח מחייב מהכנסת (main.knesset.gov.il) או מספר החוקים / רשומות | stub_response_p5_never_ran |

## Special-case checks

**Q02 (missing-source test):** answer_len=2010, caveat_present=True, invented_holding_heuristic=False. Preview: לא סופק בפנינו טקסט או הפניה לפסק דין מע"מ (מחוזי ת"א) 61908-05-19, ולכן אין אפשרות לקבוע באופן ודאי מה הוחלט בו בנוגע לסיווג הכנסה כ'הכנסת עבודה' או 'הכנסת עסק'.

**מה שניתן לקבוע בהתבסס על המקורות שניתנו**

המקור s1 אי
  → Answer opens with `לא סופק בפנינו טקסט או הפניה לפסק דין...`. The system correctly refused to infer the holding. **Passes the Q02 missing-source design intent.**

**Q18 (anchor preservation):** stub=True. No answer produced → cannot evaluate verbatim quote or official-source use. Anchor-preservation coverage is 0/1 for this run.

**Q17 (overclaim trap):** answer_len=1665, caveat_present=False. Preview: **מסקנה קצרה**

לא — בתי המשפט בישראל אינם מכירים תמיד באופן אוטומטי בהסכם ממון שנחתם לפני הנישואין. הסכמי ממון יכולים להיות תקפים ומחייבים, אך תוקפם נבחן על פי המסגרת החוקית והפסיקה.¹

**המסגרת החוקית והיחס של הפסיקה**


## Systemic blocker attribution (top 3, observed frequency, not authoritative scoring)

1. **Retrieval / grounding — 5/18 runs blocked.** 2 zero-candidate runs (Q14, Q18) + 3 all-rejected runs (Q03, Q09, Q16) collapse the pipeline before drafter/citation quality can even be evaluated. This is the dominant observable blocker.
2. **Verifier over-rejection (subset of #1).** In Q03/Q09/Q16 the retriever did find candidates, but the verifier rated 100% as unrelated/tangential. Worth checking whether this is correct filtering (candidates truly off-topic) or over-strict role/support classification.
3. **Overall verifier support quality on runs that do complete** — from the aggregate, non-stub runs skew away from `direct` support. You will want to inspect the raw per-question support counts to judge whether drafter-quality issues are downstream of thin support.

## Recommended next investigation (not fixes)

Before any code changes, I'd recommend investigating in this order:
1. **Look at the 5 stub queries in the planner + retriever stage.** Pull `metadata.planning.planner` and `metadata.retrieval` for Q03/Q09/Q14/Q16/Q18. Two open questions: (a) did the planner produce queries that could plausibly hit the required primary source? (b) for Q14/Q18 with 0 candidates, did retrieval return nothing, or did it return items that got filtered pre-verifier?
2. **Sample the verifier decisions on Q03/Q09/Q16.** Read `metadata.verifier.batches[*].claim_ids` alongside candidate titles and confirm whether the rejections are correct. If the verifier is rejecting on-topic candidates, that's a verifier-recall problem, not a retrieval problem.
3. **Q18 anchor-retrieval specifically.** Q18 required the Basic Law §1 verbatim + official Knesset source. Zero candidates suggests the verified-sources DB / retrieval layer isn't surfacing basic-law texts even when they're the anchor. Worth checking whether anchor-required queries have their own retrieval path and whether it's healthy.
4. **Only after 1–3, look at drafter-writing/citation quality** on the 13 completed runs. Right now that signal is confounded by upstream failures — 28% of the corpus never reached the drafter.

## Files

- Raw per-question outputs (answer, footnotes, used_sources, required_anchors, verifier, completeness): `reports/quality-audit/runs/Q01.json` … `Q18.json` (also copied to `/mnt/documents/quality-audit/runs/`).
- Machine-readable per-question checks: `reports/quality-audit/checks.json`.
- CSV scoring sheet template (objective columns filled; subjective 0–3 axes left blank for your manual pass): `reports/quality-audit/scoring-sheet.csv`.

## Deliberately not done

- No authoritative 0–3 scoring on any axis.
- No product-ready / acceptable / fail label assigned to any non-stub question.
- No fixes applied to pipeline code. Golden set unchanged.