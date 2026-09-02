# aw4_academic_research_value_audit_v1 — read-only audit

Run: `qa_logs.id = b48acc4b-0cb2-4e26-9515-4ecf4db220c3`, `run_id 975d1154-6ef7-475f-a239-75f335aa808c`,
2026-09-02 06:47 UTC — the AW4 run after `academic_source_type_whitelist_consistency_v1`.
Genre `theoretical_background`, intent `academic_writing`, strategy `draft_academic_text`. No code changed.

## 1. What the system actually searched for

27 merged queries (12 planner, 6 facet, 5 nomination, 4 judgment-discovery), source-type mix
case 14 / statute 6 / academic 6 / report 1.

Nominations (source_nomination_v2): N3 חוק-יסוד: כבוד האדם וחירותו ס' 8 (statute, 0.95),
N1 בג"ץ 1715/97 לשכת מנהלי ההשקעות (judgment, 0.85), N2 ע"א 6821/93 בנק המזרחי (judgment, 0.6),
E2 + E4 scholarship (topic_only).

Topic coverage of the query set:

| required target | covered? | evidence |
|---|---|---|
| proportionality doctrine | yes | multiple planner + facet queries on "עקרון המידתיות" |
| limitation clause / חוק-יסוד: כבוד האדם וחירותו | yes | N3 (§8), two planner statute queries incl. "הגבלת זכות" |
| three subtests | yes | "מטרה לגיטימית / התאמתיות / נחיצות / איזון"; EN "suitability necessity proportionality in narrow sense" |
| comparative origins (German / Canadian / European) | partial | German covered twice (Verhältnismäßigkeit, BVerfG). **Canadian (Oakes) and ECHR/ECtHR never queried** |
| critique of balancing / judicial discretion | yes | `academic_soft_role_critique` depth query + Barak scholarship query |
| Israeli Supreme Court applications | yes | 14 case queries + `academic_soft_role_example` |

Strategy is sound in shape; the one real hole is comparative breadth (no Oakes / R. v. Oakes,
no ECtHR margin-of-appreciation, no Alexy/Möller by name).

## 2. Candidates that arrived (source funnel)

21 candidates dropped pre-pack: 7 `class_unknown_not_admitted_for_binding_case_law`,
6 `discovery_only`, 5 `class_unknown_not_admitted_for_scholarship`, 1 statute, 1 `bad_source`,
1 government_report. Notably dropped: **Springer/OUP "The Structure of the Proportionality Test"**,
**"Balancing may be everywhere, but the proportionality test is not"**, **"The migration of
proportionality: narratives from Europe and North America"** — i.e. the three best comparative /
theoretical sources in the whole run — all on `class_unknown_not_admitted_for_scholarship`,
plus the IDI PDF "מידתיות וניתוח מדיניות" dropped as `class_unknown_not_admitted_for_primary_statute`
(wrong role slot, not a quality judgment).

The 12 refs that reached the drafter:

| ref | title | type | domain | body chars | eligible | in pack | cited | why not |
|---|---|---|---|---|---|---|---|---|
| s1 | בג"ץ 7385/13 | caselaw | supremedecisions | 130 | no | ref-only | no | metadata-only holding gate |
| s2 | (judgment) | caselaw | court | 112 | no | ref-only | no | same |
| s3 | בג"ץ 1715/97 לשכת מנהלי ההשקעות | caselaw | — | 62 | no | no | no | pack-fit score 0 + metadata-only |
| s4 | המהפכה החוקתית או מהפכת זכויות האדם? | journal_article | taulawreview.tau.ac.il | 16,000 | **yes** | yes | **yes (fn 1)** | — |
| s5 | ביקורת שיפוטית על רשויות אכיפת החוק | journal_article | HUJI | 16,000 | yes | **no** | no | `pack_fit_dropped` score 0 (off-topic) — correct |
| s6 | בג"ץ 9134/12 | caselaw | court | 25 | no | ref-only | no | metadata only |
| s7 | בג"ץ 5699/07 | caselaw | court | 25 | no | ref-only | no | metadata only |
| s8 | בג"ץ 7228/19 | caselaw | court | 25 | no | ref-only | no | metadata only |
| s9 | (judgment) | caselaw | court | 25 | no | ref-only | no | metadata only |
| s10 | הפרדת רשויות ומידתיות (Cohen-Eliya) | remapped → book_or_chapter | law.haifa.ac.il | 16,000 | **yes** | yes | **yes (fn 2)** | — |
| s11 | (untyped) | other | — | 81 | no | no | no | `insufficient_authority_for_claim_category` |
| s12 | מידתיות חוקתית, סבירות מנהלית (דגן) | remapped → scholarship | law.haifa.ac.il | 16,000 | **yes** | yes | **yes** | — |

Only **3 sources** entered the pack — all secondary commentary. `has_judgment: false`,
`statute_count: 0`. The whitelist fix is working (s10 and s12 were remapped and are now eligible;
`ineligible_reason_counts = {not_doctrinal_type: 8}`, all 8 genuinely caselaw/other).

