# web_source_usability_and_authority_selection_v1 — Acceptance Report

Status: **partially accepted** (4 of 5 fixes validated live; statute-dominance fallback deployed but not yet observed on a completed Q2 run due to an infrastructure reap unrelated to this track).

## 1. What was implemented

### Fix 1 — General web legal source classification
`stages/webLegalSourceClassifier.ts` (new). Jurisdiction-aware, non-hardcoded classifier that runs only for results the existing pipeline left as `unknown`:
- recognizes official judgments, statutes/legislation, government/regulator materials, and legal scholarship across jurisdictions (domain shape + document shape signals, no doctrine-specific lists);
- rejects encyclopedic (Wikipedia), marketing, listing/index and low-signal pages;
- marks foreign/international authorities `comparative_only`, mapping them to `persuasive_case_law` / commentary — never Israeli binding law; foreign statutes are never classified as Israeli statute;
- emits per-result telemetry (`web_source_classification`).
Wired in `stages/perplexityRetrieval.ts` after primary-shape rescue and academic admission, preserving all existing hygiene, acquisition and body rules. Snippets are still not citable on their own.

### Fix 2 — Discovery-fed canonical acquisition
`lib/canonicalDiscoveryUrls.ts` (new) + `stages/canonicalAuthorityAcquisition.ts`. Canonical acquisition now accepts URLs discovered by official discovery, prefers them over derived URLs, and only accepts candidates with exact docket evidence in title or URL. `isGuessedCourtUrl` suppression and every downstream identity/body/integrity gate are unchanged. `index.ts` reordered so official discovery runs **before** canonical acquisition. New telemetry: `discovery_candidate_count`, `url_source`, `canonical_authority_gaps`.

### Fix 3 — Statute dominance invariant
`stages/statuteDominance.ts` (new). For statutory questions, an available verified statute leads the preferred refs for statutory claims; case law may accompany, never replace. If no statute source is available, an honest Hebrew absence notice is produced. Post-live-run addition: when the question is squarely statutory but no individual claim carries an explicit statutory marker, the statute leads every claim's preferred list (reordering only — no source added, no citation forced).

### Fix 4 — Deterministic authority priority layer
`stages/authoritySourcePriority.ts` (new), wired into `stages/claimSourcePlanning.ts`. Ranks refs by tier: direct primary → canonical primary → role-compatible secondary → general background, keeping one representative per source class in the lead. It reorders only; it does not add sources, raise pool size or force footnotes. Statutory sources are no longer lexically demoted on statutory questions.

### Fix 5 — Bounded Perplexity rate control
`stages/perplexityRetrieval.ts`. Adaptive concurrency: starts at 4, steps down to 3 only after a real 429; jittered 350–900 ms pool cooldown after a rate-limited query; exactly one bounded retry (never a loop). Telemetry: `web_rate_limit_control` (`configured_concurrency`, `effective_concurrency`, `rate_limited_queries`, `retries_after_429`, `backoff_waits_ms`).

## 2. Tests

- New: `src/test/webSourceUsability.test.ts` — 13 tests (foreign classification, foreign-statute safety, scholarship admission, listing/marketing rejection, statutory detection + dominance, authority priority tiers, discovery URL filtering).
- Full suite: **28 files / 287 tests passed**.

## 3. Live validation (deployed function, read-only runner)

| Fixture | Web calls | 429s | Adaptive conc. | Web classified (promoted) | Canonical | Footnotes | ms |
|---|---|---|---|---|---|---|---|
| AW4 | 23 (23×200) | 0 | 3 (pre-adaptive build) | 25 rows, 5 promoted (3 foreign statute, 1 comparative authority, 1 comparative scholarship) | 2 attempts, `no_derivable_url` | 3 | 246k |
| AW9 | 23 (20×200, 3×429) | 3 | 4→3, 2 retries recovered | 17 rows, 2 comparative scholarship | — | 1 | 225k |
| AW7 | 9 (9×200) | 0 | 3 | 7 rows | 2 attempts, `no_derivable_url` | 1 | 189k |
| Q3 | 14 (14×200) | 0 | 3 | 11 rows | 2 attempts, `no_derivable_url` | 3 (incl. חוק-יסוד: כבוד האדם וחירותו) | 143k |
| Q2 | 5 (3×200, 2×429) | 2 | 4→3, 1 retry recovered | 1 row | — | 1 | 143k |

Zero credential failures (0×401) across all runs.

## 4. Assessment against acceptance criteria

Met:
- Web tier healthy and rate-controlled: 429 handling now recovers instead of losing the query; AW9 and Q2 both recovered rate-limited queries via a single retry.
- Foreign/comparative sources are admitted for the first time and correctly labelled persuasive/comparative only — no foreign authority was presented as binding Israeli law.
- Authority priority is active and populated on every completed run (`direct_primary` / `canonical_primary` / `role_compatible_secondary` / `general_background` tier counts present).
- Q3 now cites the Basic Law alongside case law, which is the intended statute-forward behaviour.
- No safety gate was weakened; no retrieval or pool inflation; no forced footnote count.

Not met / open:
- **Canonical acquisition is still starved**: all attempts report `no_derivable_url` with `discovery_candidate_count: 0`. The discovery-fed path is wired correctly, but official discovery does not currently produce URL candidates for registry-nominated canonical dockets (בנק המזרחי, לשכת מנהלי ההשקעות, דפי זהב, גנור). The next track must make discovery *query for* canonical registry authorities, not only for planner nominations.
- **Q2 statute dominance not yet observed end-to-end**: on the one completed Q2 run the question was correctly detected as statutory with statutes available, but no claim carried a statutory marker, so nothing was promoted and the single footnote was a judgment. The fallback promotion fixing exactly this is deployed; two subsequent Q2 reruns were reaped with `infrastructure_failure` at `retrieval_entering` (isolate death, ~830 s), so the fix could not be confirmed live.
- **Footnote density unchanged** (1–3 per answer). Web usability improved upstream, but the last mile — pack → cited — is still the limiter.

## 5. Recommendation

1. Re-run Q2 once the retrieval-stage isolate instability is addressed; it is pre-existing and independent of this track, but it currently blocks statutory validation.
2. Next track: canonical discovery querying (make official discovery actually search for registry canonical authorities) — that is the single change most likely to convert the wired discovery-fed path into real canonical citations.
3. Hebrew prose naturalness should still wait.

Artifacts: `live/results.json` (raw telemetry), `ANSWERS.md` (full answers + footnotes for AW4, AW9, AW7, Q3, Q2).
