# Legal Research v1 — Quality Audit Plan

Goal: Before resuming latency optimization, diagnose whether the current product-quality blocker is **legal grounding**, **drafter writing**, **citation trust**, **overclaiming from partial sources**, or **missing primary sources**.

No code changes. No new flags. No model changes. Pipeline runs as-is.

---

## 1. Golden set construction (18 questions)

Assembled from real Israeli-law research shapes, extending the existing R1–R8 + D_* fixtures. Target 18 questions across 8 categories:

| # | Category | Example shape |
|---|---|---|
| Q1 | Specific docket / case holding | "What did the Supreme Court hold in [docket X] regarding Y?" |
| Q2 | Specific docket / case holding | District-level docket with narrower holding |
| Q3 | Statutory interpretation | Meaning of a defined term in a specific statute section |
| Q4 | Statutory interpretation | Scope of a duty under a statute + regulations |
| Q5 | Legislative amendment / history | Recent amendment: what changed and when |
| Q6 | Legislative amendment / history | Older amendment chain across two decades |
| Q7 | Mandate-era ordinance / continuity | Is the ordinance still in force? What replaced it? |
| Q8 | Mandate-era ordinance / continuity | Continuity + modern reinterpretation |
| Q9 | Academic doctrine | Named doctrine, its author, and current status |
| Q10 | Academic doctrine | Doctrinal debate between two schools |
| Q11 | Thin-corpus / insufficient sources | Niche question with little published material |
| Q12 | Thin-corpus / insufficient sources | Emerging area with no binding authority yet |
| Q13 | Practical legal implications | "What must a party do if…" |
| Q14 | Practical legal implications | Compliance-facing question with deadlines |
| Q15 | Mixed statute + case + scholarship | Question that requires all three source types |
| Q16 | Mixed statute + case + scholarship | Cross-domain (e.g., tax + corporate) |
| Q17 | Overclaim trap | Question phrased to invite an unsupported general rule |
| Q18 | Anchor preservation | Requires a specific docket/section verbatim |

Reuse R1/R5/R8 and D_R2/D_R3/D_District_Tax where they fit the categories to preserve continuity with prior validation runs.

## 2. Per-question rubric (defined before running)

For each question we pre-write:

- **Required primary source(s)** — specific statute section, docket number, or ordinance.
- **Acceptable secondary sources** — recognized commentaries, scholarship, government explanatory memoranda.
- **Forbidden / off-topic sources** — news blogs, unrelated jurisdictions, marketing content, foreign law when not asked.
- **Key legal conclusion** — the one-sentence answer a competent lawyer would give.
- **Required caveat** — what the answer must disclose if sources are partial or contested.

Stored as `reports/quality-audit/golden-set.json` (one entry per question, machine-readable) plus a human `golden-set.md`.

## 3. Execution

- Run each question through the deployed `legal-research-v1` edge function, `mode: "legal-research"`, no flags, no headers.
- Capture: final answer, `used_sources`, verifier usable/dropped counts, planner queries, runtime.
- Store raw per-run artifacts under `reports/quality-audit/runs/<qid>.json`.

## 4. Scoring (0–3 per axis, per question)

| Axis | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| Legal grounding / accuracy | wrong law | partly wrong | correct but shallow | correct + precise |
| Usefulness / directness | evasive | tangential | answers the question | answers + actionable |
| Writing quality | unreadable | rough | clear | publishable |
| Citation trust | fabricated / wrong | weak / secondary only | correct with gaps | correct primary + secondary |
| Overclaim risk | severe overclaim | some overclaim | mostly hedged | correctly hedged |

Human review by the user (or a designated reviewer). Scores recorded in `reports/quality-audit/scores.csv`.

## 5. Classification

Each answer gets one label:

- **product-ready** — all axes ≥2, grounding=3, no overclaim.
- **acceptable with polish** — grounding ≥2, no citation fabrication, minor writing/hedging issues.
- **fail** — grounding ≤1, or fabricated citation, or severe overclaim, or missing required primary source.

## 6. Blocker attribution

For every non-product-ready answer, tag the *dominant* failure cause (single choice):

- retrieval / grounding (right law never reached the drafter)
- drafter writing (facts were present, prose was weak)
- citation trust (citations wrong, mismatched, or fabricated)
- overclaiming from partial sources
- missing primary sources (retrieval reached secondary but not primary)
- other (free-text)

Aggregate counts → the top systemic blocker.

## 7. Deliverables

- `reports/quality-audit/golden-set.md` + `.json`
- `reports/quality-audit/runs/*.json`
- `reports/quality-audit/scores.csv`
- `reports/quality-audit/summary.md` — distribution of labels, top blocker, representative failure examples, recommended next investigation (not fixes).

## Out of scope for this plan

- No code changes to the pipeline.
- No new flags, headers, or telemetry fields.
- No model swaps.
- No latency work.
- No fixes — diagnosis only. Fix planning happens after the summary is reviewed.

## Technical notes

- Runs are triggered via the existing smoke-run harness pattern used in prior A/Bs, minus any experimental headers. A thin runner script `scripts/legal-research-v1-quality-audit.ts` iterates the golden set, calls the edge function, and writes raw artifacts. No pipeline code is touched.
- Scoring is manual; the runner only collects raw outputs and mechanical metrics (runtime, used_sources count, verifier counts, anchor-URL presence for anchored questions).
- Golden-set anchors reuse URL normalization from the Step 2 URL-based analysis so anchor-preservation checks stay consistent.

## Approval checkpoint

After you approve this plan I will:
1. Draft the 18-question golden set + rubric and share for your review before any runs.
2. Only after you sign off on the golden set, execute the runs and produce `summary.md`.
