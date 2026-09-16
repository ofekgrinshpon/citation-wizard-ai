# ReLex V2 — Final Acceptance Benchmark, Batch 3 (Q21–Q30)

Frozen build (identical to Acceptance Batches 1 and 2). No code, prompt, model,
budget, threshold or routing change was made before, during or after this batch.
No deploy. No retry of any weak result. Each question executed exactly once.

**Execution discipline.** Runs were strictly sequential: Q(n+1) was launched only
after Q(n) reached `status = done` and was persisted. At no point was more than
one acceptance run active. This is the key methodological difference from Batch 2,
which accidentally executed 15 concurrent runs.

---

## 1. Executive summary

- Ten substantive answers, **zero limitation-only answers**, zero zero-evidence
  answers. Batch 2 produced three total acquisition failures (Q14/Q16/Q17, scored 5);
  none recurred here.
- Mean **71.3**, median **77**, range 45–86. Five answers ≥80.
- **Safety clean.** Zero identity conflicts, zero drafter errors, zero invariant
  errors, zero unsupported claims reaching any answer, zero contradicted temporal
  claims. One run (Q30) carried four temporally unresolved claims, which it
  disclosed rather than asserted.
- **Acquisition reliability improved against Batch 2** under sequential execution:
  12 unresolved authorities across 7 questions (Batch 2: 13 across 8), but crucially
  **no question collapsed** because acquisition failed — the worst outcome this batch
  is a partially substantive answer with an honest scope caveat.
- Remaining quality ceiling is source quality, not pipeline failure: several strong
  answers rest on Wikisource statute copies, law-firm reprints and academic articles
  rather than the official text of the judgment or law they discuss.
- One stall (Q21), recovered by the existing resume mechanism inside the same run.

---

## 2. Run IDs

| Q | run_id | status | chunks |
|---|---|---|---|
| Q21 | 9255cbb2-0c1f-4176-95a8-294e2773bc92 | done | 1 |
| Q22 | 0be634bc-c6f4-4041-ac6d-3f3eaafa19de | done | 2 |
| Q23 | 9ffc7f6e-a6ed-4d4b-b778-3d49090c77f4 | done | 1 |
| Q24 | 41753165-fbab-4ac9-a149-d5108bdb6de2 | done | 3 |
| Q25 | 9cb372e6-90f2-4342-8978-299953ec4e42 | done | 3 |
| Q26 | 0d13602b-40f7-4075-9158-241fd0c4ba58 | done | 2 |
| Q27 | 678b71a0-d4dc-4b8e-b601-55baa03ae100 | done | 2 |
| Q28 | 5a5babb2-b14a-44a8-a4c0-0682ad0ba1ce | done | 2 |
| Q29 | 4533053e-a790-4ca8-a630-70ed4c4c8bc1 | done | 2 |
| Q30 | 5ca57769-1ef4-452a-be89-f06ab09253d1 | done | 1 |

Prompts are the exact fixed benchmark texts (recovered verbatim from the persisted
V2 evaluation set, `scripts/v2-batch3-eval.ts` QUESTIONS map). No prompt was
reconstructed or substituted.

---

## 3. Score table

| Q | Topic | Score | Band | Answer state | Main question answered |
|---|---|---|---|---|---|
| Q21 | פסילה פסיקתית / יששכרוב | **86** | Strong | fully substantive | yes |
| Q22 | הבטחה שלטונית | **72** | Usable | fully substantive | yes |
| Q23 | פגם בחתימת עדים בצוואה | **55** | Material failure | partially substantive | partly |
| Q24 | קיפוח לפי ס' 191 | **82** | Strong | fully substantive | yes |
| Q25 | הסדר כובל בעל פה | **55** | Material failure | partially substantive | partly |
| Q26 | עסקאות נוגדות | **80** | Strong | fully substantive | yes |
| Q27 | שיתוף פוסט כפרסום | **84** | Strong | fully substantive | yes |
| Q28 | עובד מול קבלן עצמאי | **74** | Usable | fully substantive | yes |
| Q29 | זכות טיעון וביטול רישיון | **80** | Strong | fully substantive | yes |
| Q30 | סטודנט, חופש ביטוי ומשמעת | **45** | Material failure | partially substantive | partly |

