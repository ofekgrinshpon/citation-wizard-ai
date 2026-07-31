# Judgment text acquisition for case-law synthesis — validation

Scope: text acquisition only. No planner, verifier, sufficiency, drafter prompt/skeleton,
deterministic-branch, footnote, or snippet-budget changes.

## What changed
- **`stages/judgmentTextAcquisition.ts` (new)** — bounded, deterministic, fail-closed.
  - Trigger: `research_mode = case_law_synthesis` **and** `citable_as = judgment` **and**
    `synthesis_role ∈ {leading, applying, limiting_or_distinguishing}_candidate` **and**
    (`text_usability ∈ metadata_only|unusable|unknown` **or** available text < 400 chars).
  - Attempt order per candidate: `direct_file_fetch` (PDF/DOCX, incl. extension-less court
    `Download?` endpoints, detected via content-type → extension → magic bytes) →
    `local_db_docket_lookup` (docket/title against `legal_documents` + chunks) →
    `wrapper_file_resolve` (court-host HTML page → first downloadable file → extract).
  - Limits: max 2 attempts per answer, 7s per method, 16s per stage, 8MB per file,
    ≥400 chars to count as success, ≤4000 chars stored.
  - On success only: `extended_text` set, `text_usability` → `full_text` /
    `substantive_excerpt`, `has_holding_text` refreshed, flag `judgment_text_acquired`.
    On failure the source is left untouched and logged as acquisition-failed.
- **`lib/attachments.ts`** — exported `extractDocumentText(bytes, "pdf"|"docx")` (reuses the
  existing unpdf/mammoth paths; no behavioural change to attachment extraction).
- **`index.ts`** — stage runs immediately after `buildCandidatePool`, before the verifier;
  integrity telemetry rows refreshed on success; full attempt log emitted under
  `retrieval.judgment_text_acquisition`.

## Telemetry (per attempt)
`title, url, docket_signal, title_signal, synthesis_role, trigger_reason,
methods_attempted, method_succeeded, success, extracted_text_length,
text_usability_before/after, can_support_synthesis_holding, failure_reason, ms`.

## Validation

| Case | mode | acquisition | attempts | success | max snippet | outcome |
|---|---|---|---|---|---|---|
| C2 (run A) | case_law_synthesis | on | 2 | 1 — `direct_file_fetch`, 40,798 chars, `metadata_only → full_text` | **1200** | real line-of-authority synthesis instead of limitation |
| C2 (run B) | case_law_synthesis | on | 2 | 0 (`no_downloadable_file_on_wrapper`, `no_local_document_match`) | 395 | limitation preserved — no thin synthesis from metadata |
| C1 | case_law_synthesis | on | 2 | 0 | 395 | framing correction intact ("אינו מוצג כאן כשם הלכה רשמי") |
| M1 | specific_case | off | 0 | – | 500 | unchanged missing-docket refusal |
| M2 | statute_section_definition | off | 0 | – | 379 | unchanged (§6 statutory text) |
| B8 | canonical_quote | off | 0 | – | – | unchanged canonical quote |
| B2 | specific_case | off | 0 | – | 500 | unchanged missing-docket refusal |

Both acceptance branches are demonstrated by the two C2 draws: when the leading judgment's
file is reachable it becomes `full_text` and spends the 1200-char leading-judgment budget;
when it is not, the system keeps the limitation.

## Cost
Acquisition wall time: 0.3–1.5 s per run (capped at 2 attempts). No stubs, no verifier
failures, no latency explosion in any of the six cases.
