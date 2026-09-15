# ReLex V2 — Central Sufficiency Reality Check

**Mode: INSPECTION ONLY. No code, prompts, budgets or deployments were changed. No question was rerun.**

Date: 2026-09-15. All data below is read directly from persisted `v2_eval_runs` rows
(`result->'telemetry'`, `result->'answer_markdown'`, `result->'footnotes'`,
`result->'unresolved_questions'`).

---

## 1. Runs inspected

| Q | Run id (post-fix) | Timestamp (UTC) | Fix generation |
|---|---|---|---|
| Q18 | `65c07f13-236f-4e3f-b4c5-b1923fbb1316` | 2026-09-15 03:11:02 | after acquisition orchestrator |
| Q27 | `33438705-e51c-45f9-a6d8-7c726209ad20` | 2026-09-15 03:11:10 | after acquisition orchestrator |
| Q29 | `939dabe5-9048-453a-afab-e0c3a9ea7445` | 2026-09-15 04:33:07 | after acquisition + temporal fixes |
| Q24 | `40cc6f0c-fa9e-4c10-8c34-a9a0337efb5c` | 2026-09-15 04:33:08 | after acquisition + temporal fixes |
| Q19 | **no post-fix run exists** — latest is `ca0ac1f6-e083-4d54-8792-72720d3a6f66` (2026-09-14 03:50:19, Batch 3 baseline) | | pre-fix |

Baselines used for comparison only: Q18 `3d568203`, Q29 `e4e412b3`, Q24 `dc42e78a`,
Q27 `3b7a4ff7` (all 2026-09-14 Batch 3).

---

## 2. Per-question state

### 2.1 Verified state (final pack handed to the drafter)

| Q | verified claims | verified CORE (surviving) | supporting | unsupported CORE | unsupported total | removed by temporal gate | evidence pairs / span-verified | footnotes |
|---|---|---|---|---|---|---|---|---|
| Q18 (post) | 3 | 2 — C1, C2 | 1 | 1 — C3 | 0 after narrowing | 0 (0 sensitive claims; 1 temporal repair counter, no claim lost) | 4 / 4 | 1 |
| Q19 (pre-fix, latest) | 1 | 0 | 1 | 3 — C1, C3, C4 | 4 | 0 (0 sensitive) | 6 / 2 | 1 |
| Q24 (post) | 5 | 3 — C1, C4, C5 | 2 | 2 — C2, C3 | 0 | 0 (0 sensitive, 0 repairs) | 8 / 7 | 1 |
| Q27 (post) | 3 | 0 tagged core | 3 | 0 | 0 | 0 (1 sensitive → current_verified) | 5 / 5 | 2 |
| Q29 (post) | 5 | 0 tagged core | 5 | 0 | 0 | 0 (1 sensitive → current_verified) | 7 / 7 | 3 |

### 2.2 Sufficiency state

| Q | `central_issue_covered` | `coverage_ratio` | gap terms | repair decision | central repair ran? | acceptance | final answer |
|---|---|---|---|---|---|---|---|
| Q18 (post) | false | 0.226 | `["יחסית"]` | skipped — `central_gap_not_research_fixable` | no | — | substantive, 1,170 chars, 1 footnote + explicit limitations |
| Q19 (pre-fix) | false | 0.026 | 18 terms (כלל, שיקול הדעת, חובת זהירות, אמונים …) | repair fired | yes (1 cycle) | `coverage_still_missing` → rejected | thin, 910 chars: names ורדניקוב, states the rest unverified |
| Q24 (post) | false (trigger state) | 0.324 | `["לגיטימיות"]` | repair fired | yes (1 cycle) | `coverage_restored` | substantive, 1,843 chars, 1 footnote |
| Q27 (post) | true | n/a (not assessed) | — | `no_unsupported_core_claims` | no | — | substantive, 1,897 chars, 2 footnotes |
| Q29 (post) | true | n/a (not assessed) | — | `no_unsupported_core_claims` | no | — | substantive, 1,978 chars, 3 footnotes |

---

## 3. Human reality check (actual final answers read in full)

**Q18 — "חוזה למראית עין" — PARTIAL (leaning YES on doctrine).**
The answer states the §13 rule (void contract), the protection of a third party who relied
in good faith, the substantive identifying test (agreed gap between presentation and real
intention), and the absolute/relative distinction with the separate proof burden for the
hidden contract. That is the substance of the question. What it lacks is a primary source:
everything rests on one secondary page (`dinrega.com`), and the memo says so explicitly,
plus it flags that neither ביטון נ' מזרחי nor the official statute text was obtained.
Materially answers the legal question; authority quality is weak and honestly disclosed.

**Q19 (pre-fix, latest available) — NO.**
The answer names ורדניקוב as the recognition point and then explicitly states that the
conditions of application, the relation to duty of care / fiduciary duty, and the
circumstances for substantive review "נותרו ללא מענה". Three of four sub-questions are
unanswered. The internal state agrees (coverage 0.026, repair fired, repair rejected).

**Q24 — "קיפוח לפי סעיף 191" — YES.**
Covers the §191(a) cause of action, the judicial meaning of קיפוח (unfair distribution,
result-based not motive-based), burden shifting, legitimate expectations, the
"מעין שותפות" / close-company context, and the remedies including court-ordered share
purchase. All four parts of the question are answered.