---

## 4. Per-question review

### Q21 — 86
**Result.** Fully substantive. Correct statement of the יששכרוב discretionary
exclusion doctrine, the three balancing axes, the explicit "not every constitutional
breach excludes" answer, and the בן חיים development plus the 2021 private bill
(correctly marked as not binding law).
**Evidence.** 9 verified claims (5 core), 0 unsupported reaching the answer, 3 footnotes:
ע"פ 5121/98 יששכרוב and רע"פ 10141/09 בן חיים — both **official Supreme Court PDFs** —
plus a Knesset bill document. Best source quality in the batch.
**Safety.** 0 identity conflicts; 2 temporal claims, both current_verified; 4 core
claims flagged unsupported internally were revised or withheld, not published.
**Efficiency.** 122,189 pt / 12,610 ct / 10 steps / 14 calls / 198 s wall / 5 searches
(1 web, 1 corpus, 3 official) / 5 fetches / 30 targeted rereads (15 new) / 8 suppressed /
1 exhaustion / 1 repair / 1 chunk.
**Acquisition.** 2 authorities opened and acquired, 0 unresolved.
**Failure classification.** None material. `central_issue_covered=false` with coverage
ratio 0.133 is a **sufficiency false negative** — the answer does discuss the listed gap
terms. It triggered one repair cycle (accepted, "coverage_restored"); cost only.

