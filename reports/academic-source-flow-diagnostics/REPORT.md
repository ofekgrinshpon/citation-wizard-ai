# academic_source_flow_diagnostics_v1 — read-only diagnosis

Runs analysed (latest deployed, post `academic_citation_authority_alignment_v1`):

| Run | run_id |
|---|---|
| AW1 | 44de42f7-952f-43ee-9933-af74348e87d4 |
| AW4 | 0b002d28-1712-45cb-b1d2-78f6e894b8fa |
| AW7 | 618b9639-11e1-403b-bebd-e0680422775b |
| AW8 | 7cb6d67c-38f4-44ed-827e-45464a631a48 |

Raw per-stage dump: `reports/academic-source-flow-diagnostics/raw-funnel.txt`.
No code was changed.

## 1. Cross-run funnel summary

| Stage | AW1 | AW4 | AW7 | AW8 |
|---|---|---|---|---|
| nomination queries (dropped) | 6 (2, judgment_cap) | 7 (1, judgment_cap) | 6 (1, judgment_cap) | 6 (1, low_relevance) |
| discovery hits processed | 257 | 208 | 132 | 127 |
| classified index/listing | 121 | 91 | 70 | 65 |
| listing-suppressed | 96 | 74 | 57 | 55 |
| other pool drops (dup/quota/role) | 33 dup + 36 role/discovery | 16 dup + 32 role/discovery | 15 dup + 34 vector-quota + 7 role | 8 dup + 36 vector-quota + 7 role |
| candidate pool | 30 | 30 | 26 | 28 |
| **listing pages still inside the pool** | **10** | **8** | **7** | **4** |
| source_integrity admitted / rejects | 30 / 0 | 30 / 0 | 26 / 0 | 28 / 0 |
| verifier direct / partial / tangential / unrelated | 3 / 6 / 17 / 4 | 2 / 7 / 9 / 12 | 4 / 14 / 0 / 4 | 3 / 7 / 5 / 13 |
| secondary bodies acquired (≥1.5k chars) | 5 | 10 | 10 | 9 |
| bibliography-only stubs (~100–1500 chars) | 3 | 1 | 0 | 5 |
| primary judgment text acquired & usable | 1 (off-topic) | 0 | 1 (used) | 1 (off-topic) |
| carried pack → passed to drafter | 9 → 7 | 9 → 8 | 18 → 14 | 10 → 8 |
| drafter-emitted source_refs | 11 | 15 | 2 | 0 (refusal) |
| kept by claim-source-match | 3 | 6 | 1 | — |
| dropped by claim-source-match | 8 | 9 | 1 | — |
| rendered footnotes | 2 | 4 | 1 | 0 |
| rendering invariant | passed | passed | passed | passed |
| deterministic branch | none (limited doctrinal fallback B) | none | none | insufficient_sources_limitation |

Meaningful-source metric (acquired body + subject-fit + verifier direct/partial + drafter-visible):
AW1 = 4, AW4 = 7, AW7 = 6, AW8 = 4. Rendered footnotes: 2 / 4 / 1 / 0.

## 2. Per-run source flow and bottleneck

### AW1 — "פרק מבוא" on reading-in as a constitutional remedy (2 footnotes)

Pool composition: 12 court-page judgment records (11 of them `metadata_only`, none subject-relevant),
10 gov.il press-listing pages that survived suppression, 8 scholarship items.

