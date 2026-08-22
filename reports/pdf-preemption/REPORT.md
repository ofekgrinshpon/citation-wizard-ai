# large_pdf_extraction_preemption_v1 — validation

Runner: `scripts/legal-research-v1-pdf-preemption-validation.ts`
Deployed build: `legal-research-v1` (preflight + text-endpoint-first URL order).

| ID  | Result | Wall | Phase | Branch | Notes |
|-----|--------|------|-------|--------|-------|
| R02 | PASS | 181s | P5 | — | ע"א 6821/93 answered with real holdings. Previously CPU-killed / >600s stall. |
| F06 | PASS | 152s | P5 | — | 5 markers / 5 footnotes, invariant clean. Previously reaper-closed. |
| F07 | PASS | 90s | P5 | insufficient_sources_limitation | Terminal, no extraction stall. |
| P02 | PASS | 131s | P5 | docket_limitation | Deterministic refusal preserved. |
| B8  | PASS | 151s | P5 | canonical_quote_registry | Byte-identical canonical quote. |

Acceptance: 5/5 terminal, zero CPU kills, zero reaper interruptions, zero
dangling markers / orphan source rows, no stubs, no verifier failures.

Notes:
- No run needed the new `exact_case_body_unavailable` branch — reordering the
  derived court URLs so text endpoints (`type=2`, `.htm`) are probed before the
  mislabeled `type=4` 2.34 MB PDF was sufficient for R02. The preflight remains
  as the fail-closed backstop for the cases where only a binary exists.
- F07's thin answer is source-quality (open backlog item
  `source_label_quality_v2_unread_sources`), not a stability defect.
