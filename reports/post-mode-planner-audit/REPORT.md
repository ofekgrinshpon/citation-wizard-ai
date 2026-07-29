# Post-Mode-Planner Quality Audit (7-mode set)

Run: `scripts/legal-research-v1-post-mode-planner-audit.ts` — no code changes. Raw per-query JSON in this folder.

| # | Query | A. research_mode | B. obligations | C. sufficiency | D. used_sources by type | E. pack matches mode | G. grade | H. main defect |
|---|---|---|---|---|---|---|---|---|
| M1 | ע"א 6821/93 | specific_case | 4/4 (dual docket probes applied, +2 widened) | shape_not_gated (case_holding) | 1 caselaw (Nevo archive page) + 4 scholarship | partial — anchor present but no judgment text | acceptable | retrieval miss (holding text) |
| M2 | סעיף 12 לחוק החוזים | statute_section_definition | 3/3 (statute-first) | shape_not_gated (definition) | 1 israeli_law (Wikisource) + 3 legislation (Knesset PDFs) | yes | good | source integrity (lead text from Wikisource, not Knesset/Nevo) |
| C2 | הלכת השיתוף | case_law_synthesis | 6/6 (layered: statute 1, binding 4 dual-lane, persuasive 2, scholarship 3) | sufficient, `case_law_synthesis_supported` | 5 mixed: 1 gov.il PDF caselaw + gov.il paginated pages + scholarship | no — no named landmark judgments | acceptable / borderline | retrieval miss + sufficiency too loose |
| M4 | חובת תום הלב במו"מ | doctrine_explanation | 1/2 — `bounded_scholarship` unsatisfied (4 scholarship queries) | shape_not_gated | 5 scholarship/other + 1 journal_article + 1 gov.il pagination page | no — scholarship-dominant, statute absent from pack | acceptable | bad plan (scholarship bound not enforced) → lead_ref `no_statute_source` |
| M5 | פיקדון שכירות | practical_steps | 2/2 (substantive law before procedure, 11 queries) | **insufficient — `generic_procedure_only`** | none | no | too limited | sufficiency too strict / topic-phrase extraction |
| M6 | ציטוט סעיף 1 חוק-יסוד | canonical_quote | n/a (deterministic branch) | n/a | 1 israeli_law (knesset.gov.il PDF) | yes | good | none |
| C1 | הלכת יורש אחר יורש | case_law_synthesis | 6/6 | sufficient, thin_source=true | 2 legislation (Nevo) + 6 caselaw (psakdin/toledano/gov.il) | yes for inheritance law — but premise not challenged | unsafe (framing) | sufficiency too loose / no premise check |

## Special checks

**C2 — synthesis or general doctrine?** General doctrine answer, not a line of authority. The plan was correct (statute + 4 binding + 2 persuasive + bounded scholarship, dual-lane), but zero named judgments reached the pack; footnote support came from gov.il spokesperson pages and one PDF. It does contain a limiting/distinguishing layer this run (ידועים בציבור, נכסי ירושה, ראיות) — the open item from the previous track did not repeat here — but every limitation is unattributed to a specific case. Also no `חוק יחסי ממון` in the final pack despite a primary_statute query. Failure class: **retrieval / admission**, not planning.

**M5 — why sufficiency still fired.** `source_sufficiency` returned `category: practical_list`, `reason: generic_procedure_only`, `topical_refs: []`, and `topic_phrases: ["מחזיר פיקדון"]` only. The plan was good (11 queries, substantive-law-first, 2 primary_statute + 2 regulation + 3 binding caselaw to perplexity), but retrieval returned only small-claims/court-procedure statutes. Two compounding causes: (a) retrieval genuinely missed tenancy law (חוק השכירות והשאילה, חוק הגנת הדייר, פיקדון בשכירות), and (b) the lexical topic extractor reduced the query to a single weak phrase "מחזיר פיקדון" — "שכירות"/"משכיר" never became a topic phrase, so even a partially relevant source could not be matched. So it is *not* purely "too strict": the gate fired on a genuinely off-topic pack, but the matcher is too shallow to recognize domain sources even when present.

**C1 — framing corrected?** No. The answer treats "הלכת יורש אחר יורש" as if it were a named line of authority ("הלכת ... — מסקנה ותמצית") and then silently pivots to §42 חוק הירושה plus estoppel case law. It never says the phrase is not a recognized doctrine name but a statutory arrangement (יורש אחר יורש / יורש במקום יורש per §41–42). Improved retrieval has fully removed the earlier limited-answer safety net. This is the clearest **unsafe** item in the set.

**Fabricated URLs?** No invented domains this run (no `jstor.org/stable/sample`-style artifacts). But three low-integrity URL classes were cited as sources:
- `gov.il/he/departments/dynamiccollectors/spokmanship_court?skip=90` and `?skip=250` — paginated index pages typed `caselaw` (M4, C1, C2 lineage). Not citable authority.
- `nevo.co.il/PadiArchive.aspx?MsgId=251` — an archive listing page, used as M1's lead case source.
- `he.wikisource.org` as the `israeli_law` lead for M2's binding statute text.

**Generic procedure-only practical answer?** None emitted — M5 correctly refused rather than producing a small-claims-procedure answer. That gate is working as designed.

**Hallucinated synthesis from weak sources?** C1 yes (doctrine framing invented around real but unrelated estoppel rulings). C2 borderline — the doctrinal content is accurate, but the "limitations and exceptions" paragraph asserts rulings that no cited source establishes. M1 is honest (explicitly says holding text unavailable).

## Bottleneck ranking after mode-aware planning

Planning is no longer the bottleneck: 6/7 modes hit their obligations fully, and mode-specific targets/dual-lane widening are visibly applied. The next bottleneck is **source admission quality between planner and pack** — three distinct sub-problems, in order:

1. **Authority-tier admission** — plans ask for binding case law; index/pagination pages, blog reprints and PDFs are admitted instead of judgments. Affects C2, M4, M1, C1.
2. **Premise / framing validation** — C1 shows there is no step that questions the question. This is a safety issue, not a quality issue.
3. **Topic matching in the sufficiency gate** — single-phrase lexical extraction (M5) makes the gate both blunt-strict and blunt-loose (C1 passed with the fake doctrine's own phrase as evidence of topicality).

`bounded_scholarship` in doctrine_explanation (M4) is a small planner-side leak worth folding into whichever track comes next.
