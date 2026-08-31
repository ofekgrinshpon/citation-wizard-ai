# academic_utilization_stabilization_v1 — validation

Deployed to `legal-research-v1`; validated on AW1 / AW4 / AW7 / AW8.

## What changed

1. **Rule D demoted for academic fit** (`claimSourceMatch.ts`) — a legal-area
   mismatch on an academic claim category is kept with a warning when the source
   passes topical fit, plays the block's role, and is `direct` or a strong
   partial (on topic + role match + no better direct source). Court-holding and
   statutory blocks keep the hard rule.
2. **Bibliography-only reading pointers** (Rule B exception) — a real
   bibliographic item with no acquired body may stay in a literature /
   framing / methodological block (or a critique block with pointer wording) as
   `reference_only`. Its footnote renders as "לדיון נוסף ראו: …" and it can
   never support a substantive proposition.
3. **Hebrew rebinding hardening** (`claimSourceRebinding.ts`) — plural /
   construct / possessive suffix normalization, loose-stem matching, and two new
   binding paths: `shared_title_subject_terms` (title/snippet subject overlap)
   and `academic_direct_subject_fit`.
4. **Drafter coverage instructions** — academic runs are told to cite every
   substantive block when a fitting source exists, prefer scholarship for
   theory/critique, and use bibliography-only items as pointers only.
5. **Telemetry** — `rule_d_area_overrides`, `bib_reference_uses`,
   `hebrew_rebinding`, `source_coverage` under
   `drafter.claim_source_match.academic_authority_alignment`.

## Results

| run | genre | footnotes | emitted → kept | Rule D | bib pointer | coverage (blocks with ref / with available source) |
|-----|-------|-----------|----------------|--------|-------------|------------------|
| AW1 | introduction | 3 | 8 → 5 | — | 0 kept | 4 / 6 |
| AW4 | theoretical_background | 4 | 11 → 8 | 1 kept_with_warning, 1 dropped | 1 kept (`s2`) | 5 / 6 |
| AW7 | argument_paragraph | 1 | 3 → 1 | — | 0 kept | 1 / 1 |
| AW8 | generic_academic | 1 | 1 → 1 | — | — | 1 / 5 |

No safety regressions: every Rule D override was on an academic category with
topical fit, and the single reference-only ref is rendered as a reading pointer.

## Open item (monitor)

AW8 emitted only one `source_refs` entry for six substantive blocks — the loss
is upstream of the gate (drafter emission), not in matching. Coverage telemetry
now measures it (`no_ref_emitted_by_drafter`).
