# ReLex Legal Research V2 — Batch 3 Evaluation (Q16–Q30)

Frozen system. No code changed, no deploys, no prompt/budget/tuning changes during or after the batch.
Q30 stalled mid-chunk and was restarted **only** via the existing `resume_run_id` mechanism; it then completed normally.

Run IDs: Q16 acaa0cf2 · Q17 786fa673 · Q18 b29ab51b · Q19 7593796d · Q20 9623b721 · Q21 349f1f10 · Q22 2d6b0f9d · Q23 fb8c0fcf · Q24 6ac895ec · Q25 5a4429e3 · Q26 b3d57840 · Q27 e2f3299c · Q28 d8f88718 · Q29 7844a3f6 · Q30 9cffdd73 (labels `batch3-Q##` in `v2_eval_runs`).

---

## Per-question reports

### Q16 — חוקתיות לפי פסקת ההגבלה — **84/100**
- **A.** Correct two-stage constitutional analysis, limitation-clause conditions, and the three proportionality sub-tests with the right doctrinal ordering (proper purpose examined before proportionality). Omission: no explicit treatment of the modern "cost-benefit" formulation of the third test and no relief/remedy stage.
- **B.** Acquired: בג"ץ 7052/03 (Adalah PDF), בג"ץ 1715/97 (court.gov.il), בג"ץ 3390/16 (PDF). Discovered but unacquired: בנק המזרחי 6821/93 (http_403). Section 8 of Basic Law text not identity-confirmed.
- **C.** 9 evidence pairs / 9 span-verified; 5 research claims, 5 verified, 0 unsupported; 3 footnotes. **Grounding caveat:** 7052/03 and 1715/97 were cited although their acquisition ledger shows `readable_unconfirmed_identity` (`judgment_body_form_absent`) — the bodies are genuine but the self-identity gate rejected them.
- **D.** searches: official 1, corpus 1, web 0; lookups 4; raw_web 2 calls → 3 candidates fetched, 2 identity rejects; fetches 6, 5 readable. Raw web produced the Adalah 7052/03 PDF and the 1715/97 download — targets the other lanes had not surfaced.
- **E.** Central issue covered; sufficiency not triggered; no repair. Correct.
- **F.** 118s, 8 steps, 1 chunk, 11 model calls, 100k prompt / 7.8k completion, 12 already-read, 21 compactions. Efficient.
- **G.** Failure layer: authority identity gate (false negatives) + acquisition (403 on gov.il).

### Q17 — אחריות רשות ציבורית בנזיקין — **70/100**
- **A.** Correct core: no blanket immunity, policy considerations shape the standard rather than negate duty, omission liability turns on actual/constructive knowledge, causation and contributory fault. Missing: the misfeasance/nonfeasance distinction is only implicit; no discussion of the leading Supreme Court line.
- **B.** Acquired: ע"א 6313/19 (via a law-firm reproduction). Unacquired: ע"א 915/91 (`docket_mention_not_self_identifying`, then court.gov.il network error), ע"א 243/83 (403).
- **C.** 6 pairs / 5 span-verified; 4 claims, 4 verified, 0 unsupported; 1 footnote. Single-source answer.
- **D.** web 3, corpus 3, official 1; lookups 3; raw_web 0; fetches 6, 4 readable.
- **E.** Central covered; no sufficiency/repair — arguably should have fired given single-authority support.
- **F.** 132s, 16 steps, 2 chunks, 18 calls, 210k prompt, 54 already-read, 65 compactions.
- **G.** Authority acquisition; secondarily sufficiency detection.

### Q18 — חוזה למראית עין — **15/100** (empty core)
- **A.** No substantive answer. Only a limitation statement listing what could not be verified. Section 13 of the Contracts Law is elementary and should never fail.
- **B.** Unacquired: חוק החוזים (כללי) ס' 13 (`too_short_for_a_document` ×2, then `statute_title_absent_from_body`), ע"א 4705/22 (`judgment_body_form_absent`), ע"א 630/78 (403 + network error).
- **C.** 1 pair, 1 span-verified, 0 verified claims, 1 unsupported, **0 footnotes**.
- **D.** corpus 3, official 2, web 0; lookups 3; raw_web 1 call → 1 fetched, 1 identity reject; fetches 12, only 2 readable.
- **E.** Central issue flagged covered (**mis-signal** — nothing was answered); sufficiency did not fire; no repair. This is the most serious control failure in the batch.
- **F.** 89s, 8 steps, 58k prompt — cheap failure.
- **G.** Acquisition/body retrieval → sufficiency/repair (did not recognise total failure).

