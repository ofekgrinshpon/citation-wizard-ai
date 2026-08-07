# Golden Audit — Manual Read-Through Review (G01–G20)

Read-only review. No code changes. Based on `reports/golden-audit-final/REPORT.md` plus every
`reports/golden-audit-post-specific-case/G*.json` (telemetry **and** full answer bodies).

---

## 0. Corrections to the audit headline (found on read-through)

The headline table in `REPORT.md` does not match the raw run files in four places. These matter
because they change the grade distribution:

| Item | REPORT.md says | Raw JSON says |
|---|---|---|
| G07 | "Good (after Track 1)" | `branch: insufficient_sources_limitation`, `drafted: false`, 0 used sources, 30 admitted |
| G12 | "not run – reserved" | **Was run.** `statute_section_quote_refusal`, refused, 117,896 ms |
| G08 | ~210k ms, 26 admitted | 149,602 ms, 26 admitted |
| G02 | "Good, official archive" | Correct — but pool was only **3 admitted sources**; not a research pack, a lucky single hit |

So the executed set is **20 runs, not 19**, and the refusal count is **7, not 5**.
`REPORT.md` should be treated as stale on those rows.

---

## 1. Full review table

Legend for col. 7: PA = primary authority. "Leads" = primary source is footnote 1 / carries the
operative proposition.

### G01 — קעדאן (בג"ץ 6698/95)
| # | |
|---|---|
| 1 Query | What Ka'adan held on land allocation by national affiliation |
| 2 Mode/shape | specific_case / case_holding |
| 3 Branch | none |
| 4 | Drafted |
| 5 Audit grade | Good |
| 6 Agree? | **Partly — downgrade to Acceptable** |
| 7 Source pack | PA present ✅ (official judgment full_text); PA leads ✅ (fn1); commentary share 20/30 = 67%; metadata-only holdings ⚠️ (2 of 4 used are metadata-only); commentary-carried propositions ⚠️ (¶4 on post-judgment administrative practice rests on a generic gov.il doc) |
| 8 Answer | Legally correct ✅ core holding right; research-grade ⚠️ — no reference to the actual reasoning structure (Barak's equality-in-allocation via the Jewish Agency intermediary), no mention that relief was narrow and prospective; **language defects**: "הוכרזה כמא גררת איסור" is garbled Hebrew; not thin; not soup (4 used); no over-refusal; mild overclaim in ¶4 |
| 9 Bottleneck | drafter quality (fluency + holding depth) |
| 10 Action | **include in Track 2 adjacent — drafter-quality track** |

### G02 — בנק המזרחי (ע"א 6821/93)
| 5 Audit | Good | | |
|---|---|---|---|

- Mode/shape: specific_case / case_holding. Branch: none. Drafted.
- Agree? **Partly — Acceptable, not Good.**
- Source pack: PA present ✅ and leads ✅ (official archive file, full_text). But **pool = 3 admitted**.
  Commentary share 1/3. No metadata-only holdings. One proposition (interpretive-conformity) is
  explicitly commentary-carried and *correctly flagged as such* in the body — good behaviour.
- Answer: legally correct ✅ (constitutional status of Basic Laws, judicial review power).
  Research-grade ❌ — Mizrahi's actual analytical payload (the three-stage limitation-clause test,
  Shamgar/Barak/Cheshin split, the fact the statute was *upheld*) is absent. Too thin ✅.
  No soup, no over-refusal, no overclaim.
- Bottleneck: **discovery** (a 3-source pool for the single most-cited judgment in Israeli law is a
  retrieval failure that the fast lane masked by succeeding).
- Action: **include in Track 2** — treat pool size as a quality signal, not just sufficiency.

### G03 — fake docket ע"א 99887-04-22
Mode specific_case/case_holding · branch `docket_limitation` · refused · audit: Refusal (correct) ·
**Agree ✅.** Source pack irrelevant (0 used). Answer is exemplary: explicit refusal, no analogising,
offers file upload. Bottleneck: none. **Action: no action.**