| Source | role → corrected | acquisition | verifier | outcome |
|---|---|---|---|---|
| רע"א 4135/22 (מים וביוב) | binding_case_law | full text acquired | unrelated | correctly unused |
| בג"ץ 5769/18, 1877/14, ע"א 4030/03, ע"פ 6813/16, 7385/13, 3975/21, 3618/23, 7228/19 | binding_case_law | metadata_only, no body | tangential | never citable |
| אהרן ברק, "על תורת הסעדים החוקתיים" | primary_statute → scholarship | **body failed, 168 chars (bibliography_only)** | **direct** | lost at acquisition |
| בל יוסף, "הדיאלוג החוקתי בישראל" | scholarship | **175 chars (bibliography_only)** | **direct** | lost at acquisition |
| "קריאה לתוך החוק — בין המשפט העברי למשפט המדינה" | primary_statute → scholarship | not acquired | — | lost at acquisition |
| ארד פנקס (law.tau.ac.il) | scholarship | listing page, not acquired | direct | not citable |
| "המהפכה החוקתית או מהפכת זכויות האדם" | primary_statute → scholarship | 16 000 chars | partial | **footnote 1** |
| "רבע מאה למהפכה החוקתית" | scholarship | 16 000 chars | partial | **footnote 2** |
| "גלגולי מושג שלטון החוק", "החוקה של ישראל", "בג\"ץ או בד\"ץ" | scholarship | 147 / 16 000 / 16 000 | partial | acquired, emitted, dropped by CSM |
| 10 gov.il press listings | mixed | none | tangential | pool slots wasted |

Bottleneck: **body acquisition for the two most on-point sources (both verifier `direct`) plus
claim-source-match**. The drafter emitted 11 refs and 8 were stripped — 3 for
`insufficient_authority_for_claim_category`, 4 for `claim_mismatch`, 1 for
`commentary_in_substantive_block`.

### AW4 — theoretical background on proportionality (4 footnotes)

Best run. 10 scholarship bodies at 16 000 chars, 5 of them subject-fit.
Drafter emitted 15 refs, 9 stripped: 5 × `commentary_in_substantive_block` on two blocks the drafter
declared `court_holding`, 1 × `insufficient_authority_for_claim_category`, 1 × `claim_mismatch`,
1 × `unrelated_legal_area` (הנזק הראייתי / מכרזים material that should never have reached the drafter).

Bottleneck: **the drafter declaring `court_holding` blocks in a run with zero acquired judgment text**;
every ref on those blocks dies by construction. Secondary bottleneck: off-topic scholarship
(מכרזים, נזק ראייתי, תקצירי מאמרים באנגלית ×3) occupying 5 pool slots.

### AW7 — argument paragraph (1 footnote)

Richest pack of all four: 18 carried, 14 passed to the drafter, 14 verifier-partial, 4 direct,
10 acquired bodies including "ביקורת שיפוטית על שיקול דעת מינהלי" (7 082 chars, partial) and
"נדב דגן — מידתיות חוקתית, סבירות מנהלית" (16 000 chars).
**The drafter emitted only 2 source_refs out of 14 available**; 1 survived.

Bottleneck: **drafter usage, not availability**. The genre cap (one 150–300-word paragraph) plus the
style rules suppress citation density; ~12 eligible, subject-fit, acquired sources were never referenced.
Note also that the single footnote is the acquired בג"ץ 2887/04 with a mangled display title
("חוק עצמית דין עשיית של בדרך מקרקעיה)") — a title-hygiene defect on the one primary anchor used.

### AW8 — topic presentation on administrative promise (0 footnotes, refusal)

Retrieval actually found the right literature:

| Source | acquisition | verifier |
|---|---|---|
| "הבטחה מינהלית" (משפטים) | 1 283 chars | **direct** |
| "על ההבטחה המנהלית / אלישי בן יצחק" | 14 425 chars | **direct** |
| "הגנת ההסתמכות במשפט המנהלי" | 135 chars (bibliography_only) | **direct** |
| "הבטחה מנהלית: לידתה, תולדותיה, אחריתה" | 102 chars (bibliography_only) | partial |

Yet sufficiency returned `no_statutory_caselaw_or_doctrinal_anchor` and the run branched to
`insufficient_sources_limitation` with 0 refs emitted.

Bottleneck: **a sufficiency false negative**, not acquisition. Two on-topic doctrinal bodies with
`direct` verdicts (one of them 14 k chars) existed and were not recognised as a doctrinal anchor —
most plausibly because the 1 283-char and stub bodies fall under the substantive-body threshold and
the 14 425-char one is typed `commentary` rather than eligible doctrinal secondary.
The earlier acceptance report's claim that "retrieval returned no acquired doctrinal body" is wrong.

## 3. Answers to the seven questions

1. **Where are most sources lost?** Two places. Upstream: 47–53 % of every discovery hit is a
   gov.il / court press-listing page; suppression removes most but 4–10 still occupy pool slots per run.
   Downstream: claim-source-match still strips 53–73 % of emitted refs in AW1/AW4.
2. **Main problem per run:** AW1 = acquisition of the best-fit secondaries + claim-source-match;
   AW4 = claim category declaration (court_holding without primary) + off-topic scholarship;
   AW7 = drafter under-usage; AW8 = sufficiency false negative.
3. **Should have reached the drafter but did not:** ברק "על תורת הסעדים החוקתיים", בל יוסף
   "הדיאלוג החוקתי", "קריאה לתוך החוק" (AW1); "הגנת ההסתמכות" and "הבטחה מנהלית: לידתה" (AW8) —
   all verifier direct/partial, all lost to bibliography-only acquisition.
4. **Reached the drafter but should not have:** AW4 — "הנזק הראייתי ו'עונשו'", "פגם בערבות להצעה
   במכרז", "תקצירי מאמרים באנגלית" ×3; AW7 — "דיני מזונות אישה", "תקנת השוק במכר"; AW8 — "הסדרת
   מצבי חדלות פירעון", "הזכות לפרטיות בעבודה". Subject-matter fit is applied at ref level, not at
   pack-admission level, so off-topic 16 k bodies still consume drafter context.
5. **Missing roles explaining thin answers:** `primary_legal_anchor` missing in AW1 and AW4 (no
   subject-relevant judgment was ever nominated — the judgments retrieved are random dockets);
   `theoretical_normative_source` missing in all four; `implementation_or_example_source` missing in AW1/AW4.
6. **Did `academic_citation_authority_alignment_v1` fix the category gating?** Partially, and less
   than the acceptance report suggested. The alignment telemetry is live and off-topic/partial guards
   report zero false hits, but `academic_claim_categories_used` shows only **legacy** categories —
   `doctrinal_synthesis`, `contextual_background`, `court_holding`, `scholarly_commentary`. None of the
   six new academic categories fired in any run, because every block arrived with
   `basis: declared_claim_category` and the academic mapping only changes the default for untagged
   blocks. Consequence: `insufficient_authority_for_claim_category` and
   `commentary_in_substantive_block` still strip refs exactly as before (8/11 in AW1, 9/15 in AW4).
   Footnote counts rose (AW4 1→4) mainly because rebinding and role remapping kept more sources alive,
   not because the new categories are being used.
7. **Next bottleneck per run:** AW1 — secondary body acquisition for direct-fit sources;
   AW4 — academic category mapping over drafter-declared categories; AW7 — citation density in the
   argument-paragraph genre plus display-title hygiene on the acquired judgment; AW8 — doctrinal
   sufficiency recognition of acquired commentary bodies.

## 4. Recommended next track (not implemented)

`academic_declared_category_remap_and_body_acquisition_v2`, three narrow parts:

1. **Category remap over declared categories** — in academic mode, map drafter-declared
   `doctrinal_synthesis` / `contextual_background` / `scholarly_commentary` onto the academic
   categories (with the existing wording-based escalation still forcing `court_holding` / `statutory`
   when binding formulations or dockets appear), so the alignment work actually reaches emitted refs.
2. **Bibliography-only rescue for direct-fit sources** — when a verifier-`direct` secondary acquires
   under the substantive threshold, run one bounded extra acquisition attempt (fulltext link / PDF)
   before demoting it to bibliography-only; and let doctrinal sufficiency count an acquired,
   on-topic commentary body ≥ ~1 000 chars as a doctrinal anchor (AW8's refusal).
3. **Pack-level subject-fit admission** — apply the existing fit scorer before the drafter pack is
   built, not only at ref level, so off-topic 16 k bodies stop displacing on-topic ones.

Not recommended: raising candidate counts, loosening primary-law safety, or any fixed citation target.