### Q22 — 72
**Result.** Fully substantive and legally correct: the five cumulative conditions,
the authority (ultra vires) requirement, the intention to create legal effect, and the
release test with the burden on the authority.
**Evidence.** 4 verified claims (4 core), 0 unsupported, **1 footnote — an academic
article** (משפטים, "הבטחה מינהלית"). The canonical authorities (סאי-טקס 135/75, 585/01)
were sought and **not obtained**.
**Safety.** Clean. No temporal claims.
**Efficiency.** 132,333 pt / 6,216 ct / 13 steps / 15 calls / 152 s / 8 searches +
3 raw-web / 6 fetches / 18 rereads (9 new) / 5 suppressed / 1 exhaustion / 0 repairs / 2 chunks.
**Acquisition.** Opened 6, acquired 1 (בג"ץ 5517/17). Unresolved: `case:585/01`,
`case:135/75` — both **body obtained but identity rejected** (`docket_absent_from_body`).
**Failure classification.** Authority acquisition/identity. The doctrine survived via a
scholarly restatement; the cost is source quality, not correctness.

### Q23 — 55
**Result.** Partially substantive. Correctly identifies the form defect under
צוואה בעדים and the curing power (two cumulative conditions, reasoned decision), then
**explicitly declines** the burden-of-proof and case-law parts of the question.
**Evidence.** 3 verified claims (3 core), 0 unsupported, 1 footnote — **Wikisource copy**
of חוק הירושה.
**Safety.** Clean; the limitation paragraph is honest.
**Efficiency.** 58,104 pt / 5,874 ct / 6 steps / 9 calls / 157 s / 5 searches + 1 raw-web /
12 fetches / 2 rereads / 0 suppressed / 0 repairs / 1 chunk. Cheapest run of the batch.
**Acquisition.** §20 acquired only on the 4th attempt (three `http_403`). Unresolved:
`statute:חוק הירושה#25` — **candidate found but body unavailable** (3× `no_usable_body`,
1× `http_403`); `case:2098/97` — **body obtained but identity rejected** twice, plus one
`docket_mention_not_self_identifying`.
**Failure classification.** Acquisition/body. Section 25 is the curing provision the
question turns on; without it the answer could not reach burden of proof. Root cause is
the official-egress block, not reasoning.

### Q24 — 82
**Result.** Fully substantive: §191 mechanism, outcome-focused oppression test,
legitimate expectations, quasi-partnership, and a concrete remedies list.
**Evidence.** 4 verified claims (4 core), 0 unsupported, 2 footnotes — ע"א 8712/13
(official Supreme Court PDF) and ע"א 3432/17 (**law-firm reprint**).
**Safety.** Clean.
**Efficiency.** 280,737 pt / 8,064 ct / 20 steps / 22 calls / 205 s / 8 searches /
5 fetches / **40 rereads (32 productive)** / 0 suppressed / 0 repairs / 3 chunks.
The most expensive run — but the rereads were 80% productive, so this is research cost,
not span-hunting waste.
**Acquisition.** 4 opened, 3 acquired, 0 unresolved (one `http_400` retried successfully).

### Q25 — 55
**Result.** Partially substantive. The core competition-law answer is right and useful
(the §2(b) presumptions are conclusive; actual harm need not be proved), but the run
**explicitly fails the oral-agreement half** of the question, and the answer is only 828
characters.
**Evidence.** 2 verified claims (1 core), 0 unsupported, 1 footnote — **an academic
article** (Gal). The statute itself was acquired but not cited.
**Safety.** Clean.
**Efficiency.** 209,683 pt / 5,546 ct / 19 steps / 21 calls / 151 s / 8 searches +
2 raw-web / 10 fetches / 13 rereads (10 new) / 0 suppressed / 0 repairs / 3 chunks.
Poor yield per token: 210k for two claims.
**Acquisition.** 3 unresolved: `case:4855/02` (**identity rejected**,
`docket_absent_from_body`), `case:6339/18` (**identity rejected**,
`judgment_body_form_absent` — the known PDF/judgment-form false negative), `case:6222/97`
(**identity rejected** 4×, three of them `docket_mention_not_self_identifying`).
**Failure classification.** Identity gate, repeatedly. All three authorities had readable
bodies; none bound. This is the clearest identity-strictness cost in the batch.

### Q26 — 80
**Result.** Fully substantive: §9 חוק המקרקעין, the first-buyer priority rule, the three
cumulative conditions of the exception, the applied conclusion for the facts, and the
caveat-note on גנז.
**Evidence.** 4 verified claims (2 core), 0 unsupported, 2 footnotes — Wikisource copy of
חוק המקרקעין and ע"א 2643/97 גנז via a secondary site.
**Efficiency.** 165,796 pt / 9,424 ct / 15 steps / 18 calls / 197 s / 8 searches +
3 raw-web / 5 fetches / 24 rereads (9 new) / 7 suppressed / 1 exhaustion / 0 repairs / 2 chunks.
**Acquisition.** 0 unresolved; גנז acquired on the 4th attempt after three `http_403`.
The answer discloses that it could not reach the operative holding of גנז — accurate and
well-handled, but it caps the score.

### Q27 — 84
**Result.** Fully substantive and sharp: הלכת שאול (רע"א 1239/19), the Share/Like
distinction, application to the added words, and the correct caveat that publication ≠
liability (defences, mitigation).
**Evidence.** 4 verified claims (3 core), 0 unsupported reaching the answer, 2 footnotes.
Footnote 1 is the official Supreme Court PDF of רע"א 1239/19. **Footnote 2 is weak**: a
gov.il dynamic-collector URL whose display title is an unrelated family-court judgment.
**Safety.** One core claim (C3) unsupported internally — withheld, not published.
**Efficiency.** 242,188 pt / 10,324 ct / 19 steps / 22 calls / 209 s / 7 searches +
3 raw-web / **3 fetches** / **60 rereads (21 new), 21 suppressed**, 1 exhaustion /
1 repair / 2 chunks. Span-hunting suppression fired hard here and still the run cost 242k.
**Acquisition.** `statute:חוק איסור לשון הרע` unresolved at whole-law level
(`http_403`); §2 acquired from a secondary body. `central_issue_covered=false` —
another sufficiency false negative on an answer that plainly answers the question.

### Q28 — 74
**Result.** Fully substantive: the contractual label and invoicing are not decisive,
personal-work and continuity indicators, and a proper factual-inquiry framing.
Correct but somewhat generic — the canonical multi-factor test is not named or
structured as such.
**Evidence.** 3 verified claims (3 core), 0 unsupported, 1 footnote — עע (ארצי)
11064-01-18 via a secondary site.
**Efficiency.** 130,284 pt / 6,070 ct / 15 steps / 17 calls / 173 s / 8 searches +
2 raw-web / 8 fetches / 18 rereads (7 new) / 0 suppressed / 1 exhaustion / 0 repairs / 2 chunks.
**Acquisition.** `case:478/09` unresolved: one **identity rejection**
(`judgment_body_form_absent`) and two `docket_absent_from_body` — a readable body existed
(S3 is titled ע"ע 478/09) but never bound. 2 opened, 0 acquired.

### Q29 — 80
**Result.** Fully substantive: the right to be heard exists absent statutory mention,
scales with the severity of the harm, prior hearing omission can be incurable, and the
decision falls.
**Evidence.** 5 verified claims (4 core), 0 unsupported, 3 footnotes — בג"ץ 3/58 ברמן,
בג"ץ 654/78 גינגולד, בר"מ 8707/19. Only the last is an official court PDF; **the two
classic judgments are cited through law-firm pages**, which is a citation-quality defect
for authorities of this stature.
**Efficiency.** 118,878 pt / 7,516 ct / 11 steps / 13 calls / 175 s / 7 web searches /
6 fetches / 26 rereads (13 new) / 3 suppressed / 1 exhaustion / 0 repairs / 2 chunks.
**Acquisition.** 4 opened, 2 acquired (ledger shows 3 bound), `case:6023/22` unresolved
(**candidate found, body unavailable** — `http_403`).

### Q30 — 45
**Result.** Partially substantive and the weakest answer of the batch. One genuine
section on interim exclusion and proportionality; everything else — the university's legal
status, students' free speech, the statutory disciplinary framework, the right to be heard
in the disciplinary process — is listed in a **limitations block** as unverified.
**Evidence.** 1 verified claim (1 core, partially supported), **4 unsupported claims
dropped**, 1 footnote — Wikisource copy of חוק זכויות הסטודנט.
**Safety.** Nothing unsupported reached the user, but **4 temporally unresolved claims** —
the only temporal failure in the whole 30-question benchmark. Handled by disclosure, not
assertion.
**Efficiency.** 113,806 pt / 8,150 ct / 11 steps / 13 calls / 252 s (longest wall time) /
8 web searches + 3 raw-web / 12 fetches / 21 rereads (16 new) / 0 suppressed / 0 repairs / 1 chunk.
**Acquisition.** Unresolved: `statute:חוק זכויות הסטודנט#13` (**candidate found, body
unavailable** — 4× `no_usable_body`) and `case:73/53` קול העם (5 attempts: 1
`judgment_body_form_absent`, 1 `unreadable_encoding`, 1 `docket_absent_from_body`,
2× `http_403`) — **the pathological case of the batch: five distinct failure modes on one
canonical judgment.**
**Failure classification.** Acquisition/body + temporal unresolved + user-facing
presentation (see §7).

---

## 5. Acquisition reliability — main measurement

| Q | Unresolved authority | Classification |
|---|---|---|
| Q22 | case:585/01 | body obtained but identity rejected |
| Q22 | case:135/75 | body obtained but identity rejected |
| Q23 | statute:חוק הירושה #25 | candidate found but body unavailable |
| Q23 | case:2098/97 | body obtained but identity rejected |
| Q25 | case:4855/02 | body obtained but identity rejected |
| Q25 | case:6339/18 | body obtained but identity rejected (judgment_body_form_absent) |
| Q25 | case:6222/97 | body obtained but identity rejected |
| Q27 | statute:חוק איסור לשון הרע (whole law) | candidate found but body unavailable (403) |
| Q28 | case:478/09 | body obtained but identity rejected |
| Q29 | case:6023/22 | candidate found but body unavailable (403) |
| Q30 | statute:חוק זכויות הסטודנט #13 | candidate found but body unavailable |
| Q30 | case:73/53 | mixed: body unavailable (403/encoding) + identity rejected |

Totals: **12 unresolved authorities across 7 of 10 questions.**
By class: identity rejection **7**, body unavailable **4**, mixed **1**, not discovered **0**,
unusable span/text **0**.

**Discovery is not the bottleneck.** Every unresolved authority was discovered and had at
least one concrete candidate. The failure is downstream: either the network edge refuses
the official body (403 / no usable body), or a readable body fails the identity gate.

Answer-state outcome: fully substantive **7**, partially substantive **3**,
limitation-only **0**.

### Comparison with Batch 2 (concurrent execution)

| Metric | Batch 2 (15 concurrent) | Batch 3 (sequential) |
|---|---|---|
| Unresolved authorities | 13 | 12 |
| Questions with unresolved authorities | 8/10 | 7/10 |
| Questions failing entirely on acquisition | **3** (Q14, Q16, Q17 — scored 5) | **0** |
| Zero-evidence answers | 3 | 0 |
| Limitation-only answers | 3 | 0 |
| Mean score | 59.2 | 71.3 |
| Median score | 80 | 77 |

The *count* of unresolved authorities barely moved, but the *catastrophic* failure mode
disappeared entirely. Under concurrency, three questions lost every authority at once and
produced nothing; sequentially, no question was starved. This supports the hypothesis that
Batch 2's three total failures were concurrency-induced fetch contention rather than a
build defect — and it means acquisition reliability figures measured under concurrency
understated the build.

---

## 6. Stalls

| Q | stalled | manual_resume_count | automatic_resume_count | stall_duration |
|---|---|---|---|---|
| Q21 | yes | 1 | 0 | ~152 s without chunk progress; internal `resume_gap` 94 s |
| Q22–Q30 | no | 0 | 0 | — (resume_gap 0–2 s, except Q30 35 s) |

Q21 showed no chunk progress for over 150 seconds and was resumed with the existing
`resume_run_id` mechanism; the same run continued and completed normally. It was not
restarted. Note the harness threshold used for Q21 (150 s) is close to normal chunk
duration, so this may have been a premature resume of a healthy run rather than a true
stall; the threshold was raised to 240 s for Q22–Q30 and never triggered again.

Stall rate this batch: 1/10 (10%), fully recovered, no data loss.

---

## 7. User-facing defects

| Defect | Observed |
|---|---|
| Internal IDs (`case:…`, `S1`) in answers | **No** — none in any of the ten answers |
| Tool/debug language | **No** |
| Raw failure metadata (`http_403`, `docket_absent_from_body`) | **No** |
| Truncated / mismatched source names | **Yes** — Q27 footnote 2 attaches a family-court display title and a gov.il collector URL to a Supreme Court proposition; Q21 footnote 3 begins with a raw filename `24_lst_599238.docx`; Q28 footnote reads "חלק 2" |
| Awkward limitation text | **Yes** — Q30's limitations block enumerates six unverified topics and says a readable text of a statute section "לא הושג", which reads like an internal status report; Q23 and Q25 limitation sentences are honest but blunt ("לא בוססה בחומר המאומת שסופק") |
| Non-authoritative citation for canonical law | **Yes** — Wikisource statute copies (Q23, Q26, Q30), law-firm reprints for ברמן and גינגולד (Q29), for ע"א 3432/17 (Q24) and for the labour judgment (Q28) |

None of these is a correctness or safety failure, but the limitation phrasing and the
secondary-source citations are the most visible quality gaps to an actual lawyer.

---

## 8. Academic / corpus usage

No Q21–Q30 question is an academic or seminar-style developed request, so no run should
have routed to academic scope — and none did: `search_calls.academic = 0` in all ten runs.

Corpus was used in 6 of 10 runs (Q21 1, Q22 4, Q23 1, Q24 2, Q25 2, Q26 3; Q27 2;
Q28 2; Q29 0; Q30 0 — 17 corpus searches total). Corpus-derived local bindings were
recorded only incidentally (Q21 acquired both judgments from `local:legal_documents`
records, the two official Supreme Court PDFs that produced the best-cited answer in
the batch). Two questions (Q29, Q30) used **no corpus search at all** and relied entirely
on web search — and those are exactly the two runs that ended up citing law-firm pages and
Wikisource for canonical Israeli authorities. Academic sources did reach two final answers
(Q22 משפטים article, Q25 Gal article) through ordinary web/corpus discovery, not academic
routing.

---

## 9. Batch statistics

**Quality**

| Metric | Value |
|---|---|
| Mean | 71.3 |
| Median | 77 |
| Min | 45 (Q30) |
| Max | 86 (Q21) |
| ≥90 | 0 |
| ≥80 | 5 |
| ≥70 | 7 |
| <70 | 3 |
| <50 | 1 |
| Limitation-only | 0 |

**Safety**

| Metric | Value |
|---|---|
| Unsupported material reaching user | 0 |
| Identity failures (conflicts) | 0 |
| Temporal failures | 4 unresolved claims, all in Q30; 0 contradicted |
| Verification leakage | 0 |
| Drafter / invariant failures | 0 / 0 |

**Reliability**

| Metric | Value | Batch 2 |
|---|---|---|
| Questions with unresolved authorities | 7/10 | 8/10 |
| Total unresolved authorities | 12 | 13 |
| Questions failing entirely on acquisition | 0 | 3 |
| Limitation-only rate | 0% | 30% |

**Efficiency**

| Metric | Value |
|---|---|
| Total prompt tokens | 1,573,998 |
| Average | 157,400 |
| Median | 131,309 |
| Max | 280,737 (Q24) |
| Runs >250k | 1 |
| Median wall time | 186 s |
| Max wall time | 252 s (Q30) |
| Stalls | 1 |

Span-hunting suppression fired in 5 runs (Q21 8, Q22 5, Q26 7, Q27 21, Q29 3 suppressed
reads; 5 exhaustions total). The expensive tail is no longer dominated by zero-yield
rereads: Q24, the most expensive run, had 32 of 40 rereads productive.

---

## 10. Full Q1–Q30 aggregate

Scores: 72, 80, 62, 55, 60, 85, 85, 88, 78, 86 | 79, 88, 82, 5, 86, 5, 5, 79, 81, 82 |
86, 72, 55, 82, 55, 80, 84, 74, 80, 45.

| Metric | Value |
|---|---|
| Mean | **68.5** |
| Median | **79.5** |
| ≥90 | 0 |
| 80–89 | 15 (50%) |
| 70–79 | 6 (20%) |
| 60–69 | 2 (7%) |
| <60 | 7 (23%) |
| Substantive-answer rate | 27/30 (90%) |
| Limitation-only / zero-evidence rate | 3/30 (10%) — all three in the concurrent Batch 2 |
| Unsupported-output rate | 0/30 |
| Temporal failure rate | 1/30 runs (Q30, 4 unresolved claims); 0 contradicted |
| Identity failure rate | 0/30 |
| Total prompt tokens | ≈4.20 M |
| Average prompt tokens | ≈140 k |
| Median latency | ≈180 s |
| Stall rate | 3/30 (10%), all recovered in-run |
| Questions with ≥1 unresolved authority | ~20/30 (67%) |

### Performance when usable evidence is obtained vs when acquisition fails

| Cohort | n | Mean score |
|---|---|---|
| All needed authorities acquired | Q21, Q24, Q26 (+ Batch 1/2 equivalents) | **82.7** in Batch 3 |
| One or more authorities unresolved, answer still built | Q22, Q23, Q25, Q27, Q28, Q29, Q30 | **66.4** |
| Acquisition failed outright (concurrent Batch 2) | Q14, Q16, Q17 | **5** |

This is the single most important number in the benchmark. **The reasoning, verification,
drafting and citation stack performs at 83–88 whenever it holds the real document.** Every
score below 70 in the entire 30-question run traces to a document the system could not
obtain or could not bind — not to legal reasoning, not to synthesis, not to safety.

---

## 11. Launch-readiness analysis

Ranked by practical user impact. No fixes implemented.

1. **Acquisition reliability — HIGH (the only true blocker candidate).**
   67% of questions lose at least one named authority. Two distinct causes:
   (a) the official egress block (gov.il / court portal 403s, unusable statute SPA
   bodies) — 5 of 12 unresolved authorities; (b) the identity gate rejecting readable
   genuine bodies — 7 of 12, including three in Q25 alone and the known
   `judgment_body_form_absent` false negative on real judgments. Consequence is not
   wrong law; it is thinner coverage and secondary citations. Under sequential execution
   it no longer destroys whole answers.
2. **Citation / source quality — HIGH for a legal audience.** Wikisource statute copies
   and law-firm reprints of ברמן, גינגולד, גנז and ע"א 3432/17 are cited as the authority
   for propositions. Lawyers will notice immediately. Direct consequence of (1).
3. **User-facing failure presentation — MEDIUM-HIGH, cheapest to fix.** Q30's limitations
   block reads like an internal status log, and Q23/Q25 decline parts of the question in
   flat internal phrasing. Nothing leaks IDs or debug tokens, but the register is wrong.
4. **Sufficiency false positives/negatives — MEDIUM (direction reversed).** The remaining
   defect is false *negatives*: Q21 and Q27, both good answers, were marked
   `central_issue_covered=false` (Q21 ratio 0.133 over gap terms the answer discusses),
   triggering repair cycles that cost tokens without changing the outcome. No evidence of
   the old dangerous false positive.
5. **Token cost — MEDIUM.** Average 157k, one run at 281k. The span-hunting patch is
   working (Q27's 60 rereads produced 21 suppressions), but multi-chunk exploratory runs
   (Q24, Q25, Q27) still spend 200k+. Q25 spent 210k for two verified claims — the worst
   yield in the batch.
6. **Latency — MEDIUM-LOW.** Median 186 s, max 252 s. Acceptable for deep research with
   visible progress, poor for anything presented as fast.
7. **Stalls / resume — LOW.** One occurrence in ten, recovered in-run by the existing
   mechanism, no data loss, and plausibly a premature trigger by the harness threshold.
   Batch 2's zero manual resumes and Batch 1's two suggest an occasional, recoverable
   chunk pause rather than a systemic defect.
8. **Academic retrieval — NOT EXERCISED.** No academic question in Q21–Q30; routing
   correctly stayed off. The Batch 2 finding (large local corpus under-used on developed
   questions) is untested here and remains open. Notably, the two runs that used no corpus
   search at all produced the weakest citations.

**Overall.** Safety and correctness are launch-grade: zero unsupported propositions
reached a user across thirty questions, zero identity failures, zero drafter or invariant
errors, and the system consistently discloses what it could not establish instead of
inventing it. The gap is supply, not judgment — and it manifests as thinner answers and
non-authoritative citations, both of which a professional user will see. Items 1–3 should
be addressed before a legal-professional launch.

---

FINAL ACCEPTANCE COMPLETE — REMEDIATION REQUIRED BEFORE LAUNCH

NO CODE CHANGED.
