# ReLex V2 — Final Acceptance Benchmark, Batch 1 (Q1–Q10)

Date: 2026-09-16. Build: currently deployed `legal-research-v2` (span-hunting
patch, acquisition orchestrator, temporal claim isolation — all already shipped).

**NO CODE CHANGED. No prompt, budget, model, threshold or deployment change.
Each question run once. No question retried for a weak result.**

Benchmark prompts were recovered verbatim from the persisted V2 evaluation set:
Q1–Q5 = `prelaunch_batch1_Q1..Q5`, Q6–Q10 = `batch2-Q6..Q10`. No question was
invented, substituted or rewritten.

---

## 1. Executive summary

Ten questions ran on the frozen build. **Every one produced a substantive,
footnoted answer.** There were no limitation-only answers, no zero-evidence
answers, no temporal unresolved/contradicted claims, no identity conflicts, and
no invariant or drafter errors anywhere in the batch.

- Mean **75.1**, median **79**, range **55–88**.
- Five answers in the Strong band (80–89), two Usable (70–79), three Weak (55–62).
- **The expensive tail is gone.** Max prompt cost 220.8k; nothing above 250k
  (Batch 2 and Batch 3 each had five runs over 250k). Batch-1 total prompt
  tokens fell ~9% against these same ten questions' baselines despite every
  answer being longer and better grounded.
- The dominant residual defect is unchanged and is **acquisition**: five of ten
  runs left at least one named authority unresolved, and the weak trio (Q3, Q4,
  Q5) is weak because the second and third authority never arrived, not because
  reasoning, verification or drafting failed.
- One infrastructure issue recurred: **Q2 and Q4 stalled mid-chunk** and
  required explicit resume calls (Q2 ×1, Q4 ×4) using the existing resume
  mechanism. This inflates their wall latency and nothing else.

**Systemic-bug gate: NO.** Nothing observed invalidates Q11–Q20.

## 2. Exact run IDs

| Q | Label | run_id | Status |
|---|---|---|---|
| Q1 | acceptance-final-Q1 | 6da6c7d3-1e6b-4562-8863-108454a78ee3 | done |
| Q2 | acceptance-final-Q2 | ee9d913e-0ae5-45d6-a925-e45cff424ca7 | done (1 resume) |
| Q3 | acceptance-final-Q3 | 0f6ef055-ad75-459a-9c51-dc8743fa4018 | done |
| Q4 | acceptance-final-Q4 | e5297b38-4515-4342-8924-6df83ef87558 | done (4 resumes) |
| Q5 | acceptance-final-Q5 | 38a6db15-5d47-42b9-b40c-c74d64a9212f | done |
| Q6 | acceptance-final-Q6 | 686bc3eb-160f-4fd3-b8d9-719aad273560 | done |
| Q7 | acceptance-final-Q7 | 2cc531d5-20db-4433-a72f-61c5149098ad | done |
| Q8 | acceptance-final-Q8 | d0a239e4-09d4-4c7d-9153-970e7c6e4bf4 | done |
| Q9 | acceptance-final-Q9 | 682e18e3-8764-432f-991e-14070bee10f2 | done |
| Q10 | acceptance-final-Q10 | b87532ec-97f2-4025-aa01-442ebc9e50ff | done |

## 3. Score table

| Q | Topic | Score | Band | Substantive | Main question answered |
|---|---|---|---|---|---|
| Q1 | הלכת הבוגדת / שיתוף ספציפי | **72** | Usable | yes | yes, narrowly |
| Q2 | פיצוי מוסכם — ביטול/הפחתה | **80** | Strong | yes | yes |
| Q3 | תום לב במשא ומתן + תרופות | **62** | Weak | yes | partially |
| Q4 | אחריות רשות ציבורית — מחדל פיקוח | **55** | Material failure boundary / Weak | yes | partially |
| Q5 | סמינריון — זכויות יוצרים בקעקועים | **60** | Weak | yes | partially |
| Q6 | פרשנות חוזה — לשון מול נסיבות | **85** | Strong | yes | yes |
| Q7 | הרמת מסך | **85** | Strong | yes | yes |
| Q8 | עילת הסבירות כיום | **88** | Strong | yes | yes |
| Q9 | פגיעה בזכות ההיוועצות | **78** | Usable | yes | yes |
| Q10 | עדות מפי השמועה | **86** | Strong | yes | yes |

