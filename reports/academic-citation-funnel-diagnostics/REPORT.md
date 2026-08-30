# academic_citation_funnel_diagnostics_v1 — read-only funnel diagnosis

Scope: AW1, AW4, AW7, AW8 from the latest deployed run
(`academic_drafter_prompt_conflict_cleanup_v1` validation batch).
Source of truth: `qa_logs.metadata` for the four run ids below. No code was changed.

| Run | run_id | genre / branch |
|---|---|---|
| AW1 | 48ac9939-e4e1-4f6f-b16e-8295ec64ca6f | introduction / `academic_limited_draft` |
| AW4 | 78de523e-059d-47a6-b12d-67d23ee9a568 | theoretical_background / `academic_limited_draft` |
| AW7 | 12306d5f-fd7d-486d-9423-92c9c1b90996 | argument_paragraph / (no deterministic branch) |
| AW8 | 28f72f15-6ffe-4d10-815c-2a390afc5807 | topic_presentation / `academic_limited_draft` |

## 1. The funnel, per run

| Funnel stage (telemetry key) | AW1 | AW4 | AW7 | AW8 |
|---|---|---|---|---|
| Discovery hits dropped before the pool (`dropped_sources`) | 36 | 46 | 4 | 10 |
| Total candidates in pool (`candidates`) | 30 | 30 | 20 | 17 |
| Candidates flagged index/listing (`index_or_listing`) | 11 | 11 | 5 | 5 |
| Candidates after listing/integrity suppression (`total − not_citable`) | 19 | 19 | 15 | 12 |
| Acquired bodies (`acquired_bodies`) | **2** | 9 | 9 | 8 |
| Source-integrity passed (`total − not_citable`; `not_citable` = 11/11/5/5) | 19 | 19 | 15 | 12 |
| Verifier `direct` | **0** | 1 | 2 | **0** |
| Verifier `partial` | 5 | 7 | 10 | 6 |
| Verifier `tangential` / `unrelated` | 4 / 21 | 11 / 11 | 0 / 5 | 4 / 7 |
| Academic-support eligible (`doctrinal_eligible`) | **1** | 8 | 9 | 6 |
| Carried pack size (`carried_pack_size`) | 5 | 8 | 12 | 6 |
| Sources included in drafter context (`sources_passed`) | 4 | 7 | 10 | 6 |
| Source refs the drafter actually emitted (`structured_validation.total_source_ref_count`) | 10 | 15 | 3 | 11 |
| Distinct cited segments emitted (`cited_segment_count`) | 5 | 7 | 1 | 4 |
| Refs surviving claim-source-match (`claim_support_categories.kept_refs`, distinct) | **0** | 1 (`s6`) | 1 (`s10`) | 4 (`s1,s3,s4,s6`) |
| Claim-source mismatches recorded (`claim_source_mismatch_count`) | 10 | 4 | 1 | 5 |
| `sources_used` / `unique_source_count` | 0 / 0 | 1 / 1 | 1 / 1 | 4 / 4 |
| Rendered footnotes (`footnote_count`) | **0** | 1 | 1 | 4 |
| Footnote invariant (`footnote_render_report`) | passed, 0 dangling, 0 orphans | passed | passed | passed |
| Found-only / reference-only split (`source_split_read_in_full` / `source_split_reference_only`) | 0 / 0 | 0 / 4 | 1 / 2 | 0 / 0 |

Mismatch reasons (`claim_source_mismatch_reasons`):
`insufficient_authority_for_claim_category` (all four runs),
`commentary_in_substantive_block` (AW1, AW4, AW8), `claim_mismatch` (AW4).

Rebinding ran in all four runs (`claim_source_rebinding` applied, unbound 0/1/0/0),
so refs were bound to blocks correctly — they were then rejected on authority
category, not on topical binding.

## 2. Where the citations are lost

Two distinct losses, in this order of magnitude:

**Loss A — the pool never becomes usable authority (upstream, structural).**
Of 30/30/20/17 candidates, only 4/7/10/6 ever reach the drafter. The attrition
is not random:
- Discovery-level role admission removes the largest block *before* the pool:
  `class_academic_not_admitted_for_binding_case_law` (11 in AW1, 9 in AW4),
  `class_unknown_not_admitted_for_binding_case_law` (7 / 10),
  `class_academic_not_admitted_for_primary_statute` (3 / 3). The nominator asks
  for `binding_case_law` and `primary_statute` roles; academic material found for
  those queries is discarded for role mismatch even though the academic genre
  needs exactly that material.
