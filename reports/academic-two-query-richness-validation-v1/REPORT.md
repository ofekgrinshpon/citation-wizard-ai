# academic_two_query_richness_validation_v1 — live validation (no code changes)

Deployed version as of 2026-09-05. Two academic queries, live runs, read-only telemetry.

Verdict: **still thin.** Both answers end with 2 footnotes and 2 distinct cited sources.
Neither reasonableness landmark (דפי זהב / גנור) nor any administrative-promise authority
(אמסטרדם, סאי-טקס, רוקר, בעל־חוט) was ever nominated, searched or cited.

---

## Query 1 — עילת הסבירות (run 1)

- run_id: `61f76a2b-3f54-49e1-8a87-7ed5b8a161d4`
- total_ms: 223,285 (retrieval 67,737; drafter 28,549)

### Final answer (verbatim)

> המשפטי־מעשי של עילת הסבירות מתחיל בהגדרה פונקציונלית: סבירות היא עילת ביקורת מנהלית שמטרתה לבחון האם שיקול דעת שלטוני נותר בתוך גבולות הנימוקים וההיגיון הרציונלי המקובל… ¹
> (6 פסקאות; 6 מרקרים; שתי הערות שוליים בלבד)
> …מסקנה זו תואמת את המסגרות התיאורטיות בספרות ובדיונים הפסיקתיים… ²
>
> *הערת עבודה: זוהי טיוטה אקדמית ראשונית. לפני הגשה יש להשלים הפניות מדויקות לפסיקה ולספרות.*

Footnotes:
1. בג"ץ 5658/23 התנועה למען איכות השלטון בישראל נ' הכנסת (toledano.co.il — mirror, not official)
2. חוק-יסוד: כבוד האדם וחירותו (fs.knesset.gov.il PDF)

### Metrics

| metric | value |
|---|---|
| raw sources found | 288 |
| after dedup / pool admitted | 5 (+2 backfill) |
| candidates reaching pipeline | 6 |
| body-acquired | 3 |
| in drafter pack | 4 (s1–s4) |
| representative selected | 3 |
| model-emitted refs | 3 |
| post-CSM kept | 3 |
| post-alignment kept citation pairs | 10 (of 11) |
| final footnotes | 2 |
| distinct cited sources | 2 |

Pool drops: `dup_document_id` 38, `backfill_origin_diversity_cap` 27, `discovery_listing_suppressed` 1.
Academic pack admission: 21 reviewed, **1 admitted**, 20 rejected
(`no_scholarly_title_or_abstract` 17, `class_unknown_has_no_secondary_academic_slot` 16,
`no_credible_academic_provenance` 11, `insufficient_academic_signals` 12).
Rejected here included *הפרקליט* (`hapraklit.co.il`) — a leading peer-reviewed Israeli law journal.

### Source-role richness of the 2 cited sources

| role | cited |
|---|---|
| primary_statute_or_text | 1 (חוק-יסוד: כבוד האדם וחירותו — background only, not the governing text) |
| canonical_case_law | 1 (5658/23, via commercial mirror) |
| direct_doctrinal_scholarship | 0 (נדב דגן admitted, emitted, survived, **not rendered**) |
| theoretical_normative / critique / comparative / remedy / policy / generic / tangential | 0 |

### Canonical authority check (Q1)

| authority | nominated | discovery query | candidate URLs | relay | body | identity | cited | loss |
|---|---|---|---|---|---|---|---|---|
| בג"ץ דפי זהב | **no** | no | — | no | no | no | no | never entered the registry/nomination set |
| בג"ץ גנור | **no** | no | — | no | no | no | no | same |
| בג"ץ 5658/23 | yes (local corpus) | yes | mirror only | no | yes (full text, identity confirmed) | yes | **yes** | — |
| בג"ץ 6821/93 מזרחי | yes (registry, doctrine=`proportionality`) | yes (2 variants) | 1, rejected `guessed_court_url` | no | no | — | no | `no_derivable_url` |
| בג"ץ 1715/97 לשכת מנהלי ההשקעות | yes (registry) | yes (2 variants) | 0 | no | no | — | no | `candidate_count: 0` |

The registry resolved the question to doctrine `proportionality`, so it hunted Mizrahi and
Investment Managers — **not** the reasonableness line. `canonical_registry_discovery.candidate_count = 0`.

### Court/relay path (Q1)

`court_egress.calls = 2`, configured=true.
- `supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts/93/010/3010&fileName=930103010.PDF&type=2` → Edge reset → relay **502**, 0 bytes.
- `…path=PediVerdicts/63/2&fileName=SG2_9_2605-05.pdf&type=4` → Edge reset → relay **502**, 0 bytes.
No court PDF body was acquired. Both URLs were derived/guessed, not discovered.