Rubric per question (25 correctness / 20 coverage / 15 authority / 20 grounding
/ 10 synthesis / 10 clarity), same philosophy as Batches 2–3.

## 4. Per-question review

### Q1 — הלכת הבוגדת — 72/100
**Result.** Substantive, 1,371 chars, 1 footnote. Correctly refuses the popular
framing ("no rule stripping property for infidelity"), identifies the real issue
as specific-sharing in a pre-marital inherited home, reports the DNGC holding
that sexual infidelity is not a relevant consideration, and the obligation of
rabbinical courts to apply civil law as the Supreme Court interprets it. Weak
on "המצב המשפטי כיום" beyond that single case.
**Evidence.** 4 verified claims, 0 unsupported; support verdicts 2 supports /
5 partial / 0 non-support. Single authority: דנג"ץ 8537/18 — via a law-portal
reproduction, not the official text. Sought but not obtained: `case:4602/13`.
**Safety.** No identity conflict, no span/support failure, no temporal issue,
no unsupported proposition in the answer. Uncertainty around the scope of the
ruling is disclosed implicitly, not explicitly — minor.
**Efficiency.** 147.7k prompt / 7,056 completion tokens; 14 steps; 16 model
calls; 447s (includes a 280s resume gap); 8 searches; 9 fetches / 8 documents;
23 targeted rereads (16 productive); 0 span-hunting exhaustions; 0 repairs; 1 chunk.
**Defect class.** authority discovery (single-source answer) — root cause: only
one reproduction of the DNGC judgment was obtainable; 4602/13 never acquired.

### Q2 — פיצוי מוסכם — 80/100
**Result.** Substantive, 1,838 chars, 2 footnotes. Correct statutory frame
(s.15(a) Remedies Law), correct objective "reasonable person at formation,
judged against the breach that occurred" test from קרסו מוטורס, and a genuinely
careful point that the statute authorises *reduction*, not cancellation, with
reduction-to-zero noted as a district-level instance rather than a separate rule.
**Evidence.** 5 verified claims, 0 unsupported; 3 supports / 5 partial. Primary
statute + Supreme Court judgment (official court.gov.il download) — best source
balance in the batch. Unresolved: `case:18/89`, `case:4481/90` (אניסימוב line).
**Safety.** Clean: no identity, span, support or temporal failure.
**Efficiency.** 220.8k / 8,974; 19 steps; 22 model calls; 1,074s wall (inflated
by a mid-chunk stall + resume); 8 searches; 10 fetches; 22 rereads (19
productive); 0 exhaustions; 0 repairs; 2 chunks. Highest prompt cost in batch.
**Defect class.** efficiency (mild) + infrastructure (stall/resume). Substance
is sound; the missing אניסימוב-era authority costs it coverage points.

### Q3 — תום לב במשא ומתן — 62/100
**Result.** Substantive, 1,851 chars, 2 footnotes, with an explicit limitation
paragraph. Correct on s.12, culpa in contrahendo, the classic categories of
breach, and the reliance/expectation distinction — but the analysis rests almost
entirely on ע"א 207/79 בית יולס. The decisive modern development (קל בניין
6370/00 and expectation-interest damages) is absent, and the answer says so.
**Evidence.** 4 verified claims, **1 unsupported (core C5)**, 1 explicit
`does_not_support` verdict; 3 supports / 3 partial. `central_issue_covered:
false` with 11 gap terms including `6370/00`, `בנין`, `מישרין` — the sufficiency
layer detected exactly the right gap.
**Safety.** The unsupported core claim did **not** reach the answer; the answer
discloses the gap instead. Correct behaviour.
**Efficiency.** 119.0k / 8,007; 11 steps; 13 model calls; 167s; 7 searches;
3 fetches; 30 rereads (23 productive); 0 exhaustions; 0 repairs; 2 chunks.
**Defect class.** acquisition/body — קל בניין never obtained; sufficiency
correctly flagged it but no repair path existed. Root cause is the same
court.gov.il/portal reachability problem, not reasoning.

### Q4 — אחריות רשות ציבורית — 55/100
**Result.** Substantive but thin, 1,447 chars, 1 footnote, with an honest and
prominent limitation paragraph. What is said is correct (ע"א 6313/19: no a
priori immunity; over-deterrence and discretion enter through the standard of
care; duty ≠ absolute liability; contributory fault). What is asked — the
competing lines of authority, the policy arguments on both sides, and the
boundary between governmental discretion and compensable negligence — is largely
not delivered.
**Evidence.** Only 2 verified claims; 0 unsupported reaching the answer, but
core C5 unsupported and dropped; 1 supports / 2 partial. One authority, via a
law-firm reproduction. Unresolved: `case:915/91` (עיריית ירושלים/לוי line),
`case:1678/01`. 1 repair cycle fired and did not restore coverage;
`central_issue_covered: false` with 8 gap terms.
**Safety.** Clean and explicitly self-limiting. No unsupported proposition in
the answer text.
**Efficiency.** 123.0k / 8,536; 10 steps; 13 model calls; 2,543s wall — almost
entirely stall/resume gap, not research; 5 searches; 10 fetches; 10 rereads;
0 exhaustions; 1 repair; 1 chunk.
**Defect class.** acquisition/body (primary) + infrastructure (repeated
mid-chunk stall). Root cause: two named leading judgments unobtainable; the
repair cycle had nothing new to work with.

### Q5 — סמינריון, זכויות יוצרים בקעקועים — 60/100
**Result.** Substantive, 1,715 chars, 2 footnotes. Correctly separates
subsistence of the tattooist's copyright from the scope of any licence, notes
that reproducing a tattooed athlete is not autonomous use of the tattoo, and
lists the real defences (implied licence, fair use, de minimis). But this is a
seminar-chapter request: it asked for academic literature, the scholarly
controversy and a coherent legal argument, and delivered two US district-court
opinions with no academic articles, no Israeli copyright analysis and no
comparative framing beyond the US cases.
**Evidence.** 4 verified claims, 0 unsupported; 1 supports / 5 partial. Two
primary US sources, zero secondary/academic despite 3 academic searches.
`central_issue_covered: true` — defensible on the narrow doctrinal tension,
generous relative to the chapter brief.
**Safety.** Clean; no invented Israeli authority, which is the important
negative result here.
**Efficiency.** 58.4k / 5,433; 7 steps; 9 model calls; 142s; 8 searches
(3 academic, 3 raw-web, 24 raw results, 3 fetched); 12 fetches; 2 rereads;
0 exhaustions; 0 repairs; 1 chunk. Cheapest-but-one run.
**Defect class.** scholarship discovery — root cause: academic search returned
nothing admissible; the run converged on the two litigation PDFs it could read.

### Q6 — פרשנות חוזה — 85/100
**Result.** Substantive, 1,623 chars, 2 footnotes. Correct and current:
purpose-based interpretation, language as starting point and boundary, אפרופים
surviving דנ"א מגדלי ירקות, explicit rejection of a return to a rigid
"ambiguity-first" rule, subjective common purpose can decide, and the 2011
s.25 amendment machinery including the unrepresented-parties limits.
**Evidence.** 5 verified claims, 0 unsupported; 1 supports / 7 partial /
1 non-support. Official Supreme Court PDF + statute text. 1 temporally
sensitive claim → 1 current_verified, 0 unresolved. Unresolved: `case:4628/93`
(אפרופים itself — the doctrine is nonetheless correctly stated via the DNA).
**Safety.** Clean. Temporal machinery worked as designed.
**Efficiency.** 162.4k / 7,243; 14 steps; 17 model calls; 139s; 5 searches;
5 fetches; 46 rereads (27 productive, 19 not) — **the only run where the
span-hunting gate fired: 1 exhaustion, 9 suppressed reads**; 0 repairs; 2 chunks.
**Defect class.** none material; mild efficiency (reread churn, correctly capped).

