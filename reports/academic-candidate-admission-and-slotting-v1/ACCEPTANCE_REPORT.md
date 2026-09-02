# academic_candidate_admission_and_slotting_v1 — acceptance report

No rescue lane was added. All changes act at the **original** admission /
slotting decision points inside `stages/perplexityRetrieval.ts`, plus a new
status derivation for primary-anchor acquisition.

## What was implemented

1. **Original-gate scholarship review** — `stages/academicCandidateAdmission.ts`
   (`evaluateScholarshipAdmission`). Academic runs only. A `class_unknown`
   candidate is admitted as scholarship only with **topical fit + credible
   provenance + ≥2 independent academic signals**, and no aggregator / listing /
   SEO / commercial signal. Provenance = academic publisher host, university or
   faculty host, institutional scholarly repository host (`digitalcommons.`,
   `scholarship.`, `escholarship.`, `eprints.`, …), narrow recognized
   research-institute allow-list (IDI, Taub, INSS, Van Leer, Kohelet, ACRI, …),
   repository/publications path, or DOI. Metadata-only material stays
   `reference_only`. Telemetry: `academic_scholarship_admission_gate`.
2. **Cross-language topical fit** — a Hebrew question could never match an
   English-titled comparative article, so every OUP / Cambridge / Osgoode
   proportionality paper was scored `off_topic`. A general legal concept
   lexicon (~36 HE↔EN pairs: מידתיות↔proportionality, פסקת הגבלה↔limitation
   clause, הסתמכות↔reliance, …) now expands topic terms in both directions. No
   question-specific or source-specific entries; generic single words
   ("review") were deliberately excluded to avoid false matches.
3. **Role slotting before rejection** — `resolveAcademicRoleSlot` re-slots a
   candidate that fails the planner's slot into a **secondary** role only
   (`scholarship` / `government_report` / `factual_report`); never into
   `primary_statute` / `binding_case_law`. Telemetry:
   `academic_role_slotting_decision`.
4. **Primary-anchor acquisition status** —
   `stages/primaryAnchorAcquisitionStatus.ts` distinguishes `not_found`,
   `metadata_only`, `body_received_extraction_failed`, `http_200_mislabeled_reset`,
   `identity_mismatch`, `budget_or_time_cap`, `network_or_origin_failure`,
   `acquired_identity_verified`. `lib/officialFetch.ts` now records
   `body_read_started` / `body_read_failed`, so an HTTP 200 whose body read
   fails is no longer reported as a connection reset. Only an
   identity-verified substantive body is `usable_primary_anchor`. Telemetry:
   `academic_primary_anchor_acquisition_status`.
5. **Role-aware pack summary** — `summarizeAcademicPackAdmission` reports
   `admitted_by_role`, `final_pack_roles`, `rejected_by_reason`,
   `role_diversity_score`. Admission is role-aware, not count-driven.

Safety preserved: judgment identity validation, metadata-only holding gate,
found-only support, source-integrity classes, 400-char citable floor, footnote
invariants — all untouched. No new retrieval, no candidate-count increase.

## Tests

`bunx vitest run` — **19 files / 197 tests passed**, including 23 in
`src/test/academicCandidateAdmission.test.ts` (admission, rejection safety,
cross-language fit, repository hosts, institute provenance, role slotting, all
eight primary-anchor statuses).

## Validation (post-deploy, live runs)

| fixture | genre | reviewed | admitted | rejected | reslots | footnotes | primary usable |
|---|---|---:|---:|---:|---:|---:|---:|
| AW4 (proportionality) run `3cec4fcc` | theoretical_background | 17 | 5 | 12 | 13 | 5 | 0 |
| AW4 repeat run `92a701da` | theoretical_background | 0 | 0 | 0 | 0 | 2 | 0 |
| AW1 | introduction | 8 | 1 | 8 | 9 | 3 | 0 |
| AW7 | argument_paragraph | 4 | 0 | 4 | 4 | 1 | 1 |
| AW8 | generic_academic | 1–3 | 0 | 1–3 | 1–3 | 3–4 | 1 |
| AW9 (reliance / legitimate expectation — non-proportionality) | theoretical_background | 2–6 | 1 | 2–6 | 2–7 | **4** (was 0) | 0 |

Gate behaviour observed on real candidates:

* **Admitted**: IDI "מידתיות במבט ביקורתי ומשווה" (institute host + document
  body + scholarly title), Digital Commons / faculty-repository articles once
  cross-language fit landed, a Gov.il policy document re-slotted
  `binding_case_law → government_report`.
* **Rejected, correctly**: hilan.co.il, abg-group.co.il, jus-tice.co.il,
  news1.co.il (listing), wikidemia.co.il, an `israeliconstitutionalism`
  WordPress blog, judgments.org.il aggregator, fliphtml5.
* No candidate was ever re-slotted into a primary role
  (`no_safe_academic_slot` fires instead).

## Value assessment

* **AW9 is the clearest win**: 0 → 4 footnotes on a non-proportionality
  theoretical-background question, entirely from admission/slotting, with no
  new retrieval.
* **AW4 improved but is unstable**: 5 footnotes with five admitted scholarship
  sources in one run, 2 footnotes with zero reviewed candidates in the repeat.
  The variance is upstream (retrieval/nomination returned a different candidate
  mix), not in the gate.
* **Remaining weaknesses, out of this track's scope**:
  1. **Primary anchors still rarely usable** — AW4's Basic Law fetch reported
     `body_received_extraction_failed` (`statute_extraction_budget_spent`) and
     `unsupported_statute_source`. The new status telemetry now names this
     precisely; fixing statute-text extraction is the highest-value next step.
  2. **Retrieval variance** across identical AW4 runs.
  3. **Footnote label duplication** — AW4 footnotes 2 and 3 share one URL with
     different concatenated labels.

## Recommendation

Do **not** move to Hebrew naturalness yet. Next track, in order:
`statute_and_primary_text_acquisition_stability_v1` (make the nominated Basic
Law / statute body actually acquirable), then retrieval-variance reduction for
academic runs. Prose polish should be evaluated only on answers that reliably
carry a primary anchor.
