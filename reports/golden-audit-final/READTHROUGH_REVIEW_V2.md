# Golden Audit — Full Read-Through Review (v2)

Read-only. Sources: `reports/golden-audit-final/REPORT.md`, raw per-query JSON in
`reports/golden-audit-post-specific-case/G*.json` (answer bodies + source packs),
`reports/negative-existence-guardrail/REPORT.md` (regression note only).

Track `negative_existence_guard_v1` — **closed as stable-initial / monitor**. Regression note:
7/7 fixtures terminal, 0 forbidden absolute non-existence phrases, source-scoped limitations,
P02 deterministic docket refusal unchanged, R02 drafts from exact Bank Mizrahi body, B8 canonical
quote byte-identical, no CPU kills / stale rows / stubs / verifier failures. The G15 defect noted
below (opening non-existence claim) is **fixed post-audit**; it is scored here against the audit
snapshot and flagged as "fixed by guard".

Note on run count: REPORT.md says "19 executed, G12 reserved". That is wrong — **G12 was executed**
(`a6dcc7c5…`, canonical_quote, refusal). 20 rows exist. This review covers all 20 and reports both
denominators.

---

## Per-run review

Legend for compact columns: **PA-lead** = primary authority leads the citation set ·
**MD-hold** = metadata-only source carries a holding · **Comm** = commentary carries a legal
proposition · **Soup** = source-soup · **OverRef** = over-refusal · **OverClaim** = overclaiming.

