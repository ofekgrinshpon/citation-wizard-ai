# ReLex — Final Beta-Readiness Status Report

Date: 2026-08-22
Product code: **frozen for closed beta** (no open implementation tracks).

---

## 1. Closed tracks

| Track | Status | Outcome |
|---|---|---|
| `missing_docket_limitation_before_empty_candidate_guard_v1` | closed — stable-initial / monitor | deterministic missing-docket refusal evaluated before the empty-candidate guard; no refusal→stub degradation |
| `claim_facet_expansion_v1` | closed — passed | claims decomposed into doctrinal facets with legal-area locks; 12/12 validation Good/Acceptable |
| `footnote_rendering_invariant_v1` | closed — passed | user-facing source list rendered from `footnotes`; 0 dangling markers, 0 orphan rows across 8 queries |
| `source_label_quality_v1` | closed — stable-initial / monitor | filename / bare-institution / near-duplicate title hygiene; title-shape overrides host for statute labelling |
| `commentary_vs_judgment_classification_v1` | closed — stable-initial / monitor | judgment classification requires strong identity; scholarship titles/paths veto; downgraded sources cannot carry holding text |
| `retrieval_budget_enforcement_v1` | **closed — stable-initial / monitor** | hard wall-clock budget, bounded concurrency, binary-sniff rejection, reaper terminal limitation rows |
| `f07_extraction_stability_v1` | closed — passed | one speculative body extraction per run (~1.2 MB), extracted chars charged back to the ledger, F07 terminal in 103s |
| Safety guards (`negativeExistenceGuard`, `metadataOnlyHoldingGate`, canonical quote registry) | closed — active | no doctrine-non-existence from retrieval failure; no metadata-only holdings; byte-identical canonical quotes |

---

## 2. Open non-blocking issues

1. **`source_label_quality_v2_unread_sources`** — raw filenames / weak labels in the
   "sources found but not read" disclosure list (see `reports/BACKLOG.md`).
2. **Retrieval variance / safe over-refusal** — some doctrinal questions alternate between a
   grounded draft and `insufficient_sources_limitation` run to run. Failure mode is safe.
3. **Statute-section acquisition gaps** — official text occasionally unobtainable (403 on PDFs),
   producing a refusal where the section is well known.
4. **Narrow canonical-quote registry** — exact-text guarantees only for registered provisions.
5. **Thinner answers after metadata-only stripping** — correct but occasionally under-elaborated.
6. **Citation pruning** — lists can still include marginally relevant secondary material.

## 3. Blocking issues

**None.** No known fabrication path, no `no_terminal_qa_row` case, no CPU kill / stale worker in
the latest validation set, no metadata-only holdings on drafted answers.

---

## 4. Recommended beta scope

- **Closed, supervised beta.** No public launch, no open sign-up, no marketing surface.
- **5–10 trusted testers**: law students, legal researchers, practising lawyers who understand the
  tool is assistive and verification-required.
- Each tester onboarded directly with an explicit "verify before professional use" statement.
- Collect per session: query text, full answer, cited sources split into read-in-full vs
  reference-only, user rating, structured issue reports.
- **Exit criteria to widen**: zero fabrication incidents, tester-acceptable over-refusal rate,
  no unresolved severity-1 issue report.

## 5. Features safe to expose

- Legal research answers (`legal-research-v1`, Structured Citation Drafter v2.1e).
- Source search mode (`sources_only`).
- Specific-case lookup with deterministic `docket_limitation` refusal and upload invitation.
- Document upload for judgments/statutes as answer input.
- Bibliography generator (unified citation engine).
- Credits, usage dashboard, contact form, legal documents (Terms / Privacy) and acceptance flow.

## 6. Features to label **experimental**

- Academic writing / chapter drafting (separate path, outlines & topic checks only).
- Statute-section exact quoting outside the canonical registry.
- Long compound multi-doctrine questions (highest retrieval variance).
- Any answer carrying a partial-retrieval disclosure banner.

## 7. Operational limits (enforced for beta)

- **One heavy legal-research job per user at a time.** Concurrent submissions are rejected or
  queued, not run in parallel.
- **Sequential validation.** Internal validation/regression runs execute one query at a time;
  no batch parallel launches.
- **Partial-retrieval disclosure enabled.** Whenever the budget cuts retrieval or extraction short,
  the Hebrew limitation notice is appended to the answer.
- Retrieval wall-clock budget 180–220s; bounded worker concurrency (4); one speculative body
  extraction per run (~1.2 MB); reaper converts killed runs into terminal limitation rows.

## 8. Final recommendation

**Yes — proceed to closed beta.** All blocking safety and stability tracks are closed, every
known failure mode is either a safe refusal or a disclosed limitation, and the remaining issues
are cosmetic or quality-of-answer items suited to post-beta work under supervision.
