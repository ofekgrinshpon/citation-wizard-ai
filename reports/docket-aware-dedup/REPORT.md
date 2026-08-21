# docket_aware_url_dedup_v1 — validation (8/8 pass)

| id | branch | used | footnotes | metadata-only holdings | amir 8638/03 in pool | amir used | stub/CPU/verifier fail |
|---|---|---|---|---|---|---|---|
| MAYA | insufficient_sources_limitation | 0 | 0 | 0 | False | False | False/False/False |
| MAYA-BAVLI | insufficient_sources_limitation | 0 | 0 | 0 | False | False | False/False/False |
| MAYA-AMIR | None | 3 | 4 | 0 | True | True | False/False/False |
| R02 | None | 3 | 2 | 0 | False | False | False/False/False |
| P02 | docket_limitation | 0 | 0 | 0 | False | False | False/False/False |
| B8 | canonical_quote_registry | 1 | 1 | 0 | False | False | False/False/False |
| G08 | None | 4 | 5 | 0 | False | False | False/False/False |
| NOISE | None | 3 | 3 | 0 | False | False | False/False/False |

Dedupe key telemetry (pool.url_dedupe) is emitted in the run trace: identity_source_counts, rescued_from_legacy_collapse, and per-candidate rows with original_url / normalized_url_old / dedupe_key / dedupe_identity_params_used / dedupe_identity_source. Confirmed on MAYA-AMIR: gov.il court-spokesman documents that previously shared one host+path key now carry distinct `#<docket>` keys; Supreme Court download URLs key on fileName+path.

Acceptance: distinct court PDFs no longer collapse; בג"ץ 8638/03 entered the pool and was used in MAYA-AMIR; P02 stayed docket_limitation; R02 kept exact body; B8 byte-identical; no metadata-only holdings; no CPU kills, stubs, stale jobs or verifier failures.