# ReLex V2 — Final Acceptance Benchmark, Batch 2 (Q11–Q20)

Build: identical to Acceptance Batch 1 (no deploy, no code, prompt, budget,
model or threshold change between the batches). Measurement only.

## 1. Executive summary

Ten runs, one execution each, on the frozen build.

- **Mean 59.2 / median 80.0 / min 5 / max 88.** The mean is dragged down by
  three limitation-only answers (Q14, Q16, Q17); the seven substantive answers
  score 79–88 and are, as a group, the strongest output this benchmark has
  produced.
- **No safety failures.** Zero identity conflicts, zero drafter errors, zero
  invariant errors, zero temporal unresolved/contradicted, zero unsupported
  claims reaching a user-visible answer. Every limitation-only answer names
  precisely what could not be obtained.
- **Cost collapsed.** 1.23M prompt tokens for the batch against 2.17M for the
  same ten questions at baseline (−43%), with one run above 250k (Q20, 284k).
  The expensive span-hunting tail does not reappear: 4 suppressions and 3
  exhaustions across the entire batch.
- **No stalls needing manual intervention.** Zero manual resumes. One run
  (Q15) was observed briefly in `paused` state at chunk 1 and advanced on its
  own; the Q2/Q4 signature from Batch 1 (stuck at chunk 1 for ~15 minutes,
  manual POST required) did not recur.
- **The single remaining bottleneck is acquisition**, exactly as in Batch 1.
  All three failures and every weak point in the strong answers trace to a
  named authority whose body could not be fetched — not to planning,
  verification, temporal logic, sufficiency or drafting.
- **One sufficiency false positive:** Q16 reported `central_issue_covered =
  true` over a pack containing zero verified claims.

### Execution note (disclosed in full)

The launcher imported the Batch 3 harness module, whose top-level loop
re-launched Q16–Q20 under their old `batch3-*` labels at the same moment. The
acceptance benchmark set is unambiguous — the ten `acceptance-final-Q11…Q20`
runs, each executed once, and only those are scored below. The five stray
`batch3-Q16…Q20` runs are *not* part of the benchmark, were not used for
grading, and are referenced only once, in §10, as same-build variance
evidence. Their existence also means the batch ran at 15 concurrent runs
rather than 10, which is noted as a possible contributor to the acquisition
failures in §5.

## 2. Exact run IDs

| Q | run_id | status | chunks | wall |
|---|---|---|---|---|
| Q11 | `2f7f2262-b7c0-4530-a311-7626f71209ca` | done | 2 | 91.6 s |
| Q12 | `a2d2ba6c-5b24-4eab-b7c8-0148148c9626` | done | 3 | 158.8 s |
| Q13 | `087386fc-9e1a-436e-85f7-4622665b8389` | done | 1 | 86.4 s |
| Q14 | `532c45df-e12b-4d9f-8dae-2999a4dad82e` | done | 1 | 59.3 s |
| Q15 | `c2b37cd2-b056-458c-969a-90cd7dc9c27c` | done | 2 | 181.0 s |
| Q16 | `5b76f97a-8fa8-4c09-8424-8256cd9eb54f` | done | 1 | 80.9 s |
| Q17 | `5d6abd4f-17c2-4876-b874-3fb2089299a7` | done | 1 | 81.7 s |
| Q18 | `132584be-73ae-4b07-a05d-1fbbdfbcfc14` | done | 2 | 139.9 s |
| Q19 | `4ab43b7a-2a08-4f42-90ef-127936138f8b` | done | 1 | 94.2 s |
| Q20 | `9869c283-5947-43a2-aea3-a28fbf469351` | done | 2 | 223.3 s |

Prompts were recovered verbatim from the persisted benchmark source
(`batch2-Q11…Q15` question column; `Q16…Q20` from the established V2 harness
constant). None was reconstructed or invented.

## 3. Score table

| Q | Topic | Score | Band | Substantive | Main question answered |
|---|---|---|---|---|---|
| Q11 | השפעה בלתי הוגנת בצוואה | **79** | Usable | yes | yes |
| Q12 | חובת זהירות מול חובת אמונים | **88** | Strong | yes | yes |
| Q13 | מונופולין — סטטוס מול ניצול לרעה | **82** | Strong | yes | yes |
| Q14 | אשם תורם | **5** | Material failure | no (limitation-only) | no |
| Q15 | תום לב במו"מ — תרחיש ספק | **86** | Strong | yes | yes |
| Q16 | פסקת ההגבלה / מידתיות | **5** | Material failure | no (limitation-only) | no |
| Q17 | רשלנות רשות בפיקוח ואכיפה | **5** | Material failure | no (limitation-only) | no |
| Q18 | חוזה למראית עין | **79** | Usable | yes | yes |
| Q19 | כלל שיקול הדעת העסקי | **81** | Strong | yes | yes |
| Q20 | הגנה מן הצדק | **82** | Strong | yes | mostly |

Rubric: 25 correctness / 20 coverage / 15 authority / 20 grounding /
10 synthesis / 10 clarity — identical philosophy to Batches 1–3.

## 4. Per-question review

### Q11 — השפעה בלתי הוגנת — 79
**Result.** Substantive, 1,467 chars, 2 footnotes. Legally correct: s.30(a)
Succession Law, the four dependence tests (עצמאות, סיוע, קשר עם אחרים,
נסיבות עריכה), the point that dependence alone is not undue influence, and
the בן נון qualification that the burden shifts only where the provision is
"בעליל לטובתו". This is the right answer to the question asked.
**Evidence.** 5 verified claims, all core; 0 unsupported; support verdicts
3 supports / 5 partial / 0 contradicting. Both footnotes are **secondary**
(a specialist commentary page and a law-firm article). No primary judgment
body entered the pack.
**Retrieval.** ע"א 4902/91 — discovered, candidates existed, acquisition
attempted, body not obtained (network edge). Classification: *candidate found,
body acquisition failed*. Not discovery failure, not identity rejection.
**Safety.** 0 identity conflicts, 0 temporal, 0 invariant/drafter errors. The
doctrine is stated without overclaiming; no unsupported proposition reached
the answer.
**Efficiency.** 115,798 pt / 4,452 ct / 11 steps / 13 model calls / 91.6 s /
1 corpus search / 10 fetches / 15 targeted rereads (11 new-quote, 4 no-new) /
0 exhaustions / 0 suppressions / 0 repairs / 2 chunks.
**Defect class.** acquisition/body — authority quality ceiling, not error.

### Q12 — חובת זהירות מול חובת אמונים — 88
**Result.** Substantive, 2,576 chars, 2 footnotes, the best answer in the
batch. Correctly separates the standard (reasonable-officer process quality,
duty to gather information) from the loyalty duty (conflict, competition,
corporate opportunity, non-disclosure), and then does the part most answers
omit: consequences — contract-law treatment of loyalty breach, the strict
approval conditions, and the insurance/exemption asymmetry.
**Evidence.** 7 verified claims (5 core, 2 supporting), 0 unsupported.
Footnotes are the **primary statute** (Companies Law ss. 252/261) from two
independent copies. No case law — the main authority gap.
**Retrieval.** s.256 of the Companies Law unresolved (*candidate found, body
acquisition failed*); it is not load-bearing for the delivered answer.
**Safety.** Clean on every axis.
**Efficiency.** 245,026 pt / 22 steps / 24 calls / 158.8 s / 3 searches
(2 web, 1 official) / 3 fetches / 32 rereads (25 new-quote) / 0 suppressions /
3 chunks. Expensive but productive: 78% of rereads yielded new quotes.