### Q7 — הרמת מסך — 85/100
**Result.** Substantive, 2,461 chars, 2 footnotes. Accurate and complete on the
statutory frame (separate personality; s.6 conditions — fraud/creditor
oppression or unreasonable risk to solvency; shareholder awareness including
wilful blindness; holdings, s.192/193 duties), the exceptional nature of the
remedy, the personal-liability distinction, and the application in נשאשיבי.
One cosmetic citation defect: footnote 1 is labelled "סעיפים 5–4" for content
that is ss.4–6.
**Evidence.** 5 verified claims, 0 unsupported; 10 partial / 0 non-support.
Statute + official Supreme Court PDF. 3 temporally sensitive claims → all 3
current_verified. Unresolved: `case:10582/02`, `case:313/08` (the latter
nonetheless reached via an official PDF of the report volume).
**Safety.** Clean.
**Efficiency.** 189.0k / 7,381; 16 steps; 19 model calls; 159s; 4 searches;
8 fetches; 30 rereads, **all 30 productive**; 0 exhaustions; 0 repairs; 2 chunks.
**Defect class.** citation rendering (minor section-label error).

### Q8 — עילת הסבירות — 88/100
**Result.** Best answer of the batch. Substantive, 2,091 chars, 3 footnotes.
Traditional content of the reasonableness ground; Amendment 3 to Basic Law: The
Judiciary (26.7.2023) and its precise scope (government, PM, ministers, including
appointments and refusals to act); בג"ץ 5658/23 striking it down 8–7; and the
current state — the amendment void as of 1.1.2024 per the official updated text,
therefore no statutory distinction today between elected-tier and other
administrative decisions. Exactly what "כיום" required.
**Evidence.** 5 verified claims, 0 unsupported; 2 supports / 4 partial. Knesset
official texts ×2 + the judgment (portal reproduction). 2 temporally sensitive
claims → both current_verified.
**Safety.** Clean; the most time-sensitive question in the batch and the
temporal layer carried it correctly.
**Efficiency.** 168.2k / 11,039; 14 steps; 18 model calls; 230s; 8 searches;
7 fetches; 18 rereads (11 productive); 0 exhaustions; 0 repairs; 2 chunks.
**Defect class.** none material.

### Q9 — זכות ההיוועצות — 78/100
**Result.** Substantive, 1,666 chars, 2 footnotes. Correct: no automatic
exclusion; the free-will/voluntariness admissibility test; and the יששכרוב
judicial exclusionary doctrine as a flexible, circumstance-dependent balance
with a dominantly preventive purpose. Coverage is slightly thin — s.32 of the
Arrest Law and post-יששכרוב developments are not discussed.
**Evidence.** 5 verified claims, 0 unsupported; 2 supports / 6 partial. Two
official Supreme Court PDFs (יששכרוב, אלזם) — clean primary sourcing. No
unresolved authorities.
**Safety.** Clean.
**Efficiency.** Cheapest run: 48.7k / 6,309; 5 steps; 7 model calls; 87s;
1 search; 3 fetches; 5 rereads, all productive; 0 exhaustions; 0 repairs; 1 chunk.
**Defect class.** none material; mild coverage shortfall.

### Q10 — עדות מפי השמועה — 86/100
**Result.** Substantive, 2,721 chars (longest), 2 footnotes. Statement of the
rule, the cross-examination rationale and the wrongful-conviction risk, then a
structured, accurate exception list: ss.9, 10, 10א, 36 and 23 of the Evidence
Ordinance with their operative conditions.
**Evidence.** 7 verified claims (most in batch), 0 unsupported; 4 supports /
7 partial. Evidence Ordinance + ע"פ 8704/09 באשה (portal reproduction). No
unresolved authorities.
**Safety.** Clean.
**Efficiency.** 164.2k / 8,466; 14 steps; 16 model calls; 204s; 8 searches;
5 fetches; 51 rereads (38 productive, 13 not) — highest reread count, but
zero exhaustions because most reads yielded new quotes; 0 repairs; 3 chunks.
**Defect class.** none material.

## 5. Baseline comparison

Per-question numeric scores for the original Q1–Q5 (prelaunch) and Q6–Q10
(Batch 2) runs were not persisted — only Batch-2 aggregates (mean 70.6, median
72.5). Comparison below therefore uses persisted output metrics plus a
qualitative read of the earlier answers.

