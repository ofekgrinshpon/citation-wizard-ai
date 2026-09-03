# local_retrieval_precision_tuning_v1 — acceptance report

Scope: local lexical (FTS) precision, local vector quota/ranking. **No change** to
retrieval breadth, verifier, identity validation, source integrity, listing
suppression, or footnote rendering invariants.

Validation runs (post-deploy, fresh):
`AW4 acbff766-cc95-45b6-8be2-a1f0f93f2f42` · `AW9 9f6b7795-3302-4e48-9a72-f664fc5115b9`
· `AW7 dde0d33a-4797-48b7-823d-075e37f208c4`

## 1. What changed

| # | Change | File |
|---|---|---|
| 1 | Hebrew-aware tsquery builder: clitic-prefix variants (ה/ו/ב/ל/כ/מ/ש + pairs), protected legal lemmas, phrase groups (`<->`), salience-based required terms instead of "two longest words" | `stages/hebrewFts.ts` (new) |
| 2 | New DB RPC `public.search_legal_chunks_tsquery(tsq_primary, tsq_fallback, raw_query, match_count)`; service-role only; legacy RPC kept and used as fallback | migration |
| 3 | Local text lane calls the new RPC, falls back to `search_legal_chunks_text` on error/timeout | `stages/localRetrieval.ts` |
| 4 | Local vector quota 2 → 4 **per claim**, broad/academic intents only, credible local source types only, similarity ≥ 0.30 | `stages/candidatePool.ts` |
| 5 | Conditional promotion of strong local vectors into the `text` tier (never above `exact_authority`), with a global promotion budget of max(4, 40% of pool) | `stages/candidatePool.ts` |
| 6 | **Replacement-only guard**: the untuned pool is built first and its size becomes the hard cap for the tuned pass | `stages/candidatePool.ts` |
| 7 | Telemetry: `local_vector_quota_tuning`, `local_candidate_reranking`, `hebrew_fts_normalization`, `hebrew_fts_term_selection`, `text_lane` | `index.ts`, both stages |

## 2. Before/after vector quota

| Run | Mode | Quota before | Quota after | Vector admitted before | after | Text displaced | Pool before | Pool after |
|---|---|---|---|---|---|---|---|---|
| AW4 | academic_writing | 2 | 4 | 1 | 8 | 7 | 30 | 30 |
| AW9 | academic_writing | 2 | 4 | 0 | 12 | 12 | 30 | 30 |
| AW7 | academic_writing | 2 | 4 | 0 | 9 | 9 | 23 | 23 |

Pool size is identical in every run — admission is strictly replacement.
Narrow intents (`case_holding`, `exact_source`, `specific_case`, …) keep quota 2
and the original tier order; `vector_tuning.enabled = false` there.

## 3. Before/after tier & ranking

Tier order unchanged in principle: `exact_authority > text > perplexity > vector`.
The only change: a **credible local vector with sim ≥ 0.30 in a broad mode** is
scored inside the `text` tier using raw similarity. Examples (AW4):

| Title | sim | old rank | new rank | displaced (method, score) |
|---|---|---|---|---|
| הזכות החוקתית לגוף \| אהרן ברק | 0.691 | 99 | 13 | text, 0.257 |
| האם התמקצעות שיפוטית חשובה? \| נטע נדיב | 0.608 | 136 | 20 | text, 0.281 |

AW9 top promotion sim 0.678 displacing a text row scoring 0.102; AW7 top
promotion sim 0.675 displacing text 0.319. In all runs the displaced rows were
low-scoring lexical hits, and no `exact_authority` row was ever displaced.

## 4. Hebrew FTS normalization examples

| Raw | Required terms (old) | Required terms (new) | Boosters | Variants added |
|---|---|---|---|---|
| מידתיות חוק-יסוד כבוד האדם וחירותו סעיף | חוק-יסוד, וחירותו | מידתיות, **"חוק-יסוד כבוד האדם וחירותו"** (phrase) | חוק, יסוד, סעיף | 39 |
| מידתיות proportionality test comparative law Germany Canada Oakes Alexy | proportionality, comparative | מידתיות, proportionality | comparative, Germany, Canada, test, Oakes, Alexy (`law` dropped as generic) | 13 |
| מידתיות לשכת מנהלי ההשקעות בג 1715/97 | 1715/97, ההשקעות | מידתיות, **"לשכת מנהלי ההשקעות"** (phrase) | בג, 1715, 97 | 13 |

Morphology: `מידתיות` now also matches `המידתיות / למידתיות / ומידתיות / במידתיות …`
via deterministic prefix variants (no stemmer, no data change).

## 5. FTS direct probe (`מבחן המידתיות פסקת ההגבלה`, match_count 40)

