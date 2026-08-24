# judgment_search_first_discovery_v1 — Acceptance Report

Scope: main fix (search-first judgment discovery) + prerequisite 1 (verified cache upsert) + prerequisite 2 (negative cache scoped by strategy/version).
Validation sequence: R02, D1, D3, MAYA, MAYA-AMIR, NATION-STATE, P02, B8 (8/8 terminal).

## Results table

| ID | Terminal | Branch | Discovery targets | Bodies acquired | Cache writes | Footnotes | Dangling markers | total_ms |
|----|----------|--------|-------------------|-----------------|--------------|-----------|------------------|----------|
| R02 | yes | docket_limitation | 2 | 2 | 2 | 0 | 0 | 164,468 |
| D1 | yes | insufficient_sources_limitation | 2 | 0 | 0 | 0 | 0 | 104,195 |
| D3 | yes | — | 2 | 0 | 0 | 1 | 0 | 135,862 |
| MAYA | yes | — | 2 | 0 (retrieval already had bodies) | 0 | 2 | 0 | 152,532 |
| MAYA-AMIR | yes | — | 2 | 0 | 0 | 2 | 0 | 146,619 |
| NATION-STATE | yes | — | 0 | 0 | 0 | 1 | 0 | 112,613 |
| P02 | yes | — | 0 | 0 | 0 | 0 | 0 | — |
| B8 | yes | canonical_quote_registry | 0 | 0 | 0 | 1 | 0 | 83,229 |

## Prerequisite 1 — verified cache upsert: PASS

R02 wrote **2 verified bodies** to `verified_legal_sources` (`cache_written: true`, 1,353 and 1,314 chars, path `statute_official_url`). Before the migration every write failed on `ON CONFLICT`. The generated `dedupe_docket` / `dedupe_statute_title` / `dedupe_statute_section` columns plus the matching unique index (`verified_legal_sources_dedupe2_idx`) now let PostgREST infer the conflict target. No `cache_write_error` on any attempt in the sequence.

## Prerequisite 2 — strategy-scoped negative cache: PASS

Every judgment attempt reports `cache_lookup: miss` and `ignored_other_strategy_failures ≥ 0` with the search-first lane executing anyway (D1: `ignored_other_strategy_failures: 1`). Legacy deterministic-derivation failures no longer suppress the new `search_first` strategy — cooldowns only bite when `discovery_strategy` **and** `discovery_version` both match.

## Main fix — search-first judgment discovery: PARTIAL PASS

Search-first ran on every actionable judgment target that lacked a retrieved body and **always found official URLs**:

- D1 — בג"ץ 1715/97 לשכת מנהלי ההשקעות: 1 official URL (4 candidates resolved on supremedecisions.court.gov.il), 4.2 s.
- D3 — בג"ץ 1000/92 בבלי: 1 official URL.
- MAYA-AMIR — בג"ץ 8497/00 סימה אמיר: 4 official URLs.

So the *discovery* half of the track works: docket hints and party-name searches both resolve to genuine official Supreme Court document URLs, and the mirror lane was never needed (`mirror_urls: 0` everywhere).

The *acquisition* half is blocked downstream:

- `blocked_by_origin: חסימת בקשה לא מורשת` on D1 and D3 — supremedecisions.court.gov.il rejects the edge-function fetch (origin/UA gating on `Home/Download`).
- `extraction_budget_spent` on MAYA-AMIR — 4 official URLs were found but the retrieval governor had already consumed its extraction budget before the discovery lane ran.

Net: **0 judgment bodies acquired** in this sequence, versus 2 statute bodies acquired and cached. No regression — the pipeline degraded correctly in every case.

## Safety behaviour: PASS (no regressions)

- **Zero dangling footnote markers** across all 8 runs.
- R02 (landmark, no usable primary text) → `docket_limitation`, 0 footnotes: refusal preserved rather than answering from scholarship.
- D1 → `insufficient_sources_limitation` with an explicit "no direct case law found" notice, no doctrine invented from adjacent areas.
- B8 → `canonical_quote_registry`, exact statutory text with 1 official footnote, unaffected by discovery.
- P02 (non-existent docket) → 0 footnotes, refusal preserved.
- MAYA / MAYA-AMIR / D3 / NATION-STATE answered with 1–2 footnotes each — the hierarchy discipline held (no source soup).

## Verdict

Track status: **stable-initial / monitor**. Both prerequisites are fully fixed and merged. Search-first discovery is correct and reliably produces official URLs, but judgment bodies still do not land because of two independent downstream blockers.

## Follow-ups (next narrow tracks)

1. `official_origin_fetch_unblocking_v1` — supremedecisions `Home/Download` returns "חסימת בקשה לא מורשת" for our fetch. Needs a browser-like request profile (Referer + session cookie from the case page, UA, Accept headers) or an approved proxy/mirror path. This is the single highest-value unlock: it converts already-found URLs into real judgment bodies.
2. `discovery_budget_priority_v1` — MAYA-AMIR proves ordering is wrong: exploratory web extraction spends the budget before the actionable named-judgment lane runs. Reserve extraction budget for actionable discovery targets.
3. `statute_official_url_coverage_v1` — D1's חוק-יסוד: כבוד האדם וחירותו hit `unsupported_statute_source:no_official_statute_url` even though B8's canonical registry serves the same statute. Wire the canonical registry into the statute discovery lane.
