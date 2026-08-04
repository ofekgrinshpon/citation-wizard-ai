# Research-pack hierarchy & source composition — diagnostic (5 fixtures)

Track: `research_pack_hierarchy_v1` — **diagnostic only**, no pipeline changes.
Predecessor `judgment_discovery_and_ranking_v1` closed as stable-initial / monitor.

Run: 2026-08-04, deployed `legal-research-v1`, smoke mode.
Raw per-fixture JSON: `reports/pack-hierarchy-diagnostic/{R03,R08,R04,R09,R02}.json`.

Bucketing used in this report (deterministic, derived from `citable_as` / `authority_tier` / `text_usability` / host):

| Bucket | Rule |
| --- | --- |
| `primary_judgment_usable` | `citable_as=judgment` **and** full_text / substantive_excerpt / holding text |
| `primary_judgment_metadata_only` | `citable_as=judgment`, metadata only |
| `statute` | statute / statute_mirror |
| `official_other` | `official_primary` tier, not judgment/statute (reports, state comptroller) |
| `scholarship` | academic host (`*.ac.il`, journals) |
| `commentary` | secondary_commentary, non-academic (firm blogs, summaries) |
| `listing_not_citable` | listing/pagination/index pages, `not_citable` |

Primary = judgments + statutes + official_other. Secondary = scholarship + commentary.

---

## Headline

