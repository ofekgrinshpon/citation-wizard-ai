# academic_declared_category_remap_and_body_acquisition_v2 — acceptance report

Validation set: AW1, AW4, AW7, AW8 (live runs against the deployed
`legal-research-v1`, academic_writing path).

## What changed

1. **Declared-category remap (`stages/claimSupportCategory.ts`)** — in academic
   runs the drafter's declared `claim_category` is no longer trusted. Wording
   cues (critique / methodology / literature / theory) plus `proposition_type`
   pick an academic category. `scholarly_commentary` maps directly to
   `literature_synthesis`. The docket-identity and binding-language escalations
   still run *after* the remap, so any block that asserts binding law or names a
   concrete judgment is pushed back to `court_holding` / `statutory` and still
   requires acquired primary authority.
2. **Bounded short-body re-acquisition (`stages/secondaryBodyAcquisition.ts`,
   `index.ts`)** — academic runs give up to 3 verifier-`direct` candidates whose
   acquired body is a stub (<1500 chars) ONE extra acquisition attempt
   (3 local lookups / 3 web attempts / 9s, inside the retrieval budget).
3. **Doctrinal-anchor sufficiency fix (`stages/sourceSufficiency.ts`)** — an
   academic-writing plan that merely *prefers* primary law no longer forces a
   refusal: with ≥1 acquired, on-topic, verifier-direct doctrinal body and no
   explicit docket / holding / statute-section request and no missing anchor,
   the run proceeds as a limited academic draft
   (`academic_writing_doctrinal_anchor_allowed`).
4. **Pack-level subject-matter fit (`stages/academicAuthorityAlignment.ts`,
   `stages/drafterV2.ts`)** — sources sharing no meaningful subject vocabulary
   with the question are removed from the drafter pack before prompting; never
   acquired primary authority, and never below a 3-source floor.

## Results

| run | branch | footnotes | declared remaps | refs dropped by authority category | pack-fit drops |
|-----|--------|-----------|-----------------|------------------------------------|----------------|
| AW1 | normal draft | 3 | 6 (contextual/doctrinal/court_holding/commentary → academic) | 0 | 0 |
| AW4 | normal draft | 3 | 6 | 1 | 0 |
| AW7 | academic_limited_draft | 1 | 1 | 1 | 2 (off-topic book front-matter + unacquired judgment) |
| AW8 | academic_limited_draft | 3 | — | 0 | 0 |

Key deltas versus the previous cycle:

- **AW8 no longer refuses.** Previously `insufficient_sources_limitation`
  (plan asked for `requires_judgment_body`, doctrinal bodies existed but were
  not counted as anchors); now a limited academic draft with 3 footnotes.
- **Category gating no longer strips by construction.** AW1 ends with
  `refs_dropped_by_authority_category = 0` and academic categories in use
  (`methodological_framing`, `theoretical_explanation`,
  `critique_or_counterposition`, `literature_synthesis`,
  `doctrinal_background`) instead of legacy `court_holding` tags.
- **Primary-law safety unchanged.** `declared_categories_kept_primary` counts
  every remap re-escalated by binding language or docket identity;
  `doctrinal_secondary_refs_rejected_for_primary_claims` stayed at 0 because no
  block asserted binding law without primary text, and the primary-language
  guard remains in place for those that do.

## Telemetry added

`drafter.claim_source_match.academic_authority_alignment`:
`declared_categories_remapped`, `declared_category_remaps[]` (block, from, to,
basis), `declared_categories_kept_primary`, `pack_fit_dropped[]`.
`drafter.academic_short_body_reacquisition`: ran / reason / candidate_ids /
acquired / stop_reason / ms.

## Tests

`bunx vitest run` — 166 tests passing, including 4 new cases covering the
remap, the binding-language escalation, the docket escalation, and the
non-academic no-remap invariant.

## Known residuals

- AW7 (argument paragraph) still cites thinly: its single block's only
  candidate ref was not doctrinally eligible, so the authority category dropped
  it. This is a retrieval/eligibility issue, not a gating one.
- `theoretical_normative_source` is the role most often unfilled in the
  academic source mix.
