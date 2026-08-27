# doctrinal_secondary_body_acquisition_v1 — Acceptance Report

**Verdict: ACCEPTED.** The doctrinal fallback is no longer inert: acquired
secondary bodies now reach the drafter and support limited doctrinal answers,
with judgment/statute safety unchanged.

## What was implemented

New stage `stages/secondaryBodyAcquisition.ts`, wired in `index.ts` after
official-source discovery and before specific-case resolution.

For candidates **already admitted to the pool** (no new discovery), classified
as secondary/doctrinal (type, doctrinal text signal, academic/institutional
host, or scholarship/report role), it obtains substantive text in order:

1. local corpus (`legal_documents` content, else its first chunks),
2. verified-source cache body (`verified_legal_source_texts`, read-only),
3. one bounded open-web fetch (browser-profile `officialFetch`, PDF/DOCX/HTML
   extraction through the existing `postExtract` limits).

Acquired text is attached as `extended_text` + `secondary_body_acquired`, which
`drafter.ts` now maps into `body_acquired` / `topical_text`, and
`doctrinalSourceTyping.ts` now accepts (a body we extracted ourselves counts
even when the candidate was first surfaced by Perplexity).

Bounds: modes `broad_research` / `academic_research` / `narrow_doctrine` only;
8 local lookups, 3 web fetches, 10s per attempt, 20s stage, 3 MB / 2 MB
extraction caps, ≥800 chars to count as substantive, 16k stored.

## Safety guarantees (unchanged behaviour)

- Judgments, statutes and anything `citable_as` judgment/statute are excluded.
- Court/relay/paywalled hosts (`court.gov.il`, `nevo`, `takdin`, …) and
  login/subscribe URLs are never fetched here. No relay slot is consumed.
- Non-200, block page, binary-not-extractable, or sub-threshold text = failure;
  the candidate stays **bibliography-only** and cannot support a claim.
- Docket validation, verified-cache identity rules and primary-law integrity
  are untouched. Fail-closed everywhere.

## Validation

| Q | depth | secondary acquired | sufficiency | fn | note |
|---|---|---|---|---|---|
| D1 | broad_research | 3 (local) | `limited_doctrinal_fallback_B: two_doctrinal_secondaries` | 1 | fallback fires for the first time |
| B8 | narrow_doctrine | remap=1, eligible=2 | `doctrinal_anchor_present` | 1 | previously `insufficient_sources_limitation` |
| ACADEMIC | academic_research | eligible=1 | `statutory_procedural_pack_present` | 0 | no regression |
| FRESH-SC | specific_case | stage not run (mode) | `shape_not_gated` | 0 | unchanged |
| R02 | specific_case | stage not run (mode) | — | 0 | `docket_limitation` preserved |
| P02 (fake docket) | specific_case | stage not run (mode) | — | 0 | refusal preserved |

Before this track `doctrinal_eligible_count` and `typing_remapped_count` were 0
in all nine runs. Telemetry now lands in
`metadata.drafter.doctrinal_sufficiency_trace.secondary_*` plus the full
per-candidate report under `metadata.retrieval.secondary_body_acquisition`.

## Follow-ups

- Web lane produced 0 successes in this sample (local corpus satisfied D1);
  worth re-measuring on questions whose doctrinal sources are off-corpus.
- Consider persisting acquired secondary bodies to the corpus for reuse.
