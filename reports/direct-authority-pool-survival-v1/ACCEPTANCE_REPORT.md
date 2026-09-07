# direct_authority_pool_survival_v1 — Acceptance Report

**Verdict: pass on the stated acceptance criterion.** Origin-diversity capping is
now a soft pool-shaping constraint: a materially stronger direct authority is no
longer discarded on origin grounds alone, and diversity is preserved.

## What was implemented

`stages/candidatePool.ts` (only file with behaviour change):

- Deterministic `isDirectAuthority(c)` built from **existing** signals only —
  discovery-precision protection reasons (`exact_docket_identity`,
  `judgment_document`, `official_primary_page`, `official_statute_page`,
  `exact_authority_candidate`), source-integrity `is_judgment_document`, and the
  already-computed `classified_source_class` (`court_case` / `judgment` /
  `legislation` / `official_primary`). Listing-like candidates are excluded.
- A backfill candidate hitting the origin cap is admitted only if it is
  **materially stronger** (≥ 0.05 effective score) than the weakest already
  admitted candidate from another origin.
- Bounded: at most `ceil(POOL_CAP*0.4)` exemptions per run, and exemptions stop
  once 70 % of the pool is filled, so ordinary diversity shaping keeps the rest
  of the slots. All dedupe, integrity, vector quotas, pool size and every
  downstream gate are unchanged.
- Telemetry: `retrieval.pool.authority_exemption {budget, used, origin_cap_used,
  rows[]}` persisted per run.

No change to retrieval/queries, web classification, body acquisition, verifier,
CSM/alignment, drafter, topicality, canonical registry or source-count targets.
Tests: `src/test/directAuthorityPoolSurvival.test.ts` (5) — survival, bounded
telemetry, diversity preserved, non-authority still capped, global cap honoured.
Full suite and app typecheck clean; function deployed.

## Which candidates previously occupied the capped slots

From the previous run `b380192a-…` (first attempt, budget 6): 97 candidates were
dropped as `backfill_origin_diversity_cap` with `origin cap = 1`, including
בג"ץ 1000/92 בבלי, בג"ץ 3914/92 לב, בג"ץ 5699/07, חוק שיפוט בתי דין רבניים
תשי"ג-1953, בג"ץ 8638/03 סימה אמיר, plus several rabbinical-court judgments —
while the admitted pool held low-scored local vector rows (0.32–0.41: family,
tort, criminal, unrelated scholarship). That asymmetry is exactly what the new
rule targets; the exemption budget was then widened (3→12 slots, 70 % fill stop).

## Rerun of the exact Maya Berman question

Run `f4732ef8-d6c7-4767-aabc-c5e8c89a25db` (terminal, 2,228 chars, 2 footnotes).

Pool: 31 candidates (12 perplexity, 19 local_db).
Drops: `dup_document_id` 60, `dup_url` 4, `vector_quota_per_claim` 3 —
**`backfill_origin_diversity_cap`: 0**.
`authority_exemption`: budget 12, used 0, origin_cap_used 1 — no exemption was
needed because in this run no direct authority hit the cap at all. Authorities
previously capped out (בג"ץ 5699/07, סימה אמיר בג"ץ 8638/03, חוק שיפוט בתי דין
רבניים) are now **in the pool**, and בג"ץ 5699/07 is cited in the answer.

### Bavli funnel this run

| stage | result |
|---|---|
| found | yes — daat.ac.il/daat/maamar.asp?id=151 (`בג"צ 1000/92 [בג"ץ בבלי]`) and a Wikipedia page |
| role corrected | yes — scholarship → `persuasive_case_law`, `admitted: true` |
| pool | **not present in the final candidate snapshot; no `backfill_origin_diversity_cap` drop recorded** |
| admitted → body_attempted → acquired → identity → verifier → pack → cited | not reached |

Bavli was **not** lost to origin-diversity capping this time. The daat record
carried a thin snippet (183 / 43 meaningful chars across two query hits) and
disappeared between web admission and the pool snapshot with no cap drop —
consistent with URL/document de-duplication (`dup_document_id` 60, `dup_url` 4)
collapsing it into another record. The Wikipedia Bavli page was dropped as
`bad_source`. Canonical acquisition again recorded `no_derivable_url`.

**Exact next loss stage: pool de-duplication / web-record collapse between
admission and the candidate pool snapshot (`dup_document_id` / `dup_url`).**
Per the track instruction this is reported and not fixed here.

## Final answer

2 footnotes:
1. בג"ץ 5699/07 — supremedecisions.court.gov.il (caselaw, official)
2. compound: שיקול דעת שיפוטי: העידן השלישי (HUJI law journal, two entries)

Unrelated criminal / prosecution sources: **do not survive.** דנ"פ 5387/20 and
ע"פ 4988-08 from earlier runs are gone; both cited sources are on-topic
(administrative-review case law + judicial-discretion scholarship). סימה אמיר
בג"ץ 8638/03 appears in the "found but body not read" reference-only block, not
as an authority-bearing citation.

Full answer text and run payload: `reports/direct-authority-pool-survival-v1/run.json`.
