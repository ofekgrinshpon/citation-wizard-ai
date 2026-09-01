# academic_drafter_source_ref_coverage_v2 — acceptance report

Deployed to `legal-research-v1`; validated live on AW1 / AW4 / AW7 / AW8.

## What changed (drafter prompt + telemetry only)

New module `stages/academicSourceRoleMap.ts`:

1. **Light citation-use section** for `topic_presentation`, `generic_academic`,
   `research_question`, `chapter_outline` — the genres that previously received
   no citation guidance at all. It states: cite substantive doctrinal /
   theoretical / literature / critique / methodological blocks when a role-fit
   source exists; never cite connective or roadmap sentences; never cite to
   raise a count; one source may carry adjacent blocks; a deliberately
   unsupported block is phrased cautiously; the output stays short.
2. **`source_role_map`** derived from metadata already in the pack
   (`profileSource`, `classifyAcademicSourceRoles`, `CATEGORY_TO_ROLE`,
   `academicTopicalFit`). Per source: ref, title, source role, matching academic
   block categories, supported_points, `full_body` vs `reference_only`, and
   allowed use (`substantive` / `literature_pointer` / `primary_only` /
   `not_for_binding_law`). Rendered into the academic source-use section.
3. **Block-coverage rule** (not a count target): a substantive academic block
   with a mapped eligible source emits at least one `source_ref`; with no
   mapped source, nothing is invented and no off-topic source is cited;
   reference-only items appear only in literature / framing / methodology
   blocks with pointer wording.
4. **Telemetry**: `academic_drafter_source_ref_emission` (measured on the
   pre-CSM draft) and `pre_csm_source_ref_filtering`, both under
   `metadata.drafter` in `qa_logs`.
5. Presentation fix: internal block tags (`(claim_id: …, claim_category: …)`)
   the model occasionally echoed into prose are now stripped alongside `s{n}`
   tokens.

Nothing in retrieval, discovery, acquisition, CSM rules, authority alignment,
identity validation, footnote rendering, sufficiency or citation-count policy
was touched.

## Results

| run | genre | substantive blocks | blocks with mapped source | blocks with emitted ref | missing despite mapping | model refs | rendered footnotes | answer len |
|-----|-------|----|----|----|----|----|----|----|
| AW1 | introduction | 8 | 8 | 7 | 1 | 16 | 2 | 3,829 |
| AW4 | theoretical_background | 5 | 5 | 5 | 0 | 9 | 1 | 4,025 |
| AW7 | argument_paragraph | 1 | 1 | 1 | 0 | 3 | 1 | 1,318 |
| AW8 | generic_academic | 5 | 5 | 5 | 0 | 10 | **5** | 1,989 |

Pre-CSM filtering, reported separately:

| run | unknown refs (schema) | metadata-only holding gate drops | CSM drops |
|-----|---|---|---|
| AW1 | 0 | 0 | 9 |
| AW4 | 0 | 2 | 5 |
| AW7 | 0 | 0 | 2 |
| AW8 | 0 | 0 | 2 |

## Acceptance

- **AW8 no longer emits a single ref** — 5/5 substantive blocks carry a
  `source_ref` and 5 footnotes render (previously 1 ref / 1 footnote), with no
  retrieval change and no CSM change.
- `topic_presentation` / `generic_academic` now receive citation-use
  instructions plus the role map.
- **AW7 stays short** (1,318 chars, one paragraph, one footnote) — not
  over-cited.
- No fixed footnote-count target exists anywhere in the new code; the rule is
  per-block eligibility only.
- No secondary source carries a holding, statutory text, docket outcome,
  canonical quote or binding-law claim: the map marks every non-primary source
  `not_for_binding_law`, and the unchanged CSM / authority-alignment gates still
  enforce it (AW1 9 drops, AW4 5, AW7 2, AW8 2).
- Pre-CSM stripping (`structured_validation_unknown_refs`,
  `metadata_only_holding_gate_drops`) is reported separately from CSM drops.
- Rendering invariants clean: sequential superscripts, no bullets in prose
  genres, no raw URLs, no internal `s{n}` or block tags in the body.

## Monitor

AW1 leaves one `doctrinal_background` block uncited despite three mapped
sources (`missing_ref_reasons: no_ref_emitted_by_drafter`); AW4's rendered
footnote count (1) is far below its 9 emitted refs — that loss is entirely
inside the unchanged CSM gate, now visible in `pre_csm_source_ref_filtering`.