### Q19 — כלל שיקול הדעת העסקי — **25/100**
- **A.** Only names ורדניקוב as the recognition point; conditions of application, relation to duty of care/loyalty and the circumstances for substantive review all left unanswered.
- **B.** Acquired: ע"א 6913/18 (court.gov.il). Unacquired: חוק החברות ס' 252 (403). Missing entirely: ורדניקוב itself, ע"א 7735/14 body, entire-fairness line.
- **C.** 6 pairs but only 2 span-verified; 5 claims, 1 verified, **4 unsupported**; 1 footnote.
- **D.** web 3, official 3, corpus 1, academic 1; lookups 1; raw_web 0; fetches 4, 3 readable.
- **E.** Central issue **not** covered; sufficiency fired; repair ran 1 cycle → `coverage_still_missing`. The system correctly recognised the gap and failed to close it.
- **F.** 205s, 24 steps, 3 chunks, 27 calls, **308,943 prompt tokens** (highest in batch), 109 already-read, 117 compactions — pathological loop.
- **G.** Authority acquisition → repair ineffectiveness; efficiency.

### Q20 — הגנה מן הצדק — **82/100**
- **A.** Accurate: statutory anchoring in s.149(10) (Amendment 51, 2007), Borovich three-stage cumulative test, cancellation not automatic, catalogue of flaw types (selective enforcement, delay, investigative failures). Missing: post-Borovich refinements and the relative weight of the third stage.
- **B.** Acquired: Knesset statute PDF, a Supreme Court judgment (court.gov.il). Unacquired: 7052/18 (`judgment_body_form_absent`), 2910/94 (403), CPL s.149 text (403 / too short).
- **C.** 8 pairs / 8 span-verified; 5 claims, 5 verified, 0 unsupported; 2 footnotes.
- **D.** corpus 3, web 2, official 1; lookups 3; raw_web 3 calls → 3 fetched, 0 rejects; fetches 10, 5 readable.
- **E.** Central initially not covered; sufficiency fired; repair 1 cycle → `coverage_restored`. Working as intended.
- **F.** 186s, 19 steps, 22 calls, 258k prompt, 18 already-read.
- **G.** Acquisition only; control layers behaved correctly.