### Representative source use (Q1)

5/5 claims compliant. 9 representative uses, 3 omissions, all
`drafter_chose_other_admitted_sources`; justified given a 4-source pack.
The drafter is **not** the limiter here.

### Last-mile funnel (Q1 — full pack is only 4)

| source | role | found | admitted | body | in_pack | representative | emitted | survived | cited | loss_reason |
|---|---|---|---|---|---|---|---|---|---|---|
| חוק-יסוד: כבוד האדם וחירותו (s1) | primary_statute | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | footnote_builder_or_reference_only (+alignment dropped statute in critique block) |
| חוק-יסוד (s2, duplicate) | primary_statute | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ | rendered as the statute footnote |
| נדב דגן, מידתיות חוקתית סבירות מנהלית (s3) | scholarship | ✓ | ✓ | ✓ (16,000 chars) | ✓ | ✓ | ✓ | ✓ | **✗** | footnote_builder_or_reference_only |
| בג"ץ 5658/23 (s4) | binding_case_law | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |

---

## Query 2 — הבטחה מנהלית / ציפייה לגיטימית

First attempt (`5042e630-f70f-488e-a1a0-56b5a269fd1c`) died: `infrastructure_timeout`,
isolate reaped after ~888s at stage `retrieval_entering`, terminal refusal text, 0 footnotes.
Re-run below is the analysed one.

- run_id: `15b0de9a-be37-4a05-9aa8-df224991e05e`
- total_ms: 233,072

### Final answer (verbatim, opening + close)

> מטרת פרק זה היא לפרוס את המונחים והקווים הדוקטרינריים המרכזיים סביב ההבטחה המנהלית והציפייה הלגיטימית במשפט המנהלי הישראלי… ²
> …(9 פסקאות, 7 מרקרים)…
> לסיכום קצר: המיפוי כאן מבוסס על ספרות מובחרת וניתוח מקרים עכשוויים, אך אינו מהווה סקירת כל פסקי הדין הרלוונטיים…
>
> *הערת עבודה: זוהי טיוטה אקדמית ראשונית. לפני הגשה יש להשלים הפניות מדויקות לפסיקה ולספרות.*

Footnotes:
1. בג"ץ 5658/23 (reasonableness case — **off-topic** for administrative promise)
2. הגנת ההסתמכות במשפט המנהלי, lawjournal.huji.ac.il

### Metrics

| metric | value |
|---|---|
| raw sources found | 263 |
| after dedup / pool | 25 |
| in drafter pack | 7 (s1–s7) |
| body-acquired | 7 |
| representative selected | 3 (s1, s2, s3) |
| model-emitted refs | 5 |
| post-CSM kept | 6 |
| post-alignment kept citation pairs | 15 |
| final footnotes | 2 |
| distinct cited sources | 2 |

Pool drops: `backfill_origin_diversity_cap` **219**, `dup_document_id` 6,
`discovery_listing_suppressed` 5, `vector_quota_per_claim` 4, `dup_url` 3.
Academic pack admission: 21 reviewed, 3 admitted (all `government_report`),
role_diversity_score 0.2.

### Source-role richness of the 2 cited sources

| role | cited |
|---|---|
| direct_doctrinal_scholarship | 1 (הגנת ההסתמכות במשפט המנהלי) |
| canonical_case_law | 1 — but **wrong doctrine** (5658/23 reasonableness) |
| all other roles | 0 |

### Canonical authority check (Q2)

| authority | nominated | discovery query | candidates | relay | body | identity | cited | loss |
|---|---|---|---|---|---|---|---|---|
| any הבטחה מנהלית case (אמסטרדם / סאי־טקס) | **no** | no | — | — | no | — | no | not in registry, not nominated |
| any ציפייה לגיטימית case | **no** | no | — | — | no | — | no | same |
| any הסתמכות-מול-רשות case | **no** | no | — | — | no | — | no | same |
| בג"ץ 1000/92 בבלי | yes (registry, doctrine=`rabbinical_civil_property`) | yes | 2 (gov.il .doc + listing) | no | no | no | no | wrong doctrine entirely |
| בג"ץ 8638/03 סימה אמיר | yes (registry) | yes | 2 (knesset .docx/.doc) | no | no | no | no | wrong doctrine entirely |

The registry mapped an administrative-promise question to `rabbinical_civil_property`.
This is a doctrine-classification failure, not a fetch failure.

