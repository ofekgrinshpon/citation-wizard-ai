# ReLex — Closed Beta Readiness Package

Status: **product code frozen for closed beta**.
Track `missing_docket_limitation_before_empty_candidate_guard_v1` — closed as **stable-initial / monitor**.
No new implementation tracks open before beta.

---

## 1. Final pre-beta validation summary

| Control | Expectation | Result |
|---|---|---|
| P02 — fake docket `ע"א 99887-04-22` | deterministic `docket_limitation`, no stub | **PASS** — branch `docket_limitation`, real refusal text, 0 sources, no placeholder |
| R02 — `ע"א 6821/93` בנק המזרחי | draft from exact requested judgment body | **PASS** — 1 body-acquired judgment, `text_usability: full_text`, `sufficiency_used_acquired_body: true` |
| B8 — canonical quote, סעיף 1 לחוק-יסוד: כבוד האדם וחירותו | byte-identical canonical text | **PASS** — branch `canonical_quote_registry`, answer byte-identical to baseline across reruns |
| metadata-only holding gate | active on drafted answers | **ACTIVE** — `gate_report.applied`, `metadata_only_holdings_remaining: 0` on all drafted runs |
| negative-existence guard | active on all drafted answers | **ACTIVE** — retrieval failure never rendered as doctrine non-existence; phrasing scoped to "במקורות שאותרו" |
| Run health | no CPU kills / stale rows / stubs / verifier failures | **CLEAN** — `cpu_kill: false`, `is_stub: false`, `verifier_failed: false`, `placeholder_rows_rejected: 0` across the latest validation set |

Branch ordering invariant now enforced: deterministic missing-docket refusal is evaluated **before** the generic empty-candidate guard, so identity/integrity filtering can no longer degrade a refusal into a stub.

---

## 2. Known limitations for beta

1. **Retrieval variance can still cause safe over-refusals.** G07 (מבחן ההשתלבות) and G08 (מבחני מידתיות) alternate between a grounded draft and `insufficient_sources_limitation` depending on what retrieval returns in that run. The failure mode is safe (refusal, not fabrication) but inconsistent.
2. **Statute-section acquisition is incomplete.** G11-class questions can fail to obtain official statute text (e.g. 403 on the official PDF), producing a refusal even where the section is well known.
3. **Canonical registry coverage is narrow.** G12-class quote requests fall outside the registry, so exact-text answers are only guaranteed for the small set of registered provisions.
4. **Some answers may be thinner after metadata-only stripping.** The holding gate removes propositions supported only by metadata-level judgment records; the result is shorter and occasionally under-elaborated relative to what a human would write from the same case list.
5. **Source-soup and title recovery still need polish.** Generic gov/court documents sometimes surface with unhelpful titles, and citation lists can still include marginally relevant secondary material.

---

## 3. Beta UI requirements

The beta interface must make the evidentiary state of every answer visible, not inferred:

- **Sources read in full** — explicit list of sources whose body text was acquired and used (`read_in_full`), labelled as such.
- **Reference-only sources** — separately grouped, visually distinct, with a plain-language note that they were not used to support any holding.
- **Limitations / missing-source notices** — surfaced as a first-class banner on the answer whenever a deterministic branch fires (`docket_limitation`, `insufficient_sources_limitation`, statute-section not located, canonical quote unavailable), including the invitation to upload the judgment/document.
- **User feedback buttons** — per-answer rating plus a one-click "report an issue" that captures the run identifiers alongside the free-text note.

---

## 4. Beta scope

- **Closed, supervised beta only.** No public launch, no open sign-up, no marketing surface.
- **5–10 trusted testers**: law students, legal researchers, practising lawyers who understand the tool is assistive and verification-required.
- **Supervision**: each tester onboarded directly, with an explicit statement that answers must be verified before any professional use.
- **Collect per session**: query text, full answer, cited sources with their read-in-full/reference-only split, user rating, and structured issue reports.
- **Exit criteria to consider widening**: no fabrication incidents, over-refusal rate acceptable to testers, and no unresolved severity-1 issue reports.

---

## 5. Post-beta backlog (ranked)

1. **Retrieval variance / topical sufficiency** — make grounded drafting deterministic for well-covered doctrinal questions; highest impact on perceived quality.
2. **Statute-section acquisition** — reliable official-text acquisition and section location.
3. **Citation pruning / source-soup** — fewer, better, more authoritative citations per answer.
4. **Title recovery** — human-meaningful titles for generic gov/court documents.
5. **Court PDF extraction hardening** — remove remaining CPU-hotspot risk and improve extraction fidelity on large scanned files.