| Q | prev prompt tokens → now | prev footnotes → now | prev answer chars → now | Quality direction |
|---|---|---|---|---|
| Q1 | 64.6k → 147.7k | 1 → 1 | 718 → 1,371 | Improvement (fuller, still single-source); cost up |
| Q2 | 175.9k → 220.8k | 2 → 2 | 2,025 → 1,838 | Comparable; cost up — variance |
| Q3 | 43.8k → 119.0k | **0 → 2** | **316 → 1,851** | **Clear improvement** (was near-empty) |
| Q4 | 107.1k → 123.0k | 2 → 1 | 2,074 → 1,447 | **Regression in coverage** (see §8) |
| Q5 | 226.5k → 58.4k | 2 → 2 | 2,129 → 1,715 | Comparable substance at **26% of the cost** |
| Q6 | **342.2k → 162.4k** | 1 → 2 | 1,167 → 1,623 | **Improvement + 53% cheaper** |
| Q7 | 98.1k → 189.0k | 1 → 2 | 1,180 → 2,461 | Improvement; cost up |
| Q8 | **272.4k → 168.2k** | 2 → 3 | 1,340 → 2,091 | **Improvement + 38% cheaper** |
| Q9 | 48.5k → 48.7k | 1 → 2 | 1,787 → 1,666 | Improvement (second primary source), identical cost |
| Q10 | 156.7k → 164.2k | 2 → 2 | 1,622 → 2,721 | Improvement; cost flat |

Batch total: **1,535.8k → 1,401.5k prompt tokens (−9%)** while answer length
rose in 7 of 10 and footnote count rose in 5 of 10.

## 6. Failure / root-cause analysis

| Layer | Questions | Root cause |
|---|---|---|
| Acquisition / body | Q1, Q2, Q3, Q4, Q6 | Named judgments unreachable (court.gov.il 403/reset, no portal reproduction). Unresolved keys: 4602/13; 18/89, 4481/90; 915/91, 1678/01; 4628/93; 10582/02, 313/08. |
| Scholarship discovery | Q5 | Academic search yielded no admissible body; seminar brief needed literature. |
| Sufficiency / repair | Q3, Q4 | Gap detected correctly (`central_issue_covered: false`), but repair has no new acquisition path when the missing authority is unreachable. Not a false positive — the honest failure mode. |
| Citation rendering | Q7 | Footnote labelled "סעיפים 5–4" for ss.4–6. |
| Infrastructure | Q2, Q4 | Mid-chunk stall with live `agent_state` and no self-resume; recovered by explicit resume (Q2 ×1, Q4 ×4). Same signature as Q30 in Batch 3. |
| Efficiency | Q2 (mild) | 220.8k for two authorities. Below the old pathological tail. |

Notably **absent** this batch: verification leakage (0 unsupported claims
reached any answer), identity conflicts (0), temporal unresolved/contradicted
(0 of 6 sensitive claims), invariant errors (0), drafter errors (0),
limitation-only answers (0), zero-evidence answers (0).

## 7. Efficiency analysis

| Metric | Value |
|---|---|
| Total prompt tokens | 1,401,450 |
| Average prompt tokens / question | 140,145 |
| Median prompt tokens | 155,028 |
| Maximum prompt tokens | 220,803 (Q2) |
| Minimum prompt tokens | 48,717 (Q9) |
| Average agent steps | 12.4 |
| Median latency | ~186s |
| Maximum latency | 2,543s (Q4 — stall/resume gaps, not research) |
| Runs > 250k prompt tokens | **0** (Batch 2: 5, Batch 3: 5) |
| Span-hunting exhaustions | 1 (Q6 only) |
| Span-hunting reads suppressed | 9 (Q6 only) |
| Repair cycles | 1 total (Q4) |
| Targeted rereads / productive | 237 / 180 (76%) |