### G01 — קעדאן, בג"ץ 6698/95
1. Query: what Ka'adan held on land allocation by national affiliation.
2. specific_case / case_holding. 3. no branch. 4. drafted. 5. Good. 6. **Downgrade → Acceptable.**
7. Source pack: 30 admitted, 1 judgment with holding text, 20 secondary. 8. PA-lead: **yes** (fn1 is
the official judgment file). 9. MD-hold: **yes** (fns 3–4 are metadata-only, incl. "מסמך מאתר
ממשלתי"). 10. Comm: partial (aftermath/policy claims). 11. Soup: no (4 used). 12. OverRef: no.
13. OverClaim: mild — the holding is stated correctly but the reasoning is generic; no quoted ratio,
and a garbled clause ("מא גררת איסור"). 14. Bottleneck: holding text present but not quoted; filler
citations. 15. Action: require a verbatim ratio span from the judgment body for case_holding, and
bar metadata-only sources from footnote slots in this shape.

### G02 — בנק המזרחי, ע"א 6821/93
1. Constitutional review authority. 2. specific_case / case_holding. 3. none. 4. drafted.
5. Good. 6. **Downgrade → Acceptable (fragile).** 7. Pack: **3 sources only**, 0 judgment docs with
holding text. 8. PA-lead: yes (official file). 9. MD-hold: no. 10. Comm: **yes** — the interpretive
standard is carried by a journal article, correctly hedged. 11. Soup: no. 12. OverRef: no.
13. OverClaim: no; hedging is honest. 14. Bottleneck: 3-source pack for the most-cited judgment in
Israeli law; Shamgar/Barak reasoning absent. 15. Action: landmark-judgment coverage check — a
case_holding answer with <5 admitted sources should widen retrieval before drafting.

### G03 — ע"א 99887-04-22 (fake docket)
2. specific_case / case_holding. 3. docket_limitation. 4. refused. 5. Refusal (correct).
6. **Stands.** 7. Pack 25, irrelevant by design. 8–11. n/a. 12. OverRef: no — correct.
13. OverClaim: no. 14. None. 15. Keep as control.

### G04 — ת"א 1234/09 (fake docket)
Identical profile to G03. Grade **stands** (correct refusal). Upload invitation is good UX.

### G05 — הלכת השיתוף
2. case_law_synthesis / analysis. 3. none. 4. drafted. 5. Good. 6. **Downgrade → Acceptable.**
7. Pack 25, 4 judgment docs but only 1 with holding text. 8. PA-lead: yes. 9. MD-hold: **yes**
(אבו רומי and בע"מ 5620/24 cited metadata-only). 10. Comm: partial. 11. Soup: no (6).
12. OverRef: no. 13. OverClaim: **yes, structurally** — the answer says the usable line reduces to a
single judgment, yet still narrates how that test was applied to facts it never read.
14. Bottleneck: holding text acquisition for the canonical שיתוף line (בבלי, אבו רומי).
15. Action: when only one judgment body is readable, restrict the answer to that body and label the
rest as references.

### G06 — הרמת מסך (פסיקה)
2. case_law_synthesis / analysis. 3. none. 4. drafted. 5. Good. 6. **Downgrade → Limited-quality.**
7. Pack 24, 0 judgments with holding text. 8. PA-lead: nominally (5 legislation entries)
but they are **all metadata-only duplicates** of חוק החברות/פקודת החברות. 9. MD-hold: **yes**.
10. Comm: **yes** — the "test" is inferred from two peripheral judgments (רע"א 7614/21 evidentiary,
ע"א 5028/22 asset-hiding). 11. Soup: **yes** (10 used, 5 near-duplicates). 12. OverRef: no.
13. OverClaim: **yes** — presents a procedural/evidentiary case as the leading authority on piercing
while §6 and the אפרוחי הצפון line are absent. 14. Bottleneck: no statute-section body, no landmark
retrieval; duplicate legislation entries inflate the "primary" count. 15. Action: dedupe legislation
entries; require §6 body before answering piercing; cap used sources.

### G07 — מבחן ההשתלבות (פסיקה)
2. case_law_synthesis / analysis. 3. insufficient_sources_limitation. 4. refused. 5. Limited.
6. **Downgrade → Over-refusal (fail).** 7. Pack 30, 11 official_primary, 9 binding_case_law,
1 judgment with holding text, but **21/30 metadata-only**. 8–11. n/a (nothing used). 12. OverRef:
**yes** — this is settled law (דב"ע נג/3-30 חסון and the מבחן המעורב), and G17 answered the *same*
doctrine at length. 13. OverClaim: no. 14. Bottleneck: sufficiency profile keys on judgment bodies
+ weak Hebrew stemming; scholarship mislabeled. 15. Action: Track 2 — body-text topical matching and
role labeling. Also: mode should not decide answerability (see G17).

### G08 — מבחני המידתיות (פסיקה)
2. case_law_synthesis / analysis. 3. insufficient_sources_limitation. 4. refused. 5. Limited.
6. **Downgrade → Over-refusal (fail).** 7. Pack 26, 7 verifier-direct, 8 full_text, 10 binding
case law. 12. OverRef: **yes and worse than G07** — 7 direct-support sources were on the table, and
G19 answered the same doctrine with a three-prong exposition. 14. Bottleneck: same sufficiency gate.
15. Action: Track 2, highest priority; a pool with ≥3 direct-support full-text sources must not
refuse.

### G09 — סעיף 12 לחוק החוזים
2. statute_section_definition / definition. 3. none. 4. drafted. 5. Good. 6. **Stands (Good).**
7. Pack 23, statute mirrors present. 8. PA-lead: yes. 9. MD-hold: yes but benign (the statute fn is
metadata-only while the text is quoted verbatim — provenance gap, not a fabrication: quote is
correct). 10. Comm: yes, correctly attributed to literature. 11. Soup: no (5). 12. OverRef: no.
13. OverClaim: no. 14. Bottleneck: quoted statutory text is not bound to a verified body (contrast
G11/G12 which refused for exactly that reason — **inconsistent policy**). 15. Action: statute-text
acquisition stage; make quote-provenance uniform across G09/G11/G12.

### G10 — צוואות הדדיות, §8א לחוק הירושה
2. doctrine_explanation / analysis. 3. none. 4. drafted. 5. Good. 6. **Stands (Good).**
7. Pack 22, 6 full_text. 8. PA-lead: yes (חוק הירושה fn1). 9. MD-hold: **yes** (two raw
`.docx`/`.doc` filenames cited as authority — bad UX and unverifiable provenance). 10. Comm: partial.
11. Soup: no (6). 12/13. no. 14. Bottleneck: untitled document artifacts in the footnote set; the
post-death branch of §8א is described loosely because the section body was not read.
15. Action: title recovery for raw filenames (extend the Knesset title-recovery approach to court
docs); statute body acquisition.

### G11 — סעיף 6 לחוק החברות
2. statute_section_definition / definition. 3. statute_section_limitation. 4. refused.
5. Limited (safe). 6. **Downgrade → Over-refusal.** 7. Pack 21, 11 primary_statute, incl. the full
gov.il consolidated Companies Law PDF — which is admitted but metadata-only. 12. OverRef: **yes** —
§6 is short, canonical and was fetchable. 13. OverClaim: no. 14. Bottleneck: **no statute-text
acquisition stage** — statutes get no equivalent of judgment-body acquisition. 15. Action: Track 3
(statute-section acquisition + section extraction from consolidated PDFs).

### G12 — סעיף 8 לחוק יסוד: כבוד האדם וחירותו (פסקת ההגבלה)
Was executed, contrary to REPORT.md. 2. canonical_quote / quote. 3. statute_section_quote_refusal.
4. refused. 5. (not graded). 6. **New grade → Over-refusal (most embarrassing single result).**
7. Pack 14, 12 primary_statute, incl. the Knesset PDF of the Basic Law itself. 12. OverRef: **yes** —
the limitation clause is the single most quotable text in Israeli constitutional law, and B8 shows a
canonical-quote registry path already exists. 15. Action: seed the canonical-quote registry with the
Basic Laws' core sections; then this becomes deterministic and exact.

### G13 — בטלות יחסית
2. doctrine_explanation / definition. 3. none. 4. drafted. 5. Good. 6. **Downgrade → Acceptable.**
7. Pack 20 — **17/20 secondary**, only 2 official_primary. 8. PA-lead: **no** — not one binding
judgment in the used set. 9. MD-hold: **yes** (5 of 9 metadata-only, incl. "מסמך מאתר אקדמי").
10. Comm: **yes, entirely** — the doctrine is described purely from academic writing.
11. Soup: **yes** (9 used, tail-heavy). 12. OverRef: no. 13. OverClaim: **yes by omission** —
בג"ץ בנק המזרחי / זקין / the ניר גלילי-type line is absent; the answer reads like a seminar summary.
14. Bottleneck: no primary anchor requirement for doctrine_explanation. 15. Action: citation
discipline — require ≥1 binding judgment body for a doctrine answer, or label the answer as
literature-based.

### G14 — עקרון תום הלב
2. doctrine_explanation / analysis. 3. none. 4. drafted. 5. Acceptable (source-soup). 6. **Stands
(Acceptable, at the floor).** 7. Pack 18. 8. PA-lead: weak — fn1 is "מסמך מאתר ממשלתי", an untitled
gov.il blob. 9. MD-hold: **yes** (8 of 14). 10. Comm: **yes**. 11. Soup: **yes, worst in the audit —
14 of 18 admitted sources cited**, including a בית משפט שלום ruling and an off-topic paper on
domestic workers. 12. OverRef: no. 13. OverClaim: mild — §39/§12 stated without the section bodies.
14. Bottleneck: no used-source ceiling, no relevance pruning, untitled sources. 15. Action:
primary-first pruning with a hard cap (5–8) and a title/relevance gate.

### G15 — שיתוף ספציפי בדירת מגורים
2. doctrine_explanation / definition. 3. none. 4. drafted. 5. Good. 6. **Downgrade → Limited (at
audit time); Acceptable after the guard.** 7. Pack 22, **12/22 metadata-only**. 8. PA-lead:
nominally (fn1 חוק הגנת הדייר — **the wrong statute**; tenant-protection law is not the frame for
specific-sharing). 9. MD-hold: **yes — all 7 used sources are metadata-only. Zero bodies read.**
10. Comm: yes. 11. Soup: borderline. 12. OverRef: no. 13. OverClaim: **yes, the audit's worst** —
opened with "לא נמצאה הלכה מוכרת בשם…" for a doctrine that is well established (בע"מ 1398/11 and the
'דבר מה נוסף' line). 14. Bottleneck: negative-existence framing (now guarded) + citing 7 sources
without reading one body. 15. Action: **metadata-only gate** — a source with no body may be listed
as a reference but must not carry a proposition. Guard already blocks the phrasing; the evidentiary
hollowness remains.

### G16 — השתק הבטחה
2. doctrine_explanation / definition. 3. none. 4. drafted. 5. Good. 6. **Stands (Good).**
7. Pack 21, 10 full_text, 1 judgment with holding text. 8. PA-lead: yes (בג"ץ 5517/17, full text).
9. MD-hold: yes (3 of 5). 10. Comm: partial. 11. Soup: no (5). 12/13. no — elements and remedies are
stated soberly. 14. Bottleneck: the classic סאי-טקס four-element formulation is not anchored to a
named judgment. 15. Action: landmark anchoring; otherwise leave as-is. Best-shaped answer in the set.

### G17 — סקירת פסיקה: מבחן ההשתלבות
2. academic_survey → doctrine_explanation / analysis. 3. none. 4. drafted. 5. Acceptable.
6. **Stands (Acceptable).** 7. Pack 26, 13 binding_case_law. 8. PA-lead: **no** — the used set is
legislation-and-guidance heavy (פיצויי פיטורים, ביטוח לאומי, קופות חולים circular); the case-law
survey cites two lower-instance judgments. 9. MD-hold: **yes** (8 of 12). 10. Comm: **yes** — the
integration test itself is sourced to "מיהו עובד: מבחני הסף" and "עובד או קבלן". 11. Soup: **yes**
(12 used). 12. OverRef: no. 13. OverClaim: **yes** — titled a *case-law survey* while citing almost
no case law; דב"ע נג/3-30 חסון absent. 14. Bottleneck: survey shape does not enforce a case-law
spine. 15. Action: for survey shapes, require N judgments with bodies or downgrade the answer's
self-description.

### G18 — סקירה: הרמת מסך בחברות משפחתיות
2. academic_survey → doctrine_explanation / analysis. 3. insufficient_sources_limitation.
4. refused. 5. Limited. 6. **Stands (Limited) — defensible.** 7. Pack 30 but shallow: 7 listing
pages, 14 metadata-only, **verifier direct = 0**. 12. OverRef: borderline-no — "family companies"
narrows the topic and nothing directly supported it; the honest refusal is the right call here,
unlike G07/G08. 13. OverClaim: no. 14. Bottleneck: narrow-topic retrieval. 15. Action: offer a
scoped fallback ("no family-company-specific authority; general piercing law available — proceed?")
instead of a flat limitation.

### G19 — סקירה: מבחני המידתיות
2. academic_survey → doctrine_explanation / analysis. 3. none. 4. drafted. 5. Good.
6. **Stands (Good) — best substantive answer in the audit.** 7. Pack 23, 8 verifier-direct, 6
full_text. 8. PA-lead: partially (בג"ץ 1877/14 leads) but 8 of 10 used are academic.
9. MD-hold: 2 of 10. 10. Comm: **yes** — the three-prong test is anchored to scholarship, not to
בג"ץ 6821/93 / אדם טבע ודין / המפקד הלאומי. 11. Soup: **yes** (10 used). 12/13. no — content is
accurate. 14. Bottleneck: correct doctrine, wrong provenance. 15. Action: landmark-first citation
ordering. **Direct contradiction with G08's refusal on the same doctrine — same-doctrine consistency
check needed.**

### G20 — סקירת פסיקה: תום לב במו"מ
2. academic_survey → doctrine_explanation / analysis. 3. none. 4. drafted. 5. Good.
6. **Downgrade → Acceptable.** 7. Pack 20, **5 judgment docs, 3 with holding text — the richest
judgment pack in the audit**. 8. PA-lead: yes (ע"א 6952/15 full text). 9. MD-hold: yes (5 of 8).
10. Comm: yes. 11. Soup: borderline (8). 12. OverRef: no. 13. OverClaim: no, but **materially
incomplete** — reliance damages only; קל בניין / expectation damages in the pre-contractual stage is
absent, which is the headline development in this area. Also two footnotes are raw filenames
(`4189b.pdf`, `4302b.pdf`). Slowest run: 369s. 14. Bottleneck: judgment bodies acquired but the
doctrinally decisive one missing; title recovery. 15. Action: landmark coverage check per doctrine;
title recovery; runtime watch.

---

## A. Revised grade distribution

Over 20 executed runs (audit denominator of 19 in brackets):

| Grade | v2 count | REPORT.md |
|---|---|---|
| Good | **4** (G09, G10, G16, G19) | 12 |
| Acceptable | **6** (G01, G02, G05, G14, G17, G20) | 2 |
| Limited-quality (drafted but weak) | **3** (G06, G13, G15) | 0 |
| Correct refusal | **3** (G03, G04, G18) | 2 (+1 counted Limited) |
| Over-refusal (failure) | **4** (G07, G08, G11, G12) | counted as Limited/safe |
| Technical failure | 0 | 0 |
| Unsafe / fabricated | 0 | 0 |

Headline: REPORT.md's "12 Good" does not survive a read of the bodies. The safety picture does —
zero fabrications, zero technical failures, every run terminal.

## B. Top 5 product risks

1. **Metadata-only sources carry propositions.** Present in 13 of 16 drafted runs; total in G15
   (7/7 used, zero bodies read). The footnote apparatus implies verification that did not occur.
   This is the single biggest credibility risk with lawyers.
2. **Over-refusal on settled law** (G07, G08, G11, G12). Four of twenty runs refuse questions a
   first-year student answers. G12 refusing the limitation clause is the worst look in the set.
3. **Same-doctrine inconsistency.** G07 refuses the integration test / G17 answers it; G08 refuses
   proportionality / G19 explains it in three prongs. Outcome depends on mode classification, not on
   the law. Users will read this as unreliability.
4. **Landmark absence.** Answers are doctrinally plausible but cite the periphery: no חסון, no
   אבו רומי body, no אפרוחי הצפון, no קל בניין, no Mizrahi reasoning. Correct-but-hollow.
5. **Source-soup and untitled artifacts.** G14 cites 14/18; G13 9; G17 12. Footnotes include
   `65652-12-22.docx`, `4189b.pdf`, "מסמך מאתר ממשלתי" — unusable as citations in a legal document.

## C. Top 3 implementation tracks, ranked

1. **Track 2 — sufficiency & topical matching.** Body-text topical matching instead of Hebrew stem
   overlap; correct scholarship/binding role labels; rule that a pool with ≥3 direct-support
   full-text sources cannot fire `insufficient_sources_limitation`. Converts G07/G08 (and reduces
   the G17/G19 inconsistency) — highest product impact per unit of work.
2. **Citation discipline: metadata-only gate + used-source ceiling.** A metadata-only source may be
   listed as a reference but may not carry a proposition; cap used sources at 5–8 with primary-first
   ordering; drop untitled artifacts or recover titles. Fixes the G15/G14/G13/G17 class and directly
   raises perceived quality.
3. **Statute & canonical-text acquisition.** Section extraction from consolidated statute PDFs, plus
   seeding the canonical-quote registry with Basic Law sections. Converts G11 and G12, and makes
   G09's verbatim quote provenance-backed instead of lucky.

## D. Monitor, do not fix yet

- **Runtime tail** (G20 369s, mean ~245s). Annoying, not broken; will shift once acquisition changes
  land — re-measure after Track 2.
- **G02's 3-source pack.** Retrieval breadth for landmark dockets; likely improves as a side effect
  of Track 2 rather than as its own track.
- **Speculative-binary skip path** (`binary_too_large_for_inline_extraction`) — still unobserved in
  production telemetry, code-path-verified only. Keep the monitor; no work.
- **G18-style scoped fallback UX.** Real improvement, but it is a product/UX decision, not a
  correctness bug; defer until refusals are rare.
- **Answer-prose polish** (garbled clauses like "מא גררת איסור" in G01). Model-level; revisit only
  after retrieval quality stabilizes.

## E. Beta readiness — small closed group

**Yes, with conditions.** The system is *safe*: 20/20 terminal, zero fabricated holdings, zero
unsafe answers, correct refusals on both fake dockets, and the negative-existence guard now blocks
the one overclaim class the audit found. What it is not yet is *dependable*: 4 over-refusals and a
citation apparatus that overstates verification.

Ship to a supervised closed group (lawyers who treat output as a research starting point, not a
work product) provided:
1. Every answer carries a visible caveat that sources must be verified before use.
2. The UI distinguishes "read in full" sources from reference-only (metadata) sources — even before
   Track 2, this is a presentation-layer fix and removes risk #1's sharpest edge.
3. Users are told refusals are conservative and can be retried with an uploaded source.
4. Collect per-answer feedback on the two failure modes that matter: "refused something it should
   have answered" and "cited a source that does not say this".

Do **not** open to unsupervised or paying general use until Tracks 1 and 2 land.