### Court/relay path (Q2)

1 egress call: `supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts/00/388/079/n01&fileName=00079388.n01&type=4`
→ Edge reset → relay **502**, 0 bytes, no extraction. Again a derived URL.

### Representative source use (Q2)

5/5 claims compliant, 8 uses, **0 omissions**. Drafter fully obeyed the representative layer.

### Last-mile funnel (Q2, full pack = 7)

| source | role | found | admitted | body | in_pack | representative | emitted | survived | cited | loss_reason |
|---|---|---|---|---|---|---|---|---|---|---|
| יובל פרוקצ'יה, על התאוריה של חוזה המתנה (s1) | scholarship | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | footnote_builder_or_reference_only |
| הגנת ההסתמכות במשפט המנהלי (s2) | scholarship | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| בג"ץ 5658/23 (s3) | binding_case_law | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | off-topic but cited |
| תמורה גדולה: משפט מינהלי דור 3.0 (s4) | scholarship | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ | footnote_builder_or_reference_only |
| אחריות נזיקית של רשויות רגולטוריות (s5) | scholarship | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ | footnote_builder_or_reference_only |
| s6, s7 (secondary) | scholarship | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | — | ✗ | in_pack_but_not_chosen_by_model |

`builder_report`: 7 cited segments, `avg_sources_per_cited_segment = 1`,
`unrelated_compound_companions_pruned = 4`, `distinct_source_count = 2`.
Alignment kept 15 (block, source) pairs; the renderer emitted 2 distinct sources.

---

## Quality assessment (1–10)

| dimension | Q1 | Q2 |
|---|---|---|
| legal correctness | 5 | 4 |
| source relevance | 5 | 3 (leading footnote is an off-topic case) |
| source-role diversity | 2 | 2 |
| canonical authority quality | 2 (no דפי זהב/גנור; mirror site for 5658/23) | 1 |
| citation precision | 3 (paragraph-level, no pinpoints) | 2 |
| academic richness | 3 | 3 |
| Hebrew naturalness | 4 (artifacts: "הון סחורות מקצועיות", "דפנסיציות", "דקונסטיטוציונלי", truncated opening) | 5 |
| product readiness | 3 | 2 |

## Diagnosis

The answers did **not** become genuinely richer. Prose length grew; evidence did not.
Both runs end at 2 footnotes / 2 distinct sources, and one of them in Q2 is off-topic.

Richness is lost at three distinct points, in order of magnitude:

1. **Pool collapse before the pack.** 288 → 5 (Q1) and 263 → 25 → 7 (Q2).
   Dominant reason `backfill_origin_diversity_cap` (219 drops in Q2), plus
   academic admission rejecting 20/21 and 21/24 candidates — including *הפרקליט*.
   The pack the drafter sees is 4–7 sources, so nothing downstream can be rich.
2. **Footnote builder / renderer collapse.** Alignment keeps 10–15 (block, source) pairs;
   the builder renders `avg_sources_per_cited_segment = 1` and 2 distinct sources,
   pruning 4 companions in Q2. Fully body-acquired, representative, CSM- and
   alignment-approved scholarship (דגן, פרוקצ'יה, דור 3.0) dies here with
   `footnote_builder_or_reference_only`.
3. **Canonical discovery aims at the wrong doctrine.** Reasonableness → `proportionality`;
   administrative promise → `rabbinical_civil_property`. דפי זהב, גנור, אמסטרדם,
   סאי-טקס were never nominated at all, so no relay call could ever have helped them.

The relay is *a* problem (3 attempts, 3× 502, all on derived `z01`/`type=4` URLs, 0 bytes)
but it is not the binding constraint: the authorities that matter were never discovered.
Representative source use and the drafter are **healthy** — 10/10 claims compliant,
0 unjustified omissions in Q2.

Limiter ranking: **(c) source classification / admission + (f) last-mile footnote pruning**
first, then **(a) canonical discovery doctrine mapping**, then **(b) relay**.
Not (d), not (e), and definitely not (h) — Hebrew is weak but that is the smallest problem.

Stability note: 1 of 3 runs died with `infrastructure_timeout` after ~15 minutes.

## Final recommendation

**continue_source_depth_work**

Concretely, in priority order: relax the origin-diversity/backfill caps and the academic
provenance gate that is discarding peer-reviewed Israeli journals; stop the footnote builder
from collapsing alignment-approved refs to one source per paragraph; fix the doctrine mapping
so reasonableness and administrative-promise questions nominate their own landmark authorities.
Only after that is the relay / court PDF path worth another pass.