### Q21 — פסילת ראיה / יששכרוב — **85/100**
- **A.** Strong: judicially-created exclusionary doctrine, rejection of automatic exclusion, balancing framework, and post-Issacharov development (בן חיים 2012; דנ"פ אוריך, nine-justice panel, digital searches). Omission: the three Issacharov factors are referenced generically rather than enumerated.
- **B.** Acquired: ע"פ 5121/98 יששכרוב, רע"פ 10141/09 בן חיים (both court.gov.il), plus a press source. Unacquired: 5002/09, 4988/08, 1062/21 (court.gov.il network errors).
- **C.** 8 pairs / 8 span-verified; 5 claims, 5 verified, 0 unsupported; 3 footnotes. One footnote is a Haaretz-hosted PDF — acceptable as a reproduction but not ideal.
- **D.** web 4 only; lookups 2; raw_web 2 calls → 1 fetched, 0 rejects; fetches 6, 3 readable.
- **E.** Central covered; no sufficiency/repair needed.
- **F.** 164s, 19 steps, 3 chunks, 268k prompt, 91 already-read, 98 compactions — high already-read churn.
- **G.** None dominant; minor efficiency.

### Q22 — הבטחה שלטונית — **72/100**
- **A.** The five cumulative conditions, the authority requirement (including functional ultra vires), intention to create legal effect, and lawful retraction with reliance affecting remedy rather than validity. All correct. Weakness: no case law at all.
- **B.** Acquired: an academic article in משפטים (HUJI). Unacquired: סאי-טקס 135/75 (403 + network), 8634/08 (403 + network). The canonical authorities were identified and missed.
- **C.** 9 pairs / 9 span-verified; 5 claims, 5 verified, 0 unsupported; 1 footnote (secondary).
- **D.** corpus 3, web 2, official 1, academic 1; lookups 1; raw_web 3 calls → **0 candidates fetched**; fetches 10, 2 readable.
- **E.** Central covered; sufficiency did not fire despite zero primary authority.
- **F.** 140s, 14 steps, 151k prompt. Reasonable.
- **G.** Acquisition; source quality (secondary-only despite primary reasonably available).

### Q23 — צוואה בעדים חרף פגם — **68/100**
- **A.** Correct on s.25 curing, the post-Amendment-11 "core elements" framework, that a witness's signature is no longer a core element, and the burden on the propounder. Weakness: the crucial requirement that the testator declare the document to be his will is drawn from a district-court digest, and s.20 text was never read.
- **B.** Acquired: חוק הירושה (Wikisource), a district-court digest (law-firm PDF). Unacquired: חוק הירושה ס' 20 and ס' 25 official text (too_short ×3, 404). No Supreme Court authority.
- **C.** 6 pairs / 6 span-verified; 5 claims, 5 verified, 0 unsupported; 2 footnotes. One footnote title is garbled RTL text ("מ 'נ .ב 44175-10-16 ש " עמ") — citation-rendering defect.
- **D.** web 4, corpus 3, official 1; lookups 3; raw_web 1 call → 2 fetched; fetches 12, 4 readable.
- **E.** Central covered; no repair.
- **F.** 182s, 16 steps, 184k prompt.
- **G.** Acquisition (official statute text) + citation rendering.

### Q24 — קיפוח לפי ס' 191 — **62/100**
- **A.** Legitimate expectations, quasi-partnership caution, remedial flexibility, separation-of-forces remedy. But the statutory definition of oppression and the remedies provision itself were never verified, and the answer says so.
- **B.** Acquired: ע"א 8712/13 אדלר נ' לבנת (partially). Unacquired: ע"א 2699/92 בכר (403), 3432/17 and 2786/18 (`judgment_body_form_absent`), חוק החברות ס' 191 (`statute_section_absent_from_body`).
- **C.** 7 pairs / 7 span-verified; 5 claims, 3 verified, **2 unsupported**; 1 footnote. 2 temporal claims unresolved.
- **D.** official 5, corpus 1, web 1; lookups 3; raw_web 3 calls → 4 fetched, 0 rejects; fetches 11, 8 readable.
- **E.** Central not covered; sufficiency fired; repair 1 cycle → `coverage_restored` (partially).
- **F.** 216s (slowest non-stalled run), 18 steps, 272k prompt.
- **G.** Acquisition + statute-section confirmation.

### Q25 — הסדר כובל בעל פה — **85/100**
- **A.** Correct and complete for the question asked: market division falls within the enumerated restraints; "arrangement" covers oral/implied/by-conduct agreements with no formal contract required; conclusive presumption for enumerated restraints means no need to prove actual or potential harm to competition.
- **B.** Acquired: חוק התחרות הכלכלית ס' 2(א) (Wikisource), ע"פ 6339/18 בלווא (law-firm reproduction). Unacquired: 4855/02 (`docket_absent_from_body` — correctly rejected).
- **C.** 4 pairs / 4 span-verified; 3 claims, 3 verified, 0 unsupported; 2 footnotes. One footnote notes the retrieved body had reversed character order — flagged honestly rather than hidden.
- **D.** official 3, web 2, corpus 1; lookups 3; raw_web 1 call → 0 fetched; fetches 3, all readable.
- **E.** Central covered; no repair needed.
- **F.** 165s, 18 steps, 228k prompt, 30 already-read.
- **G.** None dominant.

### Q26 — עסקאות נוגדות במקרקעין — **80/100**
- **A.** Correct statutory rule (first buyer prevails unless second acted in good faith, for value, and registered while in good faith) plus גנז's good-faith duty to record a caution. Defect: the footnote labels the provision "סעיפים 7–8" of the Land Law where the conflicting-transactions rule is s.9.
- **B.** Acquired: חוק המקרקעין (Nevo), ע"א 2643/97 גנז (via afiklaw reproduction). Unacquired: גנז from an official source (403; one reproduction rejected as `docket_mention_not_self_identifying`).
- **C.** 8 pairs / 8 span-verified; 5 claims, 5 verified, 0 unsupported; 2 footnotes.
- **D.** corpus 3, web 3, official 2; lookups 1; raw_web 2 calls → 0 fetched; fetches 4, 3 readable.
- **E.** Central covered; no unresolved authorities; no repair.
- **F.** 161s, 22 steps, 3 chunks, 247k prompt, 52 already-read, 62 compactions.
- **G.** Citation rendering (section mislabel); efficiency.

### Q27 — שיתוף מול לייק בפייסבוק — **88/100** (highest)
- **A.** Applies the statutory definition of publication and then the Supreme Court's functional distinction in רע"א 1239/19 נידילי: a share reproduces and redistributes the content, a like expresses endorsement. Correctly applies it to the added comment and correctly notes classification as "publication" is only the first step before defamation and defences.
- **B.** Acquired: חוק איסור לשון הרע (Nevo), רע"א 1239/19 (law-firm reproduction). No unresolved authorities.
- **C.** 9 pairs / 8 span-verified; 4 claims, 4 verified, 0 unsupported; 2 footnotes.
- **D.** web 7 only; lookups 2; raw_web 3 calls → 0 fetched; fetches 3, 2 readable.
- **E.** Central covered; no repair.
- **F.** 170s, 22 steps, 3 chunks, **286k prompt**, 50 already-read, 60 compactions — high cost for a 2-source answer.
- **G.** Efficiency only.

### Q28 — עובד מול קבלן עצמאי — **78/100**
- **A.** Correct mixed test with integration at its core, the full list of secondary indicia, the principle that contractual labelling does not decide, and a careful application to the facts. Weaker on consequences (retroactive entitlements, the "reverse calculation" line of National Labour Court case law).
- **B.** Acquired: בג"ץ 5168/93 מור (judgments.org.il). No unresolved authorities recorded — but no labour-court authority was retrieved.
- **C.** 8 pairs / 8 span-verified; 4 claims, 4 verified, 0 unsupported; 1 footnote.
- **D.** web 8; lookups 2; raw_web 1 call → 0 fetched; fetches 5, 1 readable.
- **E.** Central covered; no repair.
- **F.** 161s, 11 steps, 93k prompt — one of the cheapest good answers.
- **G.** Scholarship/secondary discovery (thin).

### Q29 — ביטול רישיון עסק ללא שימוע — **15/100** (empty core)
- **A.** No substantive answer. The right to be heard is among the most elementary Israeli administrative doctrines; returning nothing is a severe failure.
- **B.** Unacquired: ברמן 3/58, גינגולד 654/78, באקי 2911/94, 3379/03 (all court.gov.il 403 or network error), plus חוק רישוי עסקים ס' 7ג.
- **C.** 2 pairs / 2 span-verified; 2 claims, 0 verified, **2 unsupported**, **0 footnotes**; 2 temporal claims unresolved.
- **D.** web 8, no official/corpus/academic searches; lookups 3; raw_web **0 calls**; fetches 9, 5 readable — bodies were read but none bound.
- **E.** Central flagged covered (**mis-signal**); sufficiency did not fire; no repair.
- **F.** 194s, 22 steps, 3 chunks, 283k prompt, 48 already-read, 61 compactions — expensive nothing.
- **G.** Acquisition → authority binding → sufficiency/repair failed to catch a total miss.

### Q30 — הליך משמעתי ואוניברסיטה — **62/100**
- **A.** Sound structure: statutory status under חוק זכויות הסטודנט, the need to locate the concrete disciplinary offence, interim-suspension limits (3 weeks, extension by reasoned decision), the right to be heard including immediate argument and re-hearing, and proportionality/less-restrictive means. It also cleanly separates settled law from fact-dependent points, as asked. Weakness: the administrative-law content rests almost entirely on **one university's** disciplinary regulation, with no administrative or constitutional case law and no freedom-of-expression authority.
- **B.** Acquired: חוק זכויות הסטודנט (Knesset PDF), תקנון משמעת אוניברסיטת חיפה. Unacquired: 8077/08 (network error, 403, then `unreadable_encoding`).
- **C.** 10 pairs / 10 span-verified; 6 claims, 6 verified, 0 unsupported; 2 footnotes.
- **D.** web 8; lookups 4; raw_web 0; fetches 8, 4 readable.
- **E.** Central covered; no repair.
- **F.** Wall-clock 1195s because the run **stalled mid-chunk** and required an explicit resume; compute itself was modest (10 steps, 12 calls, 118k prompt). Infrastructure, not research, cost.
- **G.** Infrastructure (stalled self-invoke resume) + authority acquisition; source quality (institutional regulation standing in for case law).

---

## Batch-wide results

| Q | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 |
|---|----|----|----|----|----|----|----|----|----|----|----|----|----|----|----|
| Score | 84 | 70 | 15 | 25 | 82 | 85 | 72 | 68 | 62 | 85 | 80 | 88 | 78 | 15 | 62 |

- **Mean 64.7 · Median 72 · Lowest 15 (Q18, Q29) · Highest 88 (Q27)**
- Bands: ≥90 — 0 · 80–89 — 6 · 70–79 — 3 · 60–69 — 3 · <60 — 3
- **vs Batch 2** (mean 70.6, median 72.5, range 45–90): the median is unchanged and the strong band is comparable, but the mean fell because Batch 3 contains **two total failures (15, 15)** and one near-total (25). Batch 2 had no zero-footnote answers. The distribution is bimodal: when authorities are acquired the answers are good; when acquisition fails the system now produces nothing rather than a weak answer.

## Raw web search impact

- **Total calls: 22**, across 11 questions (Q16 2, Q18 1, Q20 3, Q21 2, Q22 3, Q23 1, Q24 3, Q25 1, Q26 2, Q27 3, Q28 1). Unused in Q17, Q19, Q29, Q30.
- **Candidates actually fetched from raw results: 14** (Q16 3, Q18 1, Q20 3, Q21 1, Q23 2, Q24 4). In Q22, Q25, Q26, Q27, Q28 raw search returned URLs that were **never fetched** — 10 calls with zero downstream effect.
- **Authority-identity accepts recorded: 0. Identity rejects: 3** (Q16 2, Q18 1). **Unsafe-URL blocks: 0.**
- **Genuinely useful discovery not surfaced by other lanes: Q16** — the Adalah PDF of בג"ץ 7052/03 and the 1715/97 download, both of which became footnotes; **Q24** — the court.gov.il body of ע"א 8712/13; **Q20** — three fetched candidates feeding the restored coverage.
- **Contributed verified evidence: Q16, Q20, Q24** (3/15 questions).
- **False-positive binds: none observed.** The `known_commentary_header_false_bind` case did not recur in this batch.
- **Incorrect rejections of useful candidates: yes, and this is the significant finding.** `judgment_body_form_absent` rejected bodies that are in fact genuine judgments — including the **official court.gov.il download of בג"ץ 1715/97** (Q16), 7052/03 (Q16), 4705/22 (Q18), 7052/18 (Q20), 3432/17 and 2786/18 (Q24). Q16 still cited two of them, which means the answer rests on sources the identity gate had refused. The self-identity fix has traded false positives for a measurable false-negative rate on genuine judgments, including official ones.

**Verdict on raw_web_search:** measurable but modest net benefit — useful in 3 of 15 questions, inert in 5, and its downstream value is now capped by the identity gate rather than by discovery.

## Consolidated unresolved-authority list

| Question | Authority | Terminal reason |
|---|---|---|
| Q16 | בג"ץ 6821/93 בנק המזרחי | http_403 |
| Q16 | חוק-יסוד: כבוד האדם וחירותו ס' 8 | statute_title_absent_from_body |
| Q17 | ע"א 915/91 | docket_mention_not_self_identifying → network error |
| Q17 | ע"א 243/83 | http_403 |
| Q18 | חוק החוזים (חלק כללי) ס' 13 | too_short_for_a_document ×2, statute_title_absent |
| Q18 | ע"א 4705/22 | judgment_body_form_absent |
| Q18 | ע"א 630/78 | network error + http_403 |
| Q19 | חוק החברות ס' 252 | http_403 |
| Q20 | 7052/18 · 2910/94 · חסד"פ ס' 149 | form_absent · 403 · too_short/403 |
| Q21 | 5002/09 · 4988/08 · 1062/21 | court.gov.il network errors |
| Q22 | סאי-טקס 135/75 · 8634/08 | http_403 + network errors |
| Q23 | חוק הירושה ס' 20, ס' 25 | too_short ×3, http_404 |
| Q24 | ע"א 2699/92 בכר · 3432/17 · 2786/18 · חוק החברות ס' 191 | 403 · form_absent ×2 · section_absent |
| Q26 | ע"א 2643/97 גנז (official) | docket_mention_not_self_identifying → 403 |
| Q29 | 3/58 ברמן · 654/78 גינגולד · 2911/94 · 3379/03 | network errors + 403 |
| Q30 | 8077/08 | network error → 403 → unreadable_encoding |

**Frequency: 14 of 15 questions had at least one unresolved named authority** (only Q27 and Q28 were clean; Q26 resolved via a reproduction). This is the same dominant bottleneck as Batch 2 and it has **not improved**. Breakdown of terminal reasons: http_403 ~16, court.gov.il network/TLS errors ~11, `judgment_body_form_absent` 6, statute text `too_short_for_a_document` 7, `docket_mention_not_self_identifying` 3.

Two distinct sub-problems: (i) court.gov.il is largely unreachable (403 / connection errors) — infrastructure; (ii) **official statute text repeatedly fails as `too_short_for_a_document`** — Contracts Law s.13, Succession Law s.20/25, CPL s.149, Companies Law s.252. Elementary statutory provisions failing to load is what turned Q18 and Q29 into empty answers.

## Source quality

- **Primary authority, useful:** Q16, Q20, Q21, Q24, Q25, Q26, Q27, Q28, Q30 (9)
- **Primary + academic/secondary:** Q16, Q21, Q23, Q25, Q26, Q27 (6)
- **Mainly secondary despite primary reasonably available:** Q17 (law-firm reproduction), Q22 (academic article only), Q23 (district digest for a core proposition), Q30 (one university's regulation) (4)
- **Weak/unreliable support:** Q18, Q29 (no support at all), Q19 (single tangential judgment) (3)

Law-firm and portal reproductions (toledano.co.il, afiklaw, kanirlaw, judgments.org.il) carried the primary authority in 6 questions. They are functioning as the de-facto access layer because the official source is unreachable.

## Efficiency

- **>250k prompt tokens: 5** — Q19 309k, Q27 286k, Q29 283k, Q24 272k, Q20 258k.
- **>200k: 9** — adds Q21 268k, Q26 247k, Q25 228k, Q17 210k.
- **Cheapest: Q18 58k, Q28 93k, Q16 100k, Q30 118k.**
- Batch 2 pathological set was Q6 342k, Q12 332k, Q8 272k, Q11 271k, Q14 251k. Batch 3's peak (309k) is lower, but the *number* of runs above 250k is the same (5) and the median prompt cost is higher. **Raw web search did not reduce research loops; it did not clearly worsen them either.**
- Already-read/no-op churn is heavy where cost is heavy: Q19 109, Q21 91, Q17 54, Q26 52, Q27 50, Q29 48. Q19 and Q29 are the clearest cases of "more searching not improving the answer" — 309k and 283k tokens for 1 and 0 footnotes respectively.
- Compaction counts track the same runs (Q19 117, Q21 98, Q17 65).
- One infrastructure event: Q30 stalled mid-chunk for ~18 minutes with a live `agent_state` and no self-resume; it completed on an explicit resume call.

## Failure taxonomy — dominant layers across the batch

1. **Acquisition / body retrieval (11 questions)** — court.gov.il 403s and connection errors; official statute text returning stubs.
2. **Authority identity binding (6 questions)** — `judgment_body_form_absent` on genuine judgments, including official downloads. New since the self-identity fix.
3. **Sufficiency / repair (4 questions)** — Q18 and Q29 reported `central_issue_covered: true` while delivering nothing; Q19's repair ran and failed.
4. **Efficiency (5 questions)** — >250k prompt tokens with low yield.
5. **Citation rendering (2 questions)** — Q26 section mislabel; Q23 garbled RTL footnote title.
6. **Infrastructure (1)** — Q30 stalled resume.

Not dominant anywhere: intent/mode, planning, drafting, temporal validity, evidence selection, verification (span verification was near-perfect where evidence existed: 96 of 101 pairs span-verified).

---

## Verdict

**BATCH 3 MIXED — REVIEW BEFORE LAUNCH**

When authorities are acquired, output quality is strong and well-grounded (six answers in the 80s, essentially no unsupported claims, near-perfect span verification). But two questions on elementary doctrine returned no answer at all, a third returned almost none, 14 of 15 questions lost at least one named authority, official statute text repeatedly failed to load, the self-identity gate is now rejecting genuine official judgment bodies, and the sufficiency signal reported full coverage on two empty answers. These are recurring weaknesses in the research and control layers, not isolated bad results.

No code was changed during or after this evaluation.