### Q13 — מונופולין — 82
**Result.** Substantive, 1,629 chars, 1 footnote. Answers the actual question
("is holding a monopoly itself prohibited?") correctly: status is not an
offence; the definition (over half of supply/acquisition, or significant
market power, possibly regional); the special duties attaching to status
(unreasonable refusal to supply, Commissioner's directives); and the separate
prohibition on abuse with the statutory examples.
**Evidence.** 5 claims (3 core), 0 unsupported, 5 temporally sensitive claims
all `current_verified`. Single **primary** source (Competition Law on Nevo).
The footnote labels the source "סעיף 26(א)" while the material spans the
definition and abuse provisions — a citation-precision imprecision, not a
factual error.
**Retrieval.** No unresolved authorities.
**Efficiency.** 79,503 pt / 6 steps / 86.4 s / 1 official search / 1 fetch /
8 rereads, all new-quote / 0 suppressions / 1 chunk. Cleanest run of the batch.

### Q14 — אשם תורם — 5
**Result.** Limitation-only, 466 chars, 0 footnotes, 0 verified claims. The
question was not answered. The disclosure is honest and specific: it names
7130/01 and 2245/91 as unreadable and lists ss. 68–70 of the Torts Ordinance
among the sources tried without usable text.
**Evidence.** Zero. Support verdicts: 2 `does_not_support`, 0 supporting —
the drafter correctly refused to write.
**Retrieval.** 12 fetch attempts, 12 documents "fetched", zero usable bodies:
*candidates found, bodies acquired but evidence/span unusable* for the
Ordinance sections, and *body acquisition failed* for the two judgments. This
is not a discovery failure — five authority targets were opened.
**Safety.** No fabrication, no unsupported output, uncertainty fully
disclosed. `central_issue_covered = false`, correctly.
**Efficiency.** 34,577 pt / 6 steps / 59.3 s — it failed cheaply and fast.
**Defect class.** acquisition/body. Root cause: the Torts Ordinance copies
reached returned no extractable section text, and the agent had no alternative
readable copy; it then stopped rather than degrade to unsourced doctrine.

### Q15 — תום לב במו"מ (תרחיש) — 86
**Result.** Substantive, 2,582 chars, 5 footnotes. Handles the scenario the way
a lawyer would: contract formation first (גמירת דעת/מסוימות, the board-approval
caveat), then s.12 bad-faith withdrawal, then remedies — reliance damages as
the norm, expectation damages in the exceptional קל בנין situation, and
enforcement/limits if a contract was formed.
**Evidence.** 4 claims (3 core), 0 unsupported, 16 partial-support verdicts.
Authorities: **primary** Contracts Law s.12 and Remedies Law s.1(a), plus
ע"א 6370/00 קל בנין via a secondary reproduction; רבינאי is cited to Wikipedia
— the weakest citation in the batch.
**Retrieval.** No unresolved authorities; all four targets acquired.
**Efficiency.** 153,469 pt / 12 steps / 181 s / 5 searches / 8 fetches /
29 rereads (21 new-quote, 8 no-new) / 1 exhaustion, 2 suppressions / 2 chunks.
The suppression path fired and the answer did not suffer.

### Q16 — פסקת ההגבלה — 5
**Result.** Limitation-only, 307 chars, 0 footnotes, 0 verified claims. The
central constitutional-review question was not answered.
**Evidence.** Zero. Support verdicts all zero.
**Retrieval.** 12 fetch attempts, 9 documents, **2 raw-web bodies rejected on
identity**, 1715/97 and 2056/04 unresolved. Mixed classification: *body
acquired but identity rejected* (2) and *body acquisition failed* (2). One
repair cycle ran and did not recover the pack.
**Safety.** No fabrication. But `central_issue_covered = true` over an empty
verified pack — a **sufficiency false positive**, the one grounding-logic
defect in the batch. It caused no user-visible harm (the drafter refused
anyway), but it is a real mismatch and is recorded here unfixed.
**Efficiency.** 73,920 pt / 9 steps / 80.9 s / 4 searches (3 corpus, 1
official) / 1 repair / 1 chunk.
**Defect class.** acquisition/body + identity rejection; secondary:
sufficiency.

### Q17 — רשלנות רשות ציבורית — 5
**Result.** Limitation-only, 693 chars, 0 footnotes, 0 verified claims.
**Evidence.** Zero. The disclosure names 915/91, 243/83 and 1678/01 as
unreadable, and exposes raw internal identifiers ("case:915/91") plus two
truncated district-court descriptions in user-facing text — a presentation
defect worth noting even in a failure.
**Retrieval.** 6 authority targets opened, 1 acquired, 12 fetch attempts,
11 documents, none usable: *candidates found, bodies acquired but span/evidence
unusable*, plus *acquisition failed* on the three named judgments. One repair
cycle, no recovery.
**Safety.** No fabrication; uncertainty disclosed; `central_issue_covered =
false`, correctly.
**Efficiency.** 46,192 pt / 7 steps / 81.7 s / 4 searches (3 corpus, 1 web).
**Defect class.** acquisition/body. Note this is the same subject matter that
failed as Q4 in Batch 1 (55) — the שיקולי מדיניות / מחדל פיקוח line of
authority is the single most consistently unreachable area in the benchmark.

### Q18 — חוזה למראית עין — 79
**Result.** Substantive, 1,163 chars, 1 footnote. Correct on all four limbs:
identification through real intention rather than wording, absolute vs
relative simulation, void ab initio between the parties under s.13, and
protection of a third party who relied in good faith.
**Evidence.** 5 claims, all core, 0 unsupported, 4 supports / 1 partial.
All of it rests on a **single secondary reproduction** of ע"א 3642/11 — the
statute itself was never acquired as a primary body, which is the reason this
scores 79 rather than high 80s.
**Retrieval.** 630/78 and 3642/11 unresolved as official bodies; the answer is
built from a secondary copy of the latter. *Candidate found, body acquisition
failed* → secondary substitution succeeded.
**Efficiency.** 121,493 pt / 11 steps / 139.9 s / 8 searches / 10 fetches /
12 rereads (6/6) / 1 exhaustion, 1 suppression / 2 chunks.
**Baseline note.** This is the question that was limitation-only before the
acquisition work; it is now substantive and correct in every acceptance-grade
run.

### Q19 — כלל שיקול הדעת העסקי — 81
**Result.** Substantive, 1,451 chars, 1 footnote. Correctly grounded in
ע"א 7735/14 ורדניקוב: reception of the BJR into Israeli law, the three
cumulative conditions (no conflict, subjective good faith, informed decision),
the rule as judicial restraint focused on process, burden-shifting on a
procedural defect, and the entire-fairness standard where conflict exists.
**Evidence.** 5 claims (4 core), 0 unsupported. One footnote — the Vardnikov
judgment itself (PDF copy hosted by a law firm): substantively primary text,
formally a secondary host.
**Retrieval.** ss. 252/253/254 of the Companies Law unresolved — so the
statutory duty-of-care anchor is missing, which is why the
zahirut/emunim comparison is thinner than Q12's. *Candidate found, body
acquisition failed.*
**Efficiency.** 74,309 pt / 8 steps / 94.2 s / 6 rereads, all new-quote /
0 suppressions / 1 chunk.

### Q20 — הגנה מן הצדק — 82
**Result.** Substantive, 1,656 chars, 3 footnotes. s.149(10) CPL, the
post-בורוביץ expansion, the explicit point that malice is not required and
negligent or good-faith failures can suffice, and a defect taxonomy
(broken governmental promise, oppressive delay, selective enforcement,
disproportionate resort to criminal process).
**Gap.** The three-stage בורוביץ balancing test is not spelled out as a test —
`central_issue_covered = false` with gap terms כתב/אישום/סעד/יטול, i.e. the
remedy side (when the indictment is actually quashed versus a lesser remedy)
is under-developed. Correct negative by the sufficiency check.
**Evidence.** 3 claims, all core, 0 unsupported, 4 supports. Sources: a
secondary article, the **Borovich judgment PDF**, and an **official
supremedecisions.court.gov.il** download of רע"פ 1611/16 — the only official
court body acquired anywhere in the batch.
**Retrieval.** 2910/94 unresolved (*body acquisition failed*).
**Efficiency.** 283,945 pt / 22 steps / 25 calls / 223.3 s / 8 searches /
10 fetches / 49 rereads (40 new-quote, 9 no-new) / 1 exhaustion, 2
suppressions / 1 repair / 2 chunks. The most expensive run of the batch, but
82% of its rereads produced new quotes — productive, not span-hunting.

## 5. Retrieval / acquisition analysis

Unresolved named authorities, by failure mode:

| Authority | Q | Discovered | Candidates | acquire attempted | Attempts | Failure mode | Alternative copy |
|---|---|---|---|---|---|---|---|
| ע"א 4902/91 | Q11 | yes | yes | yes | ≥2 | network/portal | no |
| חוק החברות §256 | Q12 | yes | yes | yes | ≥2 | statute portal shell | not needed |
| ע"א 7130/01 | Q14 | yes | yes | yes | ≥2 | network/portal | no |
| ע"א 2245/91 | Q14 | yes | yes | yes | ≥2 | network/portal | no |
| פקודת הנזיקין §§68–70 | Q14 | yes | yes | yes | several | body reached, no usable section text | no |
| בג"ץ 1715/97 | Q16 | yes | yes | yes | ≥2 | **identity rejected** (PDF judgment) | no |
| 2056/04 | Q16 | yes | yes | yes | ≥2 | network/portal | no |
| ע"א 915/91 | Q17 | yes | yes | yes | ≥2 | network/portal | no |
| ע"א 243/83 | Q17 | yes | yes | yes | ≥2 | network/portal | no |
| 1678/01 | Q17 | yes | yes | yes | ≥2 | network/portal | no |
| ע"א 630/78 | Q18 | yes | yes | yes | ≥2 | network/portal | yes (secondary) |
| ע"א 3642/11 | Q18 | yes | yes | yes | ≥2 | official body not obtained | yes (secondary) |
| חוק החברות §§252–254 | Q19 | yes | yes | yes | ≥2 | statute portal shell | no |
| ע"א 2910/94 | Q20 | yes | yes | yes | ≥2 | network/portal | no |

15 unresolved authority keys across 8 of 10 runs. Breakdown by the four
requested categories:

- **discovery failure:** 0. Every authority the system needed, it named and
  located candidates for.
- **candidate found, body acquisition failed:** 11 (the dominant mode).
- **body acquired, identity rejected:** 2 (both in Q16, the known PDF-judgment
  false-negative in the self-identity gate).
- **body acquired, evidence/span unusable:** 2 (Q14 Torts Ordinance sections,
  Q17 district-court texts).

The relay was configured and used sparingly (Q16: 1 relay call, 1 success,
9 slots unspent). No run exhausted its acquisition budget. The concurrency
confound (15 simultaneous runs, see §1) plausibly worsened the network-edge
failure rate; it cannot explain the identity rejection or the unusable-span
cases.

## 6. Academic / developed-query handling

None of Q11–Q20 is an academic, seminar, literature-review or comparative
request; `classifyDeliverable` would rate all ten `focused`. Measured anyway:

| Q | scope: academic | scope: corpus | corpus candidates used | academic bodies read | academic sources verified | academic sources in answer |
|---|---|---|---|---|---|---|
| Q11 | 0 | 1 | 0 | 0 | 0 | 0 |
| Q12 | 0 | 0 | 0 | 0 | 0 | 0 |
| Q13 | 0 | 0 | 0 | 0 | 0 | 0 |
| Q14 | 0 | 0 | 0 | 0 | 0 | 0 |
| Q15 | 0 | 1 | 0 | 0 | 0 | 0 |
| Q16 | 0 | 3 | 0 | 0 | 0 | 0 |
| Q17 | 0 | 3 | 0 | 0 | 0 | 0 |
| Q18 | 0 | 3 | 0 | 0 | 0 | 0 |
| Q19 | 0 | 1 | 0 | 0 | 0 | 0 |
| Q20 | 0 | 3 | 0 | 0 | 0 | 0 |

**`scope: academic` was never invoked in the entire batch.** `scope: corpus`
was invoked 15 times across 7 runs, and **not one corpus candidate reached a
footnote** — every cited source in the batch came from the open web. On this
evidence the large local corpus contributed nothing to the delivered answers
in Q11–Q20. Measurement only; no routing change made.

## 7. Stall / resume analysis

| Q | stalled | resume_count | where | auto/manual | resume_gap_ms | active model+tool ms | total wall ms |
|---|---|---|---|---|---|---|---|
| Q11 | no | 0 | — | — | 0 | 91,556 | 91,572 |
| Q12 | no | 0 | — | — | 0 | 158,800 | 158,811 |
| Q13 | no | 0 | — | — | 0 | 86,364 | 86,375 |
| Q14 | no | 0 | — | — | 0 | 59,265 | 59,277 |
| Q15 | transient | 0 (self-advanced) | chunk 1 boundary | automatic | <60,000 (observed once in `paused`, advanced before next poll) | 181,001 | 181,012 |
| Q16 | no | 0 | — | — | 0 | 80,919 | 80,931 |
| Q17 | no | 0 | — | — | 0 | 81,708 | 81,719 |
| Q18 | no | 0 | — | — | 0 | 139,934 | 139,945 |
| Q19 | no | 0 | — | — | 0 | 94,200 | 94,211 |
| Q20 | no | 0 | — | — | 0 | 223,324 | 223,335 |

Stalled runs: 0 requiring intervention (1 transient pause). Manual resumes: 0.
Percentage requiring manual resume: 0% (Batch 1: 20%). Longest resume gap: none
measurable. Recorded chunk counts: 1 chunk ×5, 2 chunks ×4, 3 chunks ×1 —
chunking itself is working. The Q2/Q4 signature (indefinite hang at chunk 1,
run never advancing without an external POST) **did not reproduce**; Q15's
pause resolved through the normal chunk mechanism. Wall time equals active
time to within ~15 ms in every run, so no hidden stall time is buried in the
latency figures.

## 8. Baseline comparison

Baselines: `batch2-Q11…Q15` (2026-09-13) and the first `batch3-Q16…Q20`
(2026-09-14).

| Q | score | prompt tokens | footnotes | answer chars | direction |
|---|---|---|---|---|---|
| Q11 | n/a → 79 | 271,007 → 115,798 | 1 → 2 | 1,174 → 1,467 | **improvement** (−57% cost, richer answer, 5 core claims vs 1) |
| Q12 | n/a → 88 | 332,381 → 245,026 | 1 → 2 | 1,666 → 2,576 | **improvement** |
| Q13 | n/a → 82 | 203,425 → 79,503 | 2 → 1 | 1,451 → 1,629 | **improvement** (−61% cost, statute now resolved) |
| Q14 | n/a → 5 | 250,636 → 34,577 | 2 → 0 | 1,059 → 466 | **real regression** (was substantive, now limitation-only) |
| Q15 | n/a → 86 | 173,217 → 153,469 | 3 → 5 | 2,816 → 2,582 | **improvement** |
| Q16 | 84 → 5 | 100,444 → 73,920 | 3 → 0 | 2,052 → 307 | **real regression** |
| Q17 | 70 → 5 | 209,538 → 46,192 | 1 → 0 | 1,803 → 693 | **real regression** |
| Q18 | 15 → 79 | 58,389 → 121,493 | 0 → 1 | 649 → 1,163 | **improvement** (largest gain in the benchmark) |
| Q19 | 25 → 81 | 308,943 → 74,309 | 1 → 1 | 910 → 1,451 | **improvement** (−76% cost, +56 points) |
| Q20 | 62 → 82 | 257,681 → 283,945 | 2 → 3 | 1,845 → 1,656 | **improvement** in grounding at similar cost |

Seven improvements, three regressions. Batch-2 baselines (Q11–Q15) were never
rubric-scored, so only the Q16–Q20 score deltas are exact.

Classification of the three regressions: each is a **single-run acquisition
failure on a build whose acquisition logic is unchanged since the runs that
succeeded**. Q16 and Q17 answered well at baseline and — critically — the
stray same-build, same-minute duplicate executions of the identical prompts
produced substantive 5-claim / 4-claim answers (Q16: 2,126 chars, 2 footnotes;
Q17: 1,785 chars, 1 footnote). Two executions of the same question on the same
build, minutes apart, landing on opposite sides of the evidence threshold is
the definition of **likely variance amplified by an external constraint**
(network edge under 15-way concurrency), not a deterministic new bug. Q14 has
no same-minute comparator and is therefore classified **unresolved**, leaning
variance for the same reason.

## 9. Efficiency analysis

| Q | prompt | completion | steps | model calls | latency | searches (w/o/a/c) | fetches | rereads (new/no-new) | exh | suppr | repairs | chunks |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Q11 | 115,798 | 4,452 | 11 | 13 | 91.6 s | 0/0/0/1 | 10 | 15 (11/4) | 0 | 0 | 0 | 2 |
| Q12 | 245,026 | 7,946 | 22 | 24 | 158.8 s | 2/1/0/0 | 3 | 32 (25/7) | 0 | 0 | 0 | 3 |
| Q13 | 79,503 | 5,521 | 6 | 9 | 86.4 s | 0/1/0/0 | 1 | 8 (8/0) | 0 | 0 | 0 | 1 |
| Q14 | 34,577 | 3,157 | 6 | 8 | 59.3 s | 3/0/0/0 | 12 | 0 | 0 | 0 | 0 | 1 |
| Q15 | 153,469 | 8,145 | 12 | 14 | 181.0 s | 2/2/0/1 | 8 | 29 (21/8) | 1 | 2 | 0 | 2 |
| Q16 | 73,920 | 3,414 | 9 | 10 | 80.9 s | 0/1/0/3 | 12 | 6 (3/3) | 0 | 0 | 1 | 1 |
| Q17 | 46,192 | 3,918 | 7 | 8 | 81.7 s | 1/0/0/3 | 12 | 0 | 0 | 0 | 1 | 1 |
| Q18 | 121,493 | 5,502 | 11 | 13 | 139.9 s | 4/1/0/3 | 10 | 12 (6/6) | 1 | 1 | 0 | 2 |
| Q19 | 74,309 | 5,440 | 8 | 10 | 94.2 s | 2/0/0/1 | 12 | 6 (6/0) | 0 | 0 | 0 | 1 |
| Q20 | 283,945 | 11,089 | 22 | 25 | 223.3 s | 1/4/0/3 | 10 | 49 (40/9) | 1 | 2 | 1 | 2 |

Raw web search: 10 calls across 4 runs (Q11 3, Q14 3, Q16 2, Q20 2), 6 bodies
fetched, 2 identity rejects (Q16). Reread productivity across the batch:
157 targeted rereads, **120 produced a new quote (76%)**, 37 did not; 3
exhaustions, 4 suppressions. The Batch-3-era pathology (84% re-reads, most
yielding nothing) is gone.

## 10. Regression signals

- **Real regression (acquisition-driven, single-run):** Q14, Q16, Q17 —
  limitation-only where baselines were substantive.
- **Same-build variance evidence:** the accidental parallel executions of the
  identical Q16–Q20 prompts on this exact build produced substantive answers
  for all five (Q16 5 claims, Q17 4 claims, Q18 5 claims/3 footnotes, Q19 4
  claims, Q20 5 claims/3 footnotes, 0 unresolved). This is strong evidence
  that Q16/Q17's failures are run-level variance in body acquisition, not a
  deterministic defect introduced since Batch 1.
- **Improvement attributable to the shipped work:** Q18 (+64), Q19 (+56),
  Q20 (+20), and a batch-wide 43% cost reduction attributable to the
  span-hunting fix and the acquisition orchestrator.
- **Grounding-logic defect (unfixed, recorded):** Q16 `central_issue_covered =
  true` over an empty verified pack.
- **Presentation defect (unfixed, recorded):** Q17 exposes raw internal
  identifiers (`case:915/91`) and truncated source descriptions in
  user-facing text.

## 11. Batch statistics (Q11–Q20)

**Quality** — mean 59.2; median 80.0; min 5; max 88; ≥90: 0; ≥80: 5; ≥70: 7;
<70: 3; <50: 3; limitation-only: 3 (Q14, Q16, Q17); zero-evidence answers: 3;
answers with unsupported material reaching the user: **0**.

**Safety** — temporal failures 0 (5 temporally sensitive claims in Q13, all
`current_verified`); identity conflicts 0; verification leakage 0; invariant
errors 0; drafter errors 0; agent errors 0.

**Retrieval** — runs with unresolved named authorities: 8/10; total unresolved
authority keys: 15; acquisition/body failures: 11; identity rejections: 2;
unusable-span failures: 2; discovery failures: 0; scholarship-retrieval
failures: not applicable (no academic query; `scope: academic` never used).

**Efficiency** — total prompt tokens 1,228,232; average 122,823; median 97,650;
max 283,945; questions >250k: 1; average steps 11.4; median active latency
92.9 s; median total wall latency 92.9 s; max wall 223.3 s.

**Infrastructure** — stalled runs requiring resume: 0; total resume count: 0;
percentage requiring resume: 0%; longest resume gap: n/a; transient pauses: 1
(Q15, self-cleared); Q2/Q4 stall signature: **not reproduced**.

## 12. Q1–Q20 provisional aggregate

Scores: 72, 80, 62, 55, 60, 85, 85, 88, 78, 86, 79, 88, 82, 5, 86, 5, 5, 79,
81, 82.

- mean **67.2**; median **79.5**; min 5; max 88.
- distribution: ≥90: 0; ≥80: 10 (50%); ≥70: 14 (70%); <70: 6 (30%); <50: 3 (15%).
- limitation-only rate: 3/20 = **15%**; zero-evidence rate 15%.
- unsupported-output rate: **0/20 = 0%**.
- temporal failure rate 0%; identity-conflict rate 0%; drafter/invariant error
  rate 0%.
- total prompt tokens 2,584,551 (Batch 1 1,356,319 + Batch 2 1,228,232);
  average 129,228 per question; max 283,945; questions >250k: 2/20.
- stall rate requiring manual resume: 2/20 = 10%, all in Batch 1.

Shape of the product after twenty questions: when it obtains a usable body it
produces a strong, honestly grounded, correctly reasoned Hebrew memo (14 of 20
at 70+, 10 at 80+, zero unsupported propositions ever reaching a user). When
body acquisition fails it degrades to an honest refusal rather than to
fabrication. Quality is therefore governed almost entirely by acquisition
success, which is governed by the network edge.

## 13. Systemic-bug gate

**Did Q11–Q20 reveal a systemic problem severe enough that Q21–Q30 should not
be run on this frozen build?**

**NO — proceed unchanged to Q21–Q30.**

Reasoning. The three failures share one stage (body acquisition at the network
edge), but they are not a new deterministic defect: the same build, in the same
minutes, answered two of those same questions substantively. Every pipeline
stage downstream of acquisition behaved correctly in all ten runs — no
verification leakage, no temporal failure, no identity conflict, no drafter or
invariant error, and no unsupported proposition reached a user in any run.
Stalls, the Batch 1 infrastructure concern, did not recur and required zero
intervention. Q21–Q30 will therefore produce valid, comparable data.

Two items are flagged for the launch decision rather than for a code change
now: (a) **acquisition reliability is the launch-critical risk** — roughly
one question in three loses at least one named authority, and in this batch
three lost enough to be unable to answer at all; (b) the Q16 sufficiency
false positive and the Q17 raw-identifier leak into user-facing text.

Note for the record: Q21–Q30 should be launched **sequentially or in small
groups**, not 15 at once, so that the next batch's acquisition results are not
confounded by self-inflicted concurrency.

---

ACCEPTANCE BATCH 2 MIXED — REVIEW BEFORE Q21–Q30

NO CODE CHANGED.