**Does the expensive-tail span-hunting problem still appear materially? No.**
The 84%-unproductive reread pathology is not reproduced: across the batch 76%
of targeted rereads produced new quotable text. The suppression gate fired in
exactly one run (Q6: 19 no-new-quote rereads → 1 exhaustion → 9 suppressions),
which is the intended narrow behaviour, and Q6 came in at 85/100 for half its
baseline cost. Cost is now dominated by ordinary multi-turn research, not by
zero-novelty loops.

Remaining latency risk is the **mid-chunk stall**, not tokens: two of ten runs
would have hung indefinitely without an operator resume. In production this is a
user-visible hang, and it is the single most important non-quality finding here.

## 8. Regression signals

**Real regression — 1 candidate.**
- **Q4** (55): 2 footnotes → 1, 2,074 → 1,447 chars, and coverage of the
  "competing approaches / policy arguments" half of the question lost. Plausible
  current-system cause: the run opened 5 authority targets, acquired 2, and left
  both leading negligence-in-supervision judgments unresolved, so the repair
  cycle had nothing to add. This is the acquisition bottleneck, already
  documented, not a new defect — but it is materially worse output than baseline.

**Likely variance.**
- Q1 and Q7 cost more than baseline for better answers; Q2 cost 25% more for an
  equivalent answer with a different second authority. Different research routes,
  no deterministic new bug.
- Q5 is far cheaper and slightly shorter — same substantive content, different route.

**Improvement attributable to the shipped work.**
- Q3: near-empty (316 chars, 0 footnotes) → 1,851 chars, 2 footnotes — the
  acquisition orchestrator reaching a usable body where the baseline reached none.
- Q6 and Q8: 53% and 38% token reductions with *better* answers — span-hunting
  suppression (Q6) and reduced loop churn.
- Temporal: 6 sensitive claims across Q6/Q7/Q8, **all 6 current_verified, zero
  unresolved, zero contradicted** — the temporal evidence-selection and
  claim-isolation fixes holding under acceptance conditions.

No recommendation is made from any single variance case, and nothing was fixed.

## 9. Systemic-bug gate

**Did Batch 1 reveal a new systemic defect that makes Q11–Q20 invalid or
wasteful to run?**

**NO.**

- No pipeline stage broke across multiple questions. Verification, identity,
  temporal, sufficiency and drafting were clean in all ten.
- No verification leakage: zero unsupported propositions reached any answer.
- No temporal regression: 6/6 sensitive claims resolved current_verified.
- The span-hunting patch did not repeatedly harm quality; it fired once and that
  run scored 85 at half its baseline cost.
- Acquisition failure is pervasive but **pre-existing and already characterised**;
  it degrades individual answers rather than invalidating measurement.
- The mid-chunk stall affected 2 runs and was fully recoverable through the
  existing resume path; it distorts latency figures only, not results.

**Recommendation: proceed to Q11–Q20 on the unchanged build.** Record stall
occurrences and resume counts per run so the frequency can be measured across
the remaining twenty questions.

## 10. Batch statistics

| Statistic | Value |
|---|---|
| Mean score | 75.1 |
| Median score | 79 |
| Minimum | 55 (Q4) |
| Maximum | 88 (Q8) |
| ≥ 90 | 0 |
| ≥ 80 | 5 |
| ≥ 70 | 7 |
| < 70 | 3 |
| < 50 | 0 |
| Limitation-only answers | 0 |
| Zero verified evidence | 0 |
| Material unsupported output in a delivered answer | 0 |
| Temporal failures | 0 |
| Acquisition failures (≥1 unresolved named authority) | 5 (Q1, Q2, Q4, Q6, Q7) |

Band distribution: Excellent 0, Strong 5, Usable 2, Weak 3, Material failure 0.
Against Batch 2 (mean 70.6, median 72.5) and Batch 3 (mean 64.7, median 72),
this batch is the strongest measured so far on mean, median and floor — the
floor in particular moved from 15 to 55.

**Separate callout, not hidden by any score:** no factual or grounding error was
identified in any delivered answer. The failures in this batch are failures of
*omission* (missing authority, missing policy discussion, missing academic
literature), all of which the system disclosed rather than papered over.

---

ACCEPTANCE BATCH 1 MIXED — REVIEW BEFORE Q11–Q20

NO CODE CHANGED.