| | rows | caselaw | journal_article | knesset_research |
|---|---|---|---|---|
| legacy `search_legal_chunks_text` | 40 | 23 | 10 | 7 |
| new `search_legal_chunks_tsquery` | 16 | 3 | 13 | 0 |

Legacy top titles were off-topic court listings (הורות מושתתת זוגיות, הדתה, הדרה
וצבא, רכבל לעיר העתיקה). New top titles are on-topic: "נדב דגן — מידתיות חוקתית,
סבירות מנהלית", "על המידתיות של המידתיות (ברק)", "מידתיות ותרבות ההצדקה |
משה כהן-אליה", "כיבוד האדם והמשפט החוקתי בישראל". Fewer rows, materially higher
precision.

Latency note: the first implementation applied `:*` suffix wildcards to every
variant and one probe query cost **10.4 s**, which reaped an AW4 run
(`infrastructure_timeout`). Wildcards were removed; the same query is now
**0.15 s** vs 0.59 s for the legacy RPC.

## 6. Candidate flow by method / source type (final pools)

| Run | found | pool | by method | by source_type |
|---|---|---|---|---|
| AW4 | 209 | 30 | text 22 · vector 8 · perplexity 1 | journal 23 · caselaw 5 · israeli_law 1 · supreme_court_il 1 · knesset 1 |
| AW9 | 186 | 30 | text 18 · vector 12 | caselaw 14 · journal 13 · supreme_court_il 2 · knesset 1 |
| AW7 | 110 | 23 | text 14 · vector 9 · perplexity 1 | journal 15 · supreme_court_il 3 · caselaw 3 · israeli_law 2 · knesset 1 |

Local lane health: AW4 20 queries (19 tsquery / 1 legacy fallback), 120 text +
114 vector hits; AW9 18 queries (16/2), 97 + 102; AW7 11 queries (11/0), 62 + 61.
Zero lane errors.

## 7. Footnotes / source roles

| Run | Footnotes now | Previous best (pre-track) | Roles |
|---|---|---|---|
| AW4 | 5 (best observed run in this track: 6) | 5 | 1 primary statute (חוק-יסוד: כבוד האדם וחירותו, local anchor) + 4 doctrinal journal refs |
| AW9 | 4 (earlier run in track: 5) | 4 | 4 doctrinal/secondary journal refs |
| AW7 | 1 | 1 | 1 primary statute |

AW4's doctrinal footnotes are now proportionality-specific (ברק — מידתיות במשפט;
כהן-אליה — מידתיות ותרבות ההצדקה) rather than generic constitutional background.
AW7 is a short single-block genre and remains at one footnote — unchanged by this
track and not a regression.

## 8. Latency

| Run | total | retrieval | local lane | text lane sum | vector lane sum |
|---|---|---|---|---|---|
| AW4 | 249.2 s | 39.8 s | 31.8 s | 43.8 s | 3.1 s |
| AW9 | 247.8 s | 43.9 s | 34.8 s | 74.0 s | 4.3 s |
| AW7 | 182.2 s | 16.6 s | 7.7 s | 24.0 s | 3.2 s |

Pool tuning itself costs 26–74 ms per run (baseline + tuned pass combined).
Local retrieval latency is in the same band as the pre-track audit (3.5–8.5 s
per query set, 21 queries / 8.1 s wall in the audited AW4 baseline).

## 9. Listing suppression — explicitly unchanged

No code in `discoveryPrecision.ts` or `sourceIntegrity.ts` was touched. Drops
still fire and are still counted: AW4 46, AW9 43, AW7 14
(`discovery_listing_suppressed`), identical in the baseline and tuned passes of
each run (`pool_before` == `pool_after` composition upstream of ranking). The
collector-URL caselaw suppression identified in the audit remains in force and is
a separate, still-open item.

## 10. Tests

`src/test/hebrewFts.test.ts` (10) — prefix stripping, protected lemmas, variant
generation, phrase adjacency, salience selection, generic-term rejection,
fallback, empty input.
`src/test/localVectorQuotaTuning.test.ts` (6) — narrow-mode disablement, academic
quota 2→4, weak-vector gating, bounded pool, reranking telemetry,
replacement-only guard.
Full suite: **22 files / 222 tests passed**.

## 11. Assessment and next step

The lexical lane is now precise and *faster* than before, and the semantic lane
finally reaches the pool in broad academic modes without enlarging it. AW4's
citation substance improved. The remaining ceiling is unchanged and is not a
retrieval-precision problem:

1. ~57% of local caselaw is still suppressed on collector `source_url` metadata.
2. Supreme Court primary text is still not locally available; external egress
   remains unstable.
3. Run-to-run variance in footnote count (AW4 5–6, AW9 2–5) persists.

Recommendation: address (1) — local caselaw URL identity — before Hebrew
naturalness work.
