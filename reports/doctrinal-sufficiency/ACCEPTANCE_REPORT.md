# substance_based_doctrinal_sufficiency_v1 — Acceptance Report

Date: 2026-08-26 · Function: `legal-research-v1` · Verdict: **ACCEPTED (conditional — fallback path unexercised)**

Telemetry prerequisite: `doctrinal_sufficiency_telemetry_persistence_v1`
(see `TELEMETRY_PERSISTENCE_ACCEPTANCE.md`) — ACCEPTED. All results below are
attributable to a named stage and reason.

## Scope delivered

1. **Substance-based claim categories** — `stages/claimSupportCategory.ts`:
   `court_holding`, `statutory`, `doctrinal_synthesis`, `scholarly_commentary`,
   `contextual_background`, derived from the drafter's substance tag →
   `proposition_type` → structural docket escalation. No phrase lists.
2. **Doctrinal source typing** — `stages/doctrinalSourceTyping.ts`: acquired
   `other` sources are remapped to doctrinal types only with an acquired body and
   passing integrity; Perplexity-only, metadata-only, snippet-only, listing and
   block pages are excluded.
3. **Mode-aware sufficiency fallback** — `stages/sourceSufficiency.ts`:
   combinations A (statute + doctrinal secondary), B (two doctrinal secondaries),
   C (acquired doctrinal secondary + topical authority), gated to broad/academic
   depth modes only.
4. **Authority-level control** — drafting instructions keep secondary sources from
   being phrased as binding holdings; `authority_overstatements` telemetry.
5. **Safety preserved** — no change to docket/identity validation, cache,
   relay, or primary-law integrity.

## Validation results (9 queries, post-telemetry re-run)

| Run | fn | depth_mode | outcome | attribution |
|-----|----|-----------|---------|-------------|
| D1 | 1 | broad_research | answered | sufficiency passed (`case_law_synthesis_supported`), 6 blocks categorized |
| B8 | 0 | narrow_doctrine | refusal | fallback correctly declined `depth_mode_not_broad` |
| D3 | 0 | broad_research | answered, no citation survived | claim-match ran; per-claim matching kept no citable source |
| ACADEMIC | 0 | academic_research | answered, no citation survived | sufficiency passed; claim-match kept no citable source |
| FRESH-SC | 0 | specific_case_or_statute | control unchanged | `shape_not_gated` |
| R02 | 0 | specific_case_or_statute | refusal | `docket_limitation` — identity hardening intact |
| NATION-STATE | 0 | specific_case_or_statute | control unchanged | `shape_not_gated` |
| P02 (fake docket) | 0 | specific_case_or_statute | refusal | `docket_limitation` — safe |
| MAYA-AMIR | 0 | specific_case_or_statute | refusal | `docket_limitation` |

- `authority_overstatements`: **0** across all runs — no secondary source was
  phrased as a binding holding.
- `limited_doctrinal_answer`: **false** everywhere; no fallback combination fired.
- `typing_remapped_count`: **0**; `doctrinal_eligible_count`: **0**.
- Safety controls unchanged: every specific-case run with no usable judgment body
  refused rather than substituting commentary.
- No CPU kills, stubs, dangling markers or orphan source rows in the reported runs
  (one transient stale in-progress row on a first P02 attempt; re-run clean).

## Assessment

The patch is **safe and behaviourally neutral where it matters**: no refusal was
converted into an unsupported answer, no court-holding block was supported by a
secondary source, and all identity/docket guardrails held.

It is **not yet demonstrated to improve recall**, because the fallback never fired:
in all 9 runs the eligibility gate found zero qualifying secondaries, with reasons
`no_acquired_body_text` and `not_doctrinal_type`. Doctrinal/scholarly candidates
are reaching the drafter as metadata-only search hits.

## Recommended next track

`doctrinal_secondary_body_acquisition_v1` — acquire body text for nominated
scholarly/doctrinal sources (journal and repository pages already discovered by
nomination) so the eligibility gate has material to evaluate. Until then the
fallback stays default-on but inert, which is the safe state.