### G04 — fake docket ת"א 1234/09
Identical to G03. **Agree ✅. No action.** (Note: 24 sources retrieved and discarded — 202s spent to
reach a deterministic refusal. Runtime waste, not correctness.)

### G05 — הלכת השיתוף
Mode case_law_synthesis/analysis · no branch · drafted · audit: Good.
- Agree? **No — downgrade to Limited/thin.**
- Source pack: PA present ✅, PA leads ✅ (ע"א 52/80 שחר, בע"מ 4623/04 full_text). Commentary 16/25 = 64%.
  Metadata-only holdings ⚠️ — אבו רומי and בע"מ 5620/24 are cited metadata-only.
- Answer: not legally wrong, but **materially incomplete**: it builds the whole doctrine on a single
  case (בע"מ 4623/04) and explicitly says so. הלכת השיתוף without בבלי, without the 1973 cut-off
  logic, without שיתוף ספציפי, is not a usable research answer. Too thin ✅. Over-refusal in effect
  (self-limiting language) ⚠️.
- Bottleneck: **acquisition** (leading judgments existed as metadata only).
- Action: **include in Track 2.**

### G06 — הרמת מסך (פסיקה)
Mode case_law_synthesis/analysis · drafted · audit: Good.
- Agree? **No — downgrade to Limited.**
- Source pack: PA present but **PA does not lead** — the leading footnote is a district-level
  ת"א 2020-98 mirror; the two statutes (חוק החברות §6) appear as background at fn4/fn5, metadata-only.
  10 used of 24 admitted. 5 of 10 used are metadata-only legislation duplicates
  (חוק החברות twice, פקודת החברות three times) — **duplicate-source padding**.
- Answer: **not research-grade**. It never states the §6 test (הקניית חובות בשל שימוש לרעה, קיפוח נושים,
  נטילת סיכון בלתי סביר), never mentions the 2005 amendment that narrowed §6, and instead
  generalises from two irrelevant procedural rulings. Borderline **overclaiming** — it presents
  incidental procedural rulings as if they express the veil-piercing standard.
- Bottleneck: **statute text acquisition + citation pruning + source hierarchy.**
- Action: **include in Track 2 (high priority).**

### G07 — מבחן ההשתלבות (פסיקה)
Mode case_law_synthesis/analysis · branch `insufficient_sources_limitation` · **refused** · 30 admitted,
9 binding_case_law, 9 scholarship.
- Audit grade "Good" is **wrong** (see §0). Correct grade: **Over-refusal.**
- Agree? **No.** This is the clearest quality failure in the set. מבחן ההשתלבות is settled,
  heavily-documented doctrine; the pool contained דמ"ר 26126-06-11 and a comparative survey and the
  system still refused. 21 of 30 sources were metadata-only — the pool was wide but hollow.
- Answer: over-refusal ✅. Not thin/soup/overclaiming — it simply declines.
- Bottleneck: **sufficiency/topicality** (primary) + **acquisition** (secondary: 21/30 metadata-only).
- Action: **include in Track 2 — this is the canonical Track 2 case.**

### G08 — מבחני המידתיות
Mode case_law_synthesis/analysis · `insufficient_sources_limitation` · refused · 26 admitted,
10 binding_case_law, 10 scholarship, 7 verifier-`direct`.
- Audit: Limited. Agree? **No — this is over-refusal**, same class as G07.
- Seven sources were verified as *directly* supporting and the system still refused. That is a
  sufficiency-gate defect, not a source defect.
- Bottleneck: **sufficiency/topicality** (Hebrew stemming + scholarship role labelling).
- Action: **include in Track 2 — highest priority.**

### G09 — סעיף 12 לחוק החוזים
Mode statute_section_definition/definition · drafted · audit: Good. **Agree ✅ — best answer in the set.**
- Source pack: PA present ✅ and leads ✅; **verbatim statutory text quoted correctly**; commentary 15/23
  but used sparingly (5 used). Metadata-only holdings ⚠️ (3 of 5 used are metadata-only commentary).
- Answer: legally correct ✅, research-grade ✅ (distinguishes statutory text from interpretive gloss,
  covers reliance vs. expectation damages, causation, disclosure limits). Defect: two source titles are
  corrupt (`חוק החתים` for `חוק החוזים`) and the body contains a Spanish token (`צד שה inició`).
- Bottleneck: drafter quality (text hygiene) only.
- Action: **monitor** + fold title/text hygiene into the drafter track.

### G10 — צוואות הדדיות §8א
Mode doctrine_explanation/analysis · drafted · audit: Good. **Agree ✅ (strong Acceptable/Good).**
- Source pack: PA present ✅ and leads ✅ (חוק הירושה fn1). Commentary 15/22. Three used caselaw items are
  psakdin-style secondary with metadata-only or excerpt usability ⚠️ — **commentary-carried propositions**
  on the post-death revocation rules.
- Answer: substantively accurate on the §8א mechanism (written notice inter vivos, restitution/
  disclaimer conditions post-death). Not thin, not soup (6 used). Mild overclaim: describes case-law
  consequences without a citable judgment body.
- Bottleneck: acquisition (judgment bodies), statute text acquisition (§8א text not quoted verbatim).
- Action: **monitor.**

### G11 — סעיף 6 לחוק החברות
statute_section_definition/definition · `statute_section_limitation` · refused · 21 admitted,
11 primary_statute.
- Audit: Limited (safe). **Agree ✅ that it is safe; disagree that it is acceptable product behaviour.**
  Eleven primary-statute sources including the official gov.il consolidated Companies Law PDF, and the
  system still cannot bind §6. This is an **over-refusal caused by an acquisition gap**, not a genuine
  unknown.
- Bottleneck: **statute text acquisition** (no section-level extraction stage).
- Action: **different future track — statute-section acquisition.** Ranked #3 below.

### G12 — נוסח סעיף 8 לחוק יסוד: כבוד האדם וחירותו
canonical_quote/quote · `statute_section_quote_refusal` · refused · 14 admitted, 12 primary_statute.
- Not graded in REPORT.md at all. My grade: **Over-refusal, and the worst product-facing one.**
  The limitation clause is a 40-word canonical text; refusing to quote it while holding 12
  primary-statute sources will read to a lawyer as the product being broken.
- Bottleneck: **statute text acquisition.**
- Action: **different future track — statute-section acquisition (raises its priority).**

### G13 — בטלות יחסית
doctrine_explanation/definition · drafted · audit: Good.
- Agree? **Partly — Acceptable.**
- Source pack: **PA absent in the used set** — all 9 used sources are `secondary_commentary`;
  the only caselaw used is רע"א 7598/20, an unrelated procedural החלטה. 4 of 9 are metadata-only.
  **Every proposition is commentary-carried.** This is the cleanest example of hierarchy failure.
- Answer: doctrinally correct and well-organised (this is why it read as "Good"), but it is an
  encyclopaedia entry, not legal research: no כנען, no זנגי, no בג"ץ 2758/01. Research-grade ❌.
- Bottleneck: **source hierarchy + discovery** (named-doctrine → leading-case mapping).
- Action: **include in Track 2.**

### G14 — עקרון תום הלב
doctrine_explanation/analysis · drafted · audit: Acceptable (source-soup). **Agree ✅ — if anything Limited.**
- Source pack: PA nominally present but **does not lead** — fn1 is a generic gov.il doc titled
  "מסמך מאתר אתר ממשלתי". 14 used of 18 admitted = **78% citation rate; textbook soup**. 6 of 14 used
  are metadata-only. Includes a labour-law article ("מיהו עובד: מבחני הסף") and a domestic-workers
  article as authority for a good-faith survey — **topical drift**.
- Answer: generic, hedged, no §39 / §61(ב) architecture, no רוקר נ' סלומון, no שירותי תחבורה. Soup ✅,
  thin-in-substance ✅ despite 3,062 chars.
- Bottleneck: **citation pruning + source hierarchy.**
- Action: **include in Track 2 (pruning sub-track).**

### G15 — שיתוף ספציפי
doctrine_explanation/definition · drafted · audit: Good.
- Agree? **No — downgrade to Acceptable-minus.**
- Source pack: **all 7 used sources are metadata-only.** PA nominally present (חוק הגנת הדייר, דנג"ץ 8537/18)
  but the leading footnote is חוק הגנת הדייר — **the wrong statute** for specific-sharing in a
  matrimonial home. Two used "judgments" are psakdin listing pages. Commentary-carried: all of it.
- Answer: opens by denying the doctrine exists under that name ("לא נמצאה הלכה מוכרת בשם…") — factually
  wrong; שיתוף ספציפי is settled (אבו רומי, בע"מ 1398/11 אלמונית, בע"מ 7181/12). The substantive
  criteria it then lists are broadly right, so this is **overclaiming from metadata plus an incorrect
  framing statement**. That combination is the most dangerous pattern in the whole audit.
- Bottleneck: **acquisition + sufficiency/topicality.**
- Action: **include in Track 2**, and flag the "doctrine does not exist" framing as an **urgent
  drafter guardrail** (never assert non-existence of a doctrine from retrieval failure).

### G16 — השתק הבטחה
doctrine_explanation/definition · drafted · audit: Good. **Agree ✅ (Good).**
- Source pack: PA present ✅ and leads ✅ (בג"ץ 5517/17, official, full_text). Only 5 used of 21 —
  **best pruning behaviour in the set**. Commentary 15/21 admitted but only 4 used. 3 of 5 used are
  metadata-only ⚠️.
- Answer: correct four-element test, correct distinction from legitimate expectation and
  promissory estoppel, correct ultra-vires limitation. Honest closing caveat. Not thin, not soup.
- Bottleneck: none material.
- Action: **no action** — use as the reference target for the pruning track.

### G17 — סקירת פסיקה: מבחן ההשתלבות
academic_survey → doctrine_explanation / analysis · drafted · audit: Acceptable (12 sources).
- Agree? **Partly — Limited.** Note the mode mismatch: the same question refused as G07 under
  `case_law_synthesis` and drafted here. **Mode assignment, not evidence, decided the outcome** — that
  is a consistency bug users will hit.
- Source pack: 12 used of 26; **8 of 12 are legislation/gov docs, metadata-only**, including
  "התקשרות קופות החולים עם רופאים עצמאים" and "כלכלת הפלטפורמה" — off-topic padding. No בג"ץ/בי"ד ארצי
  authority for מבחן ההשתלבות (no סרוסי, no בירגר). PA does not lead in substance.
- Answer: the definition of the integration test is right, but a "סקירת פסיקה" with zero named
  labour-court judgments is not a case-law survey. Soup ✅.
- Bottleneck: **discovery** (labour-court corpus) + **citation pruning**.
- Action: **include in Track 2**; log the G07/G17 mode inconsistency as a separate defect.

### G18 — סקירה: הרמת מסך בחברות משפחתיות
academic_survey → doctrine_explanation / analysis · `insufficient_sources_limitation` · refused ·
30 admitted, 15 binding_case_law, 0 verifier-`direct`.
- Audit: Limited. **Agree ✅ that refusal was defensible here** — unlike G07/G08, zero sources were
  verified `direct`, and "family companies" narrows the topic beyond what the pool covered.
- But the refusal text lists חוק החברות and a bill as "what was found", which reads as a system failure
  rather than a scoped answer. Partial over-refusal: it could have answered generic §6 and scoped out
  the family-company overlay.
- Bottleneck: **sufficiency/topicality** (sub-topic narrowing).
- Action: **include in Track 2 (lower priority than G07/G08).**

### G19 — סקירה: התפתחות המידתיות
doctrine_explanation/analysis · drafted · audit: Good. **Agree ✅ (Good/Acceptable).**
- Source pack: PA present ✅ and leads ✅ (בג"ץ 1877/14, substantive_excerpt). 10 used of 23; commentary
  15/23 admitted and 8 of 10 used are scholarship — **heavy but appropriate for a survey**. Only 2
  metadata-only in the used set. 8 verifier-`direct`, the best in the audit.
- Answer: structurally sound developmental survey. Weakness: no בית הפרטי/מזרחי→גנימאת→אדם טבע ודין
  spine, no explicit three-prong statement. Not soup for this genre.
- Bottleneck: drafter quality (doctrinal spine).
- Action: **monitor.**
- Note the contrast with G08: **the same subject matter drafted well as a survey and refused as a
  synthesis.** Second instance of the mode-inconsistency defect.

### G20 — סקירת פסיקה: תום לב במו"מ
doctrine_explanation/analysis · drafted · 369,045 ms (slowest run) · audit: Good.
- Agree? **Partly — Acceptable.**
- Source pack: strongest raw pack in the audit — 5 judgment documents, **3 with holding text**,
  ע"א 6952/15 official full_text leading. But 4 of 8 used are metadata-only commentary, and two used
  "judgments" are unnamed PDFs (`4189b.pdf`, `4302b.pdf`) — **unrecovered titles reaching the user**.
- Answer: correct on §12 content, disclosure, reliance damages, and the freedom-of-contract boundary.
  Missing קל בניין (expectation damages) — a serious omission for this exact question. Closing caveat
  "טקסט ההלכה המלא לא היה בפניי" contradicts the fact that three holding texts were acquired —
  **an unnecessary self-deprecating caveat that damages trust**.
- Bottleneck: **runtime/infra** (369s) + title recovery + drafter quality.
- Action: **monitor**; add unnamed-PDF title recovery to the hygiene track.

---

## A. Revised grade distribution after manual read

20 executed runs (G12 included).

| Grade | Audit (as written) | After manual read |
|---|---|---|
| Good | 12 | **3** (G09, G16, G19) |
| Acceptable | 2 | **6** (G01, G02, G10, G13, G15, G20) |
| Limited / thin but safe | 5 | **4** (G05, G06, G14, G17) |
| Correct refusal | (in Limited) | **3** (G03, G04, G18) |
| **Over-refusal (defect)** | 0 | **4** (G07, G08, G11, G12) |
| Technical failure | 0 | **0** ✅ |
| Unsafe answer | 0 | **1 borderline** (G15 framing) |

Liveness verdict from the audit holds completely: zero stale rows, zero CPU kills, zero stubs, zero
verifier crashes. **The infrastructure track is done. The quality track has barely started.**

The headline "12 Good" is an artifact of grading on branch + telemetry rather than on the answer body.
Once you read the bodies, the dominant pattern is: *the system reliably produces a well-formatted,
non-hallucinated, doctrinally-plausible essay that a working lawyer cannot cite.*

## B. Top 5 product risks

1. **Metadata-only sources are being used as authority.** G15 (7/7), G13 (4/9), G14 (6/14), G20 (4/8).
   The system footnotes documents it never read. Nothing is fabricated, but the footnote implies a
   verification that did not occur. This is the single biggest liability risk.
2. **Over-refusal on settled law** (G07, G08, G11, G12). Four of twenty queries refuse questions any
   junior associate answers from memory. G12 — refusing to quote the limitation clause — is the kind
   of result that ends a trial account in one session.
3. **Assertion of non-existence from retrieval failure** (G15: "לא נמצאה הלכה מוכרת בשם…"). Confidently
   wrong negative claims are worse than refusals and worse than hedged answers.
4. **Mode assignment determines outcome, not evidence.** G07 refused / G17 drafted (same doctrine);
   G08 refused / G19 drafted (same doctrine). Users will phrase-shop and lose trust when they notice.
5. **Landmark judgments are absent from the used sets.** No בבלי in G05, no §6 test in G06, no כנען in
   G13, no רוקר in G14, no קל בניין in G20. The answers are structurally right and authoritatively
   empty — which is exactly what a legal researcher is paying to avoid.

Runtime (avg ~230s, tail 369s) is a real UX cost but ranks below all five.

## C. Top 3 implementation tracks, ranked by product impact

**1. Track 2 as scoped — sufficiency / topicality / role labelling.**
Directly fixes G07, G08, partially G18; removes risk #2 and #4. Body-text topical matching instead of
stem overlap, correct scholarship role labelling, and — new from this review — make sufficiency
mode-symmetric so the same doctrine cannot pass as a survey and fail as a synthesis. Largest
grade movement per unit of work: 3–4 runs move from over-refusal to answered.

**2. Citation discipline: usability gate + primary-first pruning + no-negative-existence guardrail.**
Three coupled rules: (a) a metadata-only source may provide context but may never carry a proposition
or occupy footnote 1; (b) hard used-source ceiling of ~8 with primary-first selection (G16 is the
reference behaviour); (c) the drafter may never assert a doctrine does not exist because retrieval
missed it. Fixes risks #1, #3, #5-in-part, and cleans G13/G14/G15/G17/G20. Highest trust impact.

**3. Statute-section text acquisition.**
A section-level extraction stage analogous to judgment acquisition. Converts G11 and G12 from refusal
to answer, improves G06 and G10, and eliminates the most embarrassing single failure mode. Smaller
scope than 1 and 2 but the highest embarrassment-per-bug ratio.

*(Runner-up, not top-3: named-doctrine → leading-case mapping. It would fix risk #5 properly, but it
needs a curated anchor set and should follow track 1.)*

## D. What should NOT be fixed yet

- **Runtime.** 230s average is survivable for a research product and every latency fix risks
  re-opening the CPU/liveness work that is now stable. Do not touch acquisition budgets.
- **The speculative binary-extraction skip path.** Still unobserved in production telemetry. Leave it
  under monitor; do not tune the 900 KB threshold on zero data.
- **Drafter prose quality and Hebrew text corruption** (G01 "מא גררת", G09 "שה inició", corrupt source
  titles). Real but cosmetic; fixing prose before fixing which sources reach the drafter optimises the
  wrong layer.
- **Refusal copy for genuinely-unanswerable queries.** G03/G04 are correct and well-worded. Leave them.
- **Discovery breadth.** G02 answering well from a 3-source pool and G07 refusing on a 30-source pool
  shows the constraint is selection, not volume. Broadening retrieval now would worsen soup.
- **Academic-survey mode as a separate mode.** It currently collapses into `doctrine_explanation`;
  splitting it before sufficiency is fixed just doubles the surface area.

## E. Beta-readiness for a small closed group

**Yes, with conditions — a supervised design-partner beta, not an open beta.**

What justifies going: zero technical failures across 20 sequential runs, zero fabricated holdings,
correct refusals on both fake dockets, correct docket-limitation behaviour, and honest in-body caveats
whenever the system was working from partial text. On the dimension that actually matters for legal
software — *does it invent law?* — it passed cleanly. That is the hard part and it is done.

What must be true before you send it:

1. Ship guardrail (c) from track 2 first — **never assert a doctrine does not exist**. G15 is the one
   result in this audit that could actively mislead a lawyer. It is a small prompt/branch fix.
2. Frame the product to testers as a **research starting point that surfaces and verifies sources**,
   not as an answer engine. Every answer already carries honest caveats; the positioning should match.
3. Tell testers explicitly that statute-section quotation is a known gap (G11/G12) so refusals read as
   a known limitation rather than as breakage.
4. Cap the group at people who will read footnotes critically and report back — the metadata-only
   footnote issue is invisible to a casual user and exactly what you need reported.
5. Instrument the beta for the two signals this audit could not produce: how often users find the
   cited sources actually support the proposition, and how often they hit an over-refusal.

Not ready for: unsupervised use, anything that gets pasted into a filing, or any user who will treat a
footnote as a verified citation.

Track 2 not started.
