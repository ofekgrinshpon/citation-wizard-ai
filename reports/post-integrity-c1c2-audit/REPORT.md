# Post-integrity quality audit — C1 & C2 only

Run date: 2026-07-29. Read-only. Raw dumps: `reports/post-integrity-c1c2-audit/{C2,C1}.json`.
Stack under test: deterministic branches · verifier recovery · drafter sharpness · retrieval visibility · sufficiency gate · mode-aware planner · source integrity + placeholder rejection.

## 1. C2 — "מה הפסיקה אומרת על הלכת השיתוף?"

| field | value |
|---|---|
| research_mode | `case_law_synthesis` |
| planner obligations | 6/6 satisfied (statutory_background, leading/applying/limiting case law, secondary_commentary, caselaw_dual_target); `unsatisfied: []`; caselaw routed to local_db **and** perplexity |
| source_sufficiency | `sufficient: true`, `case_law_synthesis_supported`, **`thin_source: true`**, topical_refs s5/s7/s9, `topical_authority_refs: ["s5"]` (one) |
| integrity | 0 rejects; tiers: official_primary 2, primary_mirror 1, index_or_listing 1, secondary_commentary 17; citable: judgment 2, statute-ish 0, scholarship 7, commentary 7, not_citable 1, unknown 4 |
| lead_ref | none — `shape_not_eligible` (analysis) |
| deterministic branch | none |

### used_sources (7)
| # | type | source |
|---|---|---|
| 1 | caselaw | דנג"ץ 8537/18 — `supremedecisions.court.gov.il/.../18085370.V30` (real judgment text) |
| 2 | caselaw | ע"א 52/80 שחר נ' פרידמן — gov.il PDF (`sf-21.pdf`, still the odd mapping) |
| 3 | journal_article | דוד מינץ, השותפות הנישואית… (law.haifa.ac.il) |
| 4 | other | "הלכת השיתוף בנכסים" — daat.ac.il encyclopedia |
| 5 | legislation | חוק יחסי ממון בין בני זוג, תשל"ג-1973 (gov.il PDF) |
| 6 | caselaw | psakdin.co.il — הלכת השיתוף לגבי נכס עסקי |
| 7 | journal_article | lawjournal.huji.ac.il |

### Special checks
- **Real judgment/statute sources? Yes — this is the clear win.** Zero fabricated jstor/ssrn URLs (previous run had 2), zero gov.il pagination pages. A genuine Supreme Court judgment file and the actual חוק יחסי ממון now appear in the pack.
- **Actual line of authority? No.** Still a generic doctrinal essay organized by topic (criteria → residence → statute → asset types → exceptions → burden), not by authority. No בבלי, no יעקובי/קנוביץ, no ע"א 4623/04 / שיתוף ספציפי line, no chronology, no "leading case → applying → limiting". דנג"ץ 8537/18 is cited as generic support, not positioned as controlling.
- Answer closes with an explicit snippet-thinness caveat — honest, but it confirms the drafter never saw holding text.

**Grade: acceptable, not good.** Safe, no overstatement of a peripheral case this time (ע"א 52/80 is no longer promoted to "אבן יסוד"), no fabricated footnotes. But materially incomplete as case-law synthesis.

**Defect classification: retrieval miss (primary) → sufficiency too loose (secondary).**
`thin_source: true` with exactly **one** topical authority still yields `sufficient: true`. The gate counts topicality, not authority coverage across the synthesis skeleton.

## 2. C1 — "מה הפסיקה אומרת על הלכת יורש אחר יורש?"

| field | value |
|---|---|
| research_mode | `case_law_synthesis` |
| planner obligations | 6/6 satisfied; primary_statute 5 queries (local_db), binding_case_law 6+6 dual-target |
| source_sufficiency | `sufficient: true`, `case_law_synthesis_supported`, `thin_source: false`, topical_refs s2/s3/s4/s6/s7, `topical_authority_refs` = same 5 |
| integrity | 0 rejects; tiers: official_primary 2, primary_mirror 2, statute_mirror 5, index_or_listing 2, secondary_commentary 15; citable: statute 7, judgment 1, commentary 8, scholarship 5, not_citable 2 |
| lead_ref | none — `shape_not_eligible` |

### used_sources (7)
חוק הירושה תשכ"ה-1965 (nevo mirror) · ע"א 4402/98 מלמד נ' אשכנזי · gov.il decision .docx ×2 · psakdin ×2 · "פרשנות הצוואה" (typed `legislation`, actually commentary).

### Special checks
- **Premise corrected? No.** The answer opens with the heading **"סיכום מרכזי של הלכת 'יורש אחר יורש'"** and the line *"הפסיקה מכירה במוסד 'יורש אחר יורש'"*. It never says that no הלכה by that name exists.
- Substantively the law is **correct** (s.42 חוק הירושה arrangement, first heir's "כבתוך שלו" freedom, second heir inherits from the testator, no chaining beyond two, distinction from "יורש במקום יורש"). So the content is not hallucinated — only the framing is.
- Required behavior ("לא מוכרת הלכה בשם…; קיים הסדר בסעיף 42 לחוק הירושה") is **not produced**.

**Grade: acceptable-but-mislabeled.** Not unsafe (no invented case law), not too limited — but it validates the user's false premise.

**Defect classification: premise/framing issue (primary) + sufficiency too loose (contributing).**
Root cause is visible in the gate output: `topic_phrases` includes the fuzzy substrings `"יורש אחר"`, `"אחר יורש"`, `"הלכת יורש"`. The genuine statutory arrangement matches them, so the gate reports 5 topical authorities and the pipeline concludes the *named הלכה* is supported. Nothing anywhere in the pipeline distinguishes "the phrase X exists in law" from "a named הלכה called X exists".

## 3. Cross-cutting observations

1. **Planning is fully satisfied in both runs (6/6, `unsatisfied: []`) yet neither answer meets its mode's quality bar.** Obligation satisfaction is measured on *queries issued*, not on *authorities obtained* — it is currently a planning-coverage metric, not a retrieval-coverage metric.
2. **`role_unsatisfied: 19` in both runs** while obligations report 0 unsatisfied. The two signals contradict each other and one of them is misleading.
3. **`authority_tier` / `citable_as` are not carried into `used_sources`** — integrity classification exists at pool level (`tier_counts`, `citable_counts`) but is invisible per cited source, so "which tier did we actually cite" cannot be audited without re-deriving it. Observability gap.
4. Source integrity is doing its job: 0 rejects needed in C1, no placeholder/pagination/listing URL reached footnotes in either run.

## 4. Next-bottleneck ranking

| rank | bottleneck | evidence |
|---|---|---|
| 1 | **Premise validation for named doctrines** (C1) | Gate passes on substring topicality; drafter asserts a non-existent named הלכה |
| 2 | **Synthesis-shaped retrieval + drafting** (C2) | Real sources now, but no authority line; `thin_source: true` passes the gate |
| 3 | **Sufficiency strictness for `case_law_synthesis`** | 1 topical authority + thin snippets ⇒ `sufficient: true` |
| 4 | **Telemetry coherence** | obligations 6/6 vs `role_unsatisfied: 19`; no per-source tier in used_sources |

Retrieval integrity is no longer the top blocker. The next true bottleneck is **premise/framing validation**, with synthesis-shaped drafting second.
