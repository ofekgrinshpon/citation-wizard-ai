# authority_duplicate_resolution_v1 — acceptance report

## What changed
- New pure module `supabase/functions/legal-research-v1/stages/duplicateRepresentative.ts`:
  groups records that share an existing duplicate key (document id, url key, statute
  section, docket, role+title) with union-find, and picks ONE survivor per group by
  representation usability only: acquired body (+4), confirmed identity (+3), concrete
  fetchable URL (+2, plain URL +1), integrity-usable (+1), bounded body/snippet length,
  listing penalty (−4). Ties keep arrival order.
- The set of pool positions a group occupies is preserved exactly; only the internal
  order changes. Ranking between *different* authorities, diversity, counts, retrieval,
  verifier, CSM/alignment, topicality, drafter, acquisition, canonical registry and
  classification are untouched.
- Wired into `candidatePool.ts` before the existing admission dedupe; existing drop
  reasons (`dup_document_id`, `dup_url`, …) still fire, but now against the weaker
  duplicate.
- Telemetry `retrieval.pool.duplicate_resolution` (groups, members, usability, reason,
  selected) persisted in `index.ts`.
- Tests: `src/test/authorityDuplicateResolution.test.ts` (7) — duplicate judgment,
  duplicate statute, duplicate scholarship, distinct authorities unchanged, thin-first
  duplicate loses, stable group positions/ties, listing cannot represent a group.
- Full suite 41 files / 466 tests pass; typecheck clean; deployed.

## Live rerun (Maya Berman question only)
run_id `9f28a59e-51e6-42d7-8477-ff4b3a047513` — terminal, 1,739 chars, 2 footnotes.
Pool: found 146 → after_dedup 19. Duplicate groups: 19, reordered 2.

### Bavli funnel
| stage | result |
|---|---|
| discovery | 3 records (daat ×2, judgments.org.il variant) |
| duplicate resolution | group of 3 on `daat.ac.il/daat/maamar.asp?id=151`; survivor `71c00a1b` chosen with usability 5.12 (`exact_identity+fetchable_url`) over 5.06 and 2.12 |
| dedupe drops | the weaker daat twin dropped as `dup_url` (previously it could have been the survivor) |
| pool | survivor admitted via authority exemption (`protected:exact_docket_identity`) |
| source integrity | admitted but downgraded: `caselaw_type_without_judgment_authority`, `text_usability = metadata_only`, 123 meaningful chars |
| web judgment body acquisition | **skipped — `not_judgment_class`**, body never fetched |
| verifier | usable, `partial` support on C1, role_match true |
| drafter | in `omitted_candidate_ids` → not cited |

### סימה אמיר funnel
Local `בג"ץ 8638-03` record (score 0.36) dropped at `backfill_origin_diversity_cap`
(exemption budget 8/8 already spent by higher-scored authorities). Not reached by this track.

### Footnotes (2)
1. בג"ץ 5387/13 פלונית נגד בית הדין הרבני האיזורי בפתח תקווה (toledano.co.il)
2. בג"ץ 8948/22 — החלטה בתיק (supremedecisions.court.gov.il)

No unrelated criminal-law source survived (the previous ע"פ 4988-08 / detention-article
contamination is gone). The answer is on-topic administrative-review doctrine but thin,
and carries the processing-limit caveat.

## Verdict
Duplicate resolution works as specified: the strongest representation of the same
authority now wins its group, and the thin twin is the one dropped. Bavli survives
dedupe **and** the pool, but dies at the **next** stage:

**Exact next loss stage — `web_judgment_body_acquisition`, skip reason
`not_judgment_class`** (the daat record is typed `secondary_commentary` /
`metadata_only` by source integrity, so it is never body-fetched even though its URL
yields ~70k identity-confirmed chars). Without a body the drafter omits it.

Per the track's stop rule, no further change was made.