**Q27 — "שיתוף כפרסום" — YES.**
Answers the §2 publication element, applies רע"א 1239/19 directly, draws the Share/Like
distinction on the active-dissemination vs. algorithmic-byproduct rationale, and applies it
to the added "חשוב שכולם יראו את זה" wording. Remaining caveats are genuine
(whether the content is defamatory, defences) and correctly held outside the question asked.

**Q29 — "ביטול רישיון עסק ללא שימוע" — YES.**
Answers on §7ג(א)/(ב)(1) of חוק רישוי עסקים, the right to be heard and the materiality of
the defect, the bounded disclosure duty and its balancing, the non-automatic cure by a later
hearing/appeal, and the usual remedy (annulment + fresh decision after a proper hearing).
This is the full question.

---

## 4. Internal state vs. final answer

| Q | Internal sufficiency | User-facing answer | Class |
|---|---|---|---|
| Q18 | not covered (0.226), repair skipped as not research-fixable | materially answers the doctrine, discloses the missing primary text | **D — false negative, benign**: no repair wasted, no limitation-only output, the disclosed weakness is real (secondary-source-only) |
| Q19 | not covered (0.026), repair fired and rejected | genuinely does not answer 3 of 4 sub-questions | **B — correct negative** |
| Q24 | not covered at trigger (0.324) → repair → `coverage_restored` | fully answers | **A — correct positive** (the mechanism worked end-to-end: a real gap was detected, repaired, and accepted) |
| Q27 | covered | fully answers | **A — correct positive** |
| Q29 | covered | fully answers | **A — correct positive** |

No run in this set is a **C — false positive**. The single false-negative-shaped case (Q18)
did not degrade the delivered answer: the coverage ratio is a lexical measure and its single
gap term was `"יחסית"`, a word the answer in fact discusses; the decision path ended in
`central_gap_not_research_fixable`, i.e. no repair cycle and no suppression.

---

## 5. Do the old Q18 / Q29 failures still reproduce?

**Q18 — NO, the failure is gone.**

| | baseline `3d568203` | post-fix `65c07f13` |
|---|---|---|
| verified claims | 0 | 3 |
| surviving core | none | C1, C2 |
| `central_issue_covered` | **true** (false positive over an empty pack) | false (honestly assessed) |
| answer | limitation-only, 649 chars, 0 footnotes | substantive, 1,170 chars, 1 footnote |
| prompt tokens | 58,389 | 228,978 |

The exact old pathology — zero verified claims reported as *covered* and delivered as
limitation-only — no longer occurs. The empty-core state that produced it does not arise
because the acquisition orchestrator reached a usable body. Token cost rose sharply, which
is the known, accepted trade of persisting instead of abandoning.

**Q29 — NO, the failure is gone.**

| | baseline `e4e412b3` | post-fix `939dabe5` |
|---|---|---|
| verified claims | 0 (2 lost at the temporal gate) | 5 |
| temporal sensitive / current_verified / unresolved | 2 / 0 / 2 | 1 / 1 / 0 |
| temporal repairs | 1 | 0 |
| `central_issue_covered` | **true** (false positive over an emptied pack) | true (and genuinely covered) |
| answer | limitation-only, 736 chars, 0 footnotes | substantive, 1,978 chars, 3 footnotes citing §7ג(א) and §7ג(ב)(1) |

The temporal evidence-selection fix removed the condition that created the false positive:
the §7ג evidence now survives, so `central_issue_covered = true` is now a true statement
about a non-empty pack rather than a default over an empty one.

**Q19 — the surviving-material question.** In the latest (pre-fix) run the main authority
was acquired and bound, but span/support verification dropped three of four core claims, and
the system correctly refused to claim coverage, ran one repair, rejected it, and delivered an
honest thin answer. That is verification/acquisition quality, not a sufficiency-logic defect:
the sufficiency layer reported exactly what was true. Whether the post-fix pipeline can now
produce a fuller Q19 answer is unknown — no post-fix Q19 run exists — but nothing in the
pre-fix run shows a sufficiency *mismatch* to fix.

**Q27 — no false insufficiency.** Post-fix Q27 is unchanged in substance from its baseline
(1,810 → 1,897 chars, 2 footnotes both times, covered both times, no repair). Prompt tokens
304,871 vs 286,076 — ordinary variance, not a sufficiency effect. A good answer is not being
classified as insufficient.

---

## 6. Recommendation

Across the four available post-fix runs the internal sufficiency verdict matches the
user-facing reality in every case: three correct positives (Q24, Q27, Q29) and one benign
false negative (Q18) that neither suppressed the answer nor triggered a wasted repair. The
two historical false positives (Q18, Q29) were symptoms of the acquisition and temporal bugs
and both are resolved at their root. Zero-core-with-covered-true is still theoretically
reachable, but it is not observable in current behavior, and per the stated principle that is
not sufficient grounds for a new guard.

Two items to watch (not defects, not fixes proposed here):
- Q18's authority quality — a single secondary page carrying the whole answer, disclosed but weak.
- Q18's 228,978 prompt tokens, the known cost of the persistence trade.
- Q19 has no post-fix run; if a fuller picture is wanted later, a single targeted Q19 run
  would close that gap. It is not needed for this verdict, because Q19's latest state is a
  correct negative, not a mismatch.

---

**NO ACTIVE CENTRAL SUFFICIENCY BUG — SKIP IMPLEMENTATION**

NO CODE CHANGED.
