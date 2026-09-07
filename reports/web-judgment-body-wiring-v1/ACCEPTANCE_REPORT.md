# web_judgment_body_wiring_v1 — Acceptance Report

**Verdict: mechanism implemented and verified on the exact Bavli URLs; the live
rerun could not exercise it on Bavli because Bavli is now lost *earlier*, at
pool backfill diversity capping, before any body lane runs.**

## What was implemented

New stage `stages/webJudgmentBodyAcquisition.ts`, wired in `index.ts` after
judgment/statute acquisition and **before** canonical + secondary acquisition.

- Selection (deterministic, fail-closed): candidate must be judgment-class
  (`court_case` / `judgment` / `citable_as: judgment`), have a concrete
  `http(s)` URL, be on a **non-court** host (court hosts stay with the
  canonical/relay lane), not paywalled or access-controlled, not already carry a
  body, and yield a docket from its own title/URL/snippet.
- Fetch: the **existing** `fetchSecondaryBody` web lane (bounded bytes, deadline,
  redirect and PDF-guard rules). No new fetcher, no relay, no follow-link.
- Acceptance: body ≥ 2,000 chars **and** `validateJudgmentIdentityStrict`
  returns `validated && docket_match`. Only then is the body applied through the
  shared `applyAcquiredJudgmentBody` with the new additive method
  `web_document_fetch` (authority tier `primary_mirror`).
- Budgets: 3 candidates, 24 s stage.
- Any failure leaves the candidate exactly as it was.
- Local helper `repairDocketPrefixFinals` restores the final letter of a court
  prefix immediately before a docket number (`בג"צ 1000/92` → `בג"ץ 1000/92`)
  so shared docket detection recognises it. No other text is altered.

Unchanged: retrieval, queries, classification, verifier, CSM/alignment,
topicality, drafter, pack thresholds, canonical registry.

Tests: 8 new focused tests (`src/test/webJudgmentBodyAcquisition.test.ts`) —
daat/judgments.org.il admitted, court hosts and paywalled hosts refused,
no-docket and non-judgment fail closed, already-bodied skipped. Typecheck clean,
deployment succeeded.

## 1. Exact discovered Bavli URLs (direct probe through the new checks)

| url | status | bytes | chars | identity validated | docket_match | confidence | evidence | ms |
|---|---|---|---|---|---|---|---|---|
| https://www.daat.ac.il/daat/maamar.asp?id=151 | 200 | 74,462 | 69,835 | yes | yes | high | party_tokens_in_body, court_marker, docket_in_title | 622 |
| https://judgments.org.il/judgments/בגצ-1000-92/ | 200 | 300,399 | 80,062 | yes | yes | high | party_tokens_in_body, court_marker, docket_in_title, docket_in_url | 1,062 |

Both pass selection and both clear the acceptance gate (≥2,000 chars + strict
identity). If either URL is in the pool as an admitted judgment candidate, the
stage acquires and body-confirms it.

## 2. Live rerun — exact Maya Berman question

Run `2ffebdba-a9c4-4f89-b07d-c57c4ba53f1e`. Stage ran: considered 4 eligible,
attempted 3, acquired 0, 138 ms, `stop_reason: completed`.

| candidate | host | docket | admitted | body attempted | acquired | chars | identity | outcome |
|---|---|---|---|---|---|---|---|---|
| בג"ץ 7150/16 | www.gov.il | bagatz-7150-16 | yes | yes | no | 0 | — | `http_403` |
| תמ"ש 42085-01-22 | www.gov.il | tms-42085-01-22 | yes | yes | no | 0 | — | `http_403` |
| רמ"ש 65963-06-22 | www.gov.il | rms-65963-06-22 | yes | yes | no | 0 | — | `http_403` |
| רע"א 7127/22, ע"א 7261/20, דנ"פ 5387/20, ת"א 67874-06-18 | toledano / gov.il | — | yes | no | — | — | — | `body_already_acquired` (local body) |
| HUJI ביקורת הסבירות | lawjournal.huji.ac.il | — | yes | no | — | — | — | `not_judgment_class` |

**Bavli in this run:** found (`cwj.org.il` .doc, score 0.75, rank 86) and
**dropped from the pool before any body lane** with
`drop_reason: backfill_origin_diversity_cap`. Canonical acquisition again
recorded `no_derivable_url` for it. Neither the daat nor judgments.org.il URL
from the probe run was returned by discovery this time (a different daat page,
`psk.asp?id=176`, was returned and classified `academic`).

Final answer: **2 footnotes** — דנ"פ 5387/20 (gov.il spokesperson page) and a
compound of three HUJI journal articles on judicial review. Unrelated criminal
sources: the earlier criminal case ע"פ 4988-08 did **not** survive; the
remaining דנ"פ 5387/20 is a prosecutorial-discretion review case, still not a
rabbinical-property authority. Answer text saved in `run.json`.

## 3. Exact next loss stage

`retrieval.pool.drops → backfill_origin_diversity_cap`: the Bavli candidate is
discovered and scored but capped out of the candidate pool by origin-diversity
backfill limits, so it never reaches classification-admitted status, this new
body lane, verifier, or pack. Per the track instruction, that is reported and
**not** fixed here.

## Acceptance

The wiring itself passes: web judgment candidates now enter a bounded body lane,
and the two probe URLs are fetched, extracted and identity-confirmed by exactly
that code path. What is still missing for Bavli specifically is upstream pool
survival, not body acquisition. No downstream gate was weakened and nothing was
forced into the pack.