Judgment acquisition failed wholesale: two court-egress calls returned HTTP 200 with PDF bodies
(1.87 MB, 146 KB) but were recorded `edge_connection_reset` — six judgments ended metadata-only
(25–130 chars), stripping 4 ref occurrences and leaving 1 block unsupported.

## 3. Were the 4 footnotes enough?

Rendered: 4 footnotes, 6 inline markers, 3 distinct sources — so **one source is duplicated
across two footnote numbers** (used_sources_length 3 vs footnotes_length 4;
`invariant_passed: true`, but the ¹²³⁴ markers in the prose resolve to only 3 URLs).

| fn | source | role served | genuinely distinct? |
|---|---|---|---|
| 1 | s4 — המהפכה החוקתית (TAU L. Rev.) | doctrinal background / Israeli constitutional framing | yes |
| 2 | s12 — מידתיות חוקתית, סבירות מנהלית | doctrinal background (again) | yes but same role |
| 3 | s10 — הפרדת רשויות ומידתיות | theoretical/normative, used for comparative-origins ¶ and critique ¶ | yes |
| 4 | duplicate of s10/s12 under a second number | none new | **no** |

Roles filled: `doctrinal_background_source` only.
Roles missing (system's own telemetry): `primary_legal_anchor`, `theoretical_normative_source`,
`critique_or_counterposition_source`, `implementation_or_example_source`.

Post-draft loss: drafter emitted **14–18 source_refs across 10 blocks**; CSM kept 8, dropped 6
(`claim_mismatch` ×4, `unrelated_legal_area` ×1 on s10 into a `public_law_hcj` block, and
`insufficient_authority_for_claim_category` ×1 on s11). Rebinding already rescued 6 refs
(claim_mismatch drops fell 10 → 4). 4 of 10 blocks ended with no ref despite an available source.

## 4. Does the AW4 answer give real value?

Content read in full. It correctly names the functional role of proportionality, the German
19th-century origin and the migration of the doctrine, all four stages (legitimate purpose,
suitability, necessity, proportionality stricto sensu), the differing evidentiary character of each
stage, the Israeli absorption via the Basic Laws alongside reasonableness, and a substantive
critique (judicial discretion, separation of powers, evidentiary indeterminacy). Nothing is legally
wrong. What is missing is exactly what a seminar chapter is graded on: **no citation of
חוק-יסוד: כבוד האדם וחירותו §8, no בנק המזרחי, no לשכת מנהלי ההשקעות, no Oakes, no Barak/Alexy by
name** — the canonical furniture is described but never named or footnoted. The German/comparative
paragraph and the critique paragraph rest on one Haifa PDF.

| dimension | grade |
|---|---|
| research strategy | 7/10 |
| source selection | 4/10 |
| source utilization | 6/10 |
| answer richness | 6/10 |
| user value | 5/10 |

A student gets a usable skeleton and a defensible critique section, but must supply every
authority themselves.

## 5. Could it have worked better without new retrieval?

Partly yes, but not enough.

Recoverable without new retrieval:
- **s5** (HUJI, 16,000 chars) — correctly pack-dropped as off-topic; not a real loss.
- **6 CSM drops** — recovering the 4 `claim_mismatch` and the 1 `unrelated_legal_area` drop would
  raise block coverage from 6/10 to 10/10 and split the duplicated footnote into distinct rows.
  Same three sources, more honest attribution — worth maybe +1 on utilization, not on value.
- **s10/s12 role diversity** — both are already used; nothing more to extract.

Not recoverable without retrieval:
- **primary_legal_anchor** — zero statutes and zero usable judgments in the pack. This is the
  dominant defect and it is an acquisition failure (court-egress 200-then-reset; the statute
  candidates dropped at class admission), not a drafter or CSM failure.
- **comparative source** — the three genuinely comparative English candidates were discarded at
  `class_unknown_not_admitted_for_scholarship`; Canadian/ECHR were never even queried.
- **critique/counterposition source** — carried by s10 only, no second voice.

## 6. Should we move to Hebrew naturalness now?

**No.** The remaining problem is not prose. A theoretical-background chapter on proportionality
that cites zero primary law and zero comparative scholarship is thin on substance, not on style —
and the pipeline knows it (`source_roles_missing` lists four of five expected roles).

## Verdict and recommended next step

Verdict: **still too thin** — the mechanical under-citation is fixed, but source *role* coverage
is not. 3 secondary sources, 1 role filled out of 5.

Recommended next track, in order:

1. `academic_primary_anchor_acquisition_v1` — treat the court-egress `edge_connection_reset` on
   HTTP-200 PDF responses as the top bug (it silently metadata-onlys every judgment), and route the
   nominated statute (חוק-יסוד: כבוד האדם וחירותו §8) through statute text acquisition so at least
   one primary anchor reaches every academic pack.
2. `scholarship_class_admission_v1` — stop discarding reputable academic-publisher candidates
   (OUP, Springer, university repositories) under `class_unknown_not_admitted_for_scholarship`;
   admit them subject to the existing body-acquisition and verifier gates.
3. Add Canadian (Oakes) / ECHR comparative facets to the academic query set for
   `theoretical_background`.
4. Only then: Hebrew naturalness.