- Listing/index pages occupy 11/11/5/5 candidate slots (36% of AW1's pool) and
  are all `not_citable`.
- Body acquisition is the binding constraint in AW1: only 2 of 30 candidates had
  an acquired body (`skipped_no_body_acquisition_attempted: 5`), so
  `doctrinal_eligible` = 1. AW4/AW7/AW8 acquired 8–9 bodies and reached 6–9
  eligible.
- Verifier `direct` is 0/1/2/0. Every academic run is being drafted off
  `partial` verdicts.

**Loss B — claim-source-match strips most of what the drafter did cite (downstream, decisive).**
The drafter is not under-citing. It emitted 10 / 15 / 3 / 11 source refs across
5 / 7 / 1 / 4 cited segments. After `claim_source_match`, 0 / 1 / 1 / 4 refs
survive. In AW1 every single ref was removed: all seven blocks show
`kept_refs: []`, `inline_marker_count: 0`, `sources_used: 0`, so the answer is
correctly rendered with zero footnotes. The removals are all category-based:
blocks declared `court_holding` or `statutory` cannot be supported by
`doctrinal_secondary` material, and `commentary_in_substantive_block` removes
commentary from substantive blocks. `commentary_only_claims` confirms this:
C1,C2,C4 (AW4), C2 (AW7), C1–C4 (AW8).

**Not the cause:** rendering. `footnote_render_report.invariant_passed = true`
in all four runs, with 0 dangling markers and 0 orphan source rows. Footnote
count exactly equals surviving refs everywhere.

**Verdict per run**

| Run | Primary cause | Secondary cause |
|---|---|---|
| AW1 | claim-source-match (10 refs → 0 kept) | acquisition (2 bodies / 30) → eligibility 1 |
| AW4 | claim-source-match (15 refs → 1 kept, 4 mismatches, C1/C2/C4 commentary-only) | drafter context thin (7 of 30) |
| AW7 | drafter usage (only 3 refs emitted from 10 available sources) | eligibility fine (9), match cost only 1 |
| AW8 | claim-source-match (11 refs → 4 kept, 5 mismatches) | topical drift in the eligible pool (see §3) |

Raw candidate count is worthless as a support signal here: AW1 and AW4 have
identical 30-candidate pools and identical 19-after-suppression counts, yet 2 vs
9 acquired bodies and 1 vs 8 eligible sources.

## 3. Source roles

Role reading is based on candidate `role`, `citable_as`, `synthesis_role` and
`used_sources` per run.

| Role | AW1 | AW4 | AW7 | AW8 |
|---|---|---|---|---|
| Primary legal anchor (statute / binding judgment) | missing | missing | present in pool, not cited | missing |
| Doctrinal academic source | 1 eligible, 0 cited | 8 eligible, 1 cited | 9 eligible, 1 cited | 6 eligible, 4 cited |
| Theoretical / normative source | missing | partially — the Barak proportionality review article (cited) | missing | partially — "על כללים והצדקות" |
| Critique / counter-position source | missing | missing | missing | missing |
| Implementation / example source | missing | missing | missing | missing |

Diagnosis for each missing role:

- **Primary legal anchor.** *Found but not acquired / not eligible.* Nomination
  produced the right targets (`חוק-יסוד: כבוד האדם וחירותו`, `בג"ץ 1715/97`,
  `ע"א 6821/93 בנק המזרחי`, `בג"ץ 5555/18 חסון`), but two nominations were cut by
  `judgment_cap`, statute candidates arrived with 75–109 chars of body
  (`doctrinal_typing.body_chars`), and `acquisition_success: false` /
  `acquired_text_length: 0` in all four runs. In AW1 the statute/caselaw
  candidates were then rejected as `not_doctrinal_type`, i.e. too thin to serve
  as primary and disqualified from serving as doctrinal. Where a primary anchor
  did survive (AW7, `sufficiency_authority_basis: usable_judgment`), it was
  **eligible but not used** — the drafter emitted only three refs total.
- **Doctrinal academic source.** *Acquired but dropped by claim-source-match* in
  AW1/AW4; used in AW8. This is the only role the pipeline reliably acquires.
- **Theoretical / normative source.** *Found but not acquired* — most theory
  material entered as discovery hits removed by `class_academic_not_admitted_*`
  before the pool, so it never reached body acquisition.
- **Critique / counter-position source.** *No source was found.* No query in any
  of the four runs targets critique or opposing positions; the facet expansion
  and nomination sets contain no counter-position slot, and no candidate carries
  a critique role.
- **Implementation / example source.** *No source was found.* Same cause; no
  retrieval obligation exists for applied/example material in the academic depth
  mode (`source_mix` covers judgments, primary law, secondary, institutional,
  bills — not examples/critique).

A related quality signal, reported without a fix: AW8's four cited sources
include `יובל פרוקצ'יה על התאוריה של חוזה המתנה` and
`על ערעורי-ביניים, סמכות עניינית ועלות שיפוטית שקועה`, which are off-topic for
a paper on the administrative-promise doctrine. AW7's pool likewise contains
family-court decisions and a piece on youth statistics. So the surviving
doctrinal channel is not only narrow, it is partly filled with topically
unrelated corpus hits — the `local_db` topical binding is scoring on shared
Hebrew stems (`rebinding.reason: shared_meaningful_terms`, scores 5–7) rather
than subject-matter fit.

## 4. Summary

Citation counts are low for three compounding reasons, in this order:

1. **claim-source-match category gating** removes 100% (AW1), 93% (AW4) and 64%
   (AW8) of the refs the drafter actually wrote, because academic blocks are
   declared `court_holding` / `statutory` while the only surviving evidence is
   `doctrinal_secondary`.
2. **Primary-authority acquisition never succeeds** in academic runs
   (`acquisition_success: false`, `acquired_text_length: 0` in all four),
   so the category gate can never be satisfied.
3. **Role-based discovery admission and listing pollution** shrink a 30-candidate
   pool to 4–10 drafter-visible sources before any of this happens.

Rendering, footnote numbering and the rebinding layer are all clean and are not
contributing to the loss. Two answer roles (critique/counter-position and
implementation/example) are absent from the retrieval contract entirely.

No fixes proposed, per the track's scope.