| Fixture | Branch | Admitted P / S / noise | Used P / S | First-5 used P / S | Secondary cited before primary | Mixed-hierarchy footnotes |
| --- | --- | --- | --- | --- | --- | --- |
| R03 הלכת השיתוף | drafted | 6 / 13 / 2 (22) | 4 / 2 | 3 / 2 | no (P at #1) | 1 of 5 |
| R08 מידתיות | drafted | 6 / 13 / 2 (22) | 3 / 8 | 2 / 3 | **yes (S at #1, P at #4)** | 1 of 8 |
| R04 הרמת מסך | drafted | 12 / 10 / 2 (25) | 8 / 3 | 5 / 0 | no (P at #1) | 0 of 5 |
| R09 מבחן ההשתלבות | `insufficient_sources_limitation` | 11 / 13 / 1 (26) | 0 / 0 | — | — | — |
| R02 בנק המזרחי | drafted | 2 / 16 / 2 (21) | **0 / 8** | 0 / 5 | **yes — no primary at all** | 0 of 5 |

Commentary share of the admitted pack: R03 0.59, R08 0.59, R04 0.40, R09 0.50, R02 0.76.

Two distinct failure shapes, not one:

1. **Ordering failure** (R08): primary authority *exists and is used*, but scholarship occupies the opening footnotes. Fixable by ordering/selection alone.
2. **Composition failure** (R02): the pack contains essentially no usable primary judgment on-topic, so the answer is written entirely on scholarship *about* the judgment. Not fixable by reordering — this is still a discovery gap.

R03 and R04 are already close to acceptance. R09 refuses correctly but the refusal is accompanied by a noisy pack.

---

## A/B/C per fixture

### R03 — הלכת השיתוף (drafted, sufficiency `case_law_synthesis_supported`)

**A. Admitted (22):** 2 usable judgments (בע"מ 4623/04 `full_text` direct; בג"ץ 1000/92 בבלי `substantive_excerpt` direct), 1 metadata-only judgment (ע"א 52/80 שחר, partial), 3 statutes, 6 scholarship, 7 commentary, 2 listing, 1 unclassified.
Verifier: 7 direct / 6 partial / 9 unrelated.

**B. Used (6):** P4 / S2. Order: `בע"מ 4623/04` (fn1) → gov.il judgment excerpt (fn1) → חוק יחסי ממון (fn4) → 2 commentary + ע"א 52/80 (fn5).
Primary leads at position 1; secondary first appears at 4. Head-5 = 3P/2S. **Passes the ordering criterion.**

**C. Why secondary enters:** all three secondary sources carry `direct` verifier verdicts and rank 4–6 in the admitted pool — they beat the second usable judgment (rank 7) on retrieval order. They are *supporting* citations for the doctrinal narrative, not authority substitutes.

**Defect:** footnote 5 is compound and mixes hierarchy — `[commentary, commentary, primary_judgment_metadata_only]`, i.e. it leads with commentary and buries ע"א 52/80 in third place. This is exactly the "compound footnotes obscure hierarchy" case.

### R08 — מידתיות (drafted, `case_law_synthesis_supported`)

**A. Admitted (22):** only **1** usable judgment (בג"ץ 3752/10, full_text, *partial*), 5 statutes (top-2 both `unrelated` — planning-law noise), 10 scholarship, 3 commentary, 2 listing.

**B. Used (11):** P3 / S8. Order: scholarship (fn1) → scholarship + commentary (fn2) → **then** the three judgment sources (fn3) → scholarship ×5.
`first_primary_position = 4`, `first_secondary_position = 1`. Head-5 = 2P/3S. **Fails the ordering criterion.**

**C. Why:** the only usable judgment scored `partial` at the verifier while eight scholarship items scored `direct`. Nothing downstream re-weights authority against verifier confidence, so `direct` scholarship wins the opening slots. Footnote 4 mixes `[judgment, judgment, scholarship]`.

Note the answer *does* eventually anchor on בג"ץ 3752/10 — the problem is presentation order, not absence of authority.

### R04 — הרמת מסך (drafted, `case_law_synthesis_supported`)

**A. Admitted (25):** 7 statutes (חוק החברות twice, תקסד"א twice), 5 metadata-only judgments, 4 scholarship, 6 commentary, 2 listing. Best composition of the five.

**B. Used (11):** P8 / S3. Order: ע"א 7721-22 (usable, ×2, fn1) → חוק החברות (fn2) → תקסד"א (fn3) → 2 metadata judgments (fn4) → commentary/scholarship (fn5).
Head-5 = 5P/0S; secondary first appears at position 9. **Best hierarchy in the set.**

**C.** Commentary is confined to the tail and to a single all-secondary footnote (fn5). No mixed footnotes.
Two residual issues: (i) the same statute is cited twice from two mirrors (חוק החברות ×2, תקסד"א ×2) — dedup by legal identity rather than URL would free two slots; (ii) fn3 cites תקנות סדר הדין האזרחי, which is procedurally irrelevant to piercing the corporate veil and entered as a `partial` statute-mirror match.

### R09 — מבחן ההשתלבות (refusal, `no_usable_judgment_authority`)

**A. Admitted (26):** 1 usable judgment (בג"ץ 1758/11, full_text, **tangential**), 3 official_other (labour-market reports), 7 statutes — of which several are *health-insurance* regulations with `unrelated` verdicts, 9 scholarship, 4 commentary, 1 listing.
Verifier: 1 direct / 8 partial / **13 unrelated** / 4 tangential.

**B.** No used_sources, no footnotes — the refusal is clean and does not cite noise. **Correct behaviour.**

**C.** The refusal is right (the only usable judgment is tangential), but the admitted pack is 50% commentary and contains 13 unrelated items. Admission is far more permissive than usability; the pack is not a research pack, it is a search dump that happens not to be shown.

### R02 — בנק המזרחי (drafted, `shape_not_gated`, sufficiency `not_applicable`)

**A. Admitted (21):** 10 scholarship, 6 commentary, 1 statute (unrelated ביטוח לאומי regs), 2 listing, and exactly **1** usable judgment — בג"ץ 8638/03 סימה אמיר, which is *the wrong case* and verified `unrelated`. **The Bank Mizrahi judgment itself is not in the pack.**

**B. Used (8):** P0 / S8. Every footnote rests on academic writing about the judgment (תקציר פסק הדין, "מהפכה או המשכיות", "חצי יובל לפסק דין בנק המזרחי"...). Head-5 = 0P/5S.

**C.** This is not a hierarchy bug. `specific_case` shape is `shape_not_gated`, so the authority-type sufficiency profile never runs, and the drafter is free to write from scholarship. The pack composition is the *cause*, not the symptom.

**This is the most severe finding**: a landmark-judgment question answered entirely from commentary, with scholarship functionally presented as if it were the authority.

---

## D. What would actually fix each case

| Lever | R03 | R08 | R04 | R09 | R02 |
| --- | --- | --- | --- | --- | --- |
| Reordering used_sources only | partial | **yes — sufficient** | n/a | n/a | no |
| Cap commentary count | minor | yes | minor | n/a | no |
| Require ≥1 primary before any commentary | already true | **yes** | already true | n/a | impossible (no primary) |
| Split footnotes primary vs. secondary | **yes (fn5)** | yes (fn4) | n/a | n/a | no |
| Dedup statutes by legal identity | n/a | yes | **yes** | n/a | n/a |
| Suppress `unrelated`/`tangential` from admitted pack | yes | yes | yes | **yes** | yes |
| Discovery still lacks primary sources | no | borderline (1 judgment) | no | **yes** | **yes** |

### Recommended implementation shape (for a future, narrow track)

Ordered by value/risk, all inside pool composition → used_sources selection → footnote assembly. No retrieval, acquisition, sufficiency or drafter-model changes.

1. **Hierarchy-ordered `used_sources`.** Deterministic post-draft sort key: usable judgment → statute → official_other → metadata-only judgment → scholarship → commentary; stable within tier by first appearance. Renumber footnotes accordingly. Fixes R08 outright; costs nothing elsewhere.
2. **Primary-before-secondary invariant.** If the pack contains ≥1 usable primary authority, footnote 1 must resolve to a primary source. Cheap assertion, telemetry-first.
3. **No mixed compound footnotes.** When a segment cites both primary and secondary, split into two footnotes (primary first) or drop the secondary ref from that segment. Fixes R03 fn5 and R08 fn4.
4. **Commentary cap in the head.** At most 1 secondary source among the first 3 used sources whenever ≥2 primary sources exist.
5. **Statute identity dedup.** Collapse multiple mirrors of the same law/regulation into one used source (keeps the most official URL). Frees 2 slots in R04.
6. **Admission hygiene for the refusal path.** Exclude `unrelated` verdicts from the admitted pack that is reported/carried forward, so refusals (R09) and reports don't present 13 irrelevant items as research material.
7. **R02 is out of scope for this track.** It needs a `specific_case` discovery/acquisition fix (the actual judgment is never retrieved) plus consideration of whether `shape_not_gated` should let a landmark-case answer be written entirely from scholarship. Flag it, don't patch it here.

### Expected effect against the acceptance criteria

- *Primary leads answer and footnotes* — met for R03/R04 today, met for R08 after (1)+(2).
- *Commentary not outnumbering primary in first 3–5* — met after (1)+(4) for R03/R04/R08.
- *Scholarship not looking like binding authority* — improved by (1)+(3); unresolved for R02 without discovery work.
- *Compound footnotes not obscuring hierarchy* — met after (3).
- *Refusals not listing noisy commentary* — R09 already emits no sources; (6) cleans the reported pack.

---

## Open questions for the next track

- Should verifier `direct` on scholarship ever outrank verifier `partial` on a usable judgment in selection order? Current behaviour says yes; R08 shows that is wrong for `case_law_synthesis`.
- Should `specific_case` shape gate on the presence of the named judgment (R02), given `shape_not_gated` currently bypasses authority-type sufficiency entirely?
- Should `unrelated` verdicts be admitted to the pack at all, or only retained as telemetry?
