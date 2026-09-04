# research_richness_execution_unblock_v1 — acceptance report

Scope: execute the existing research plan better. No new planning layer, no mini-model,
no global retrieval/pool inflation, no fixed footnote target, no safety-gate weakening,
no Hebrew prose or style change.

## Fix 1 — Web / Perplexity execution restored to a *loud* path

New shared module `lib/webTierHealth.ts`:
- deterministic, credential-safe classifier `classifyWebFailure(status, body)` →
  `missing_credentials | quota_exhausted | invalid_credentials | forbidden |
   rate_limited | bad_request | server_error | timeout | network_error | ok`;
- per-run ledger (`resetWebTierHealth` at run start in `index.ts`), aggregated as
  `metadata.web_tier_health` (endpoint type, attempts, successes, HTTP status
  histogram, failure-class histogram, avg ms, safe message, `disabled_or_misconfigured`);
- messages never contain the key, the Authorization header, or the raw provider body.

Wired into both web callers:
- `stages/perplexityRetrieval.ts` — `callPerplexity` now reads the error body,
  classifies it, records the call, and returns `failure_class` / `failure_reason`;
  they surface per query in `per_query[]`. A missing key no longer degrades into a
  silent `perplexity_retrieval.skipped`: the stage run is
  `perplexity_retrieval.web_tier_disabled_or_misconfigured`.
- `stages/officialSourceDiscovery.ts` — search-first records the same classes and
  emits `official_discovery_web_health` (query, intended authority, endpoint type,
  HTTP status, discovered vs admitted URLs, failure reason). `skip_reason` now carries
  the class (`search_http_401:quota_exhausted`) instead of a bare status.

**Live provider state:** the workspace Perplexity connection is a direct (non-gateway)
API key. A temporary probe function (created, used, and since deleted) confirmed the key
is present and well-formed but the account is **quota-exhausted**: both `sonar` and the
legacy online model return HTTP 401 with `insufficient_quota` /
"You exceeded your current quota". No code path can restore live web results until
credits are added to the Perplexity account behind the connector. Per the acceptance
criteria's fallback clause, the tier now fails loudly and diagnostically
(`web_tier_health.safe_error_class = quota_exhausted`,
`disabled_or_misconfigured = true`) instead of producing local-only answers silently.

## Fix 2 — Academic cue detection

`stages/sourceDepthPolicy.ts` `ACADEMIC_CUE` extended with the phrasings that actually
appear in academic prompts: `רקע תיאורטי`, `תשתית תיאורטית`, `פרק רקע`, `פרק מבוא`,
`פרק תיאורטי`, `פרק סמינריוני`, `מתווה פרקים`, `הצעת מחקר`, `שאלת מחקר`,
`פסקת טיעון`, `דיון ביקורתי`, `ניתוח דוקטרינרי`, `כתיבה אקדמית`, `טיוטה אקדמית`.
AW4 / AW9 / AW7-style prompts now classify as `academic_research` instead of falling
into `narrow_doctrine` budgets. Ordinary doctrinal questions are unaffected
(regression-tested).

## Fix 3 — Academic claim-source plan ceiling

`stages/claimSourcePlanning.ts`: the fixed `MAX_PREFERRED = 4` now applies only to
non-academic runs. In academic mode the ceiling is 6–8 (bounded by how many sources are
actually eligible) and selection is **role-diverse** — round-robin across source classes
by score, max 3 per class — so strong local scholarship is no longer forbidden from
citation just because judgments/statutes filled the top four. Nothing new is admitted:
this only widens what the drafter may cite from the pack it already has. New telemetry
per row: `preferred_ceiling`, `preferred_per_role`, `eligible_count`.

## Fix 4 — Bounded canonical authority acquisition

`index.ts` previously called `runCanonicalAuthorityAcquisition({ max_dockets: 0 })`,
producing `docket_cap_zero` on every run. It now passes the stage's own bounded cap
(2 dockets) when the depth mode is `narrow_doctrine`, `broad_research`, or
`academic_research`, and 0 otherwise. New telemetry
`canonical_authority_acquisition_trigger` records depth mode, eligibility, cap, reason.
All identity, URL-eligibility, body-threshold, integrity, metadata-only and CSM gates
inside the stage are untouched.

## Validation

- `bunx vitest run` — **27 files / 274 tests, all passing** (was 26/263; new file
  `src/test/webTierHealth.test.ts` adds 11 tests covering quota vs invalid-credential
  classification, aggregation, credential-safe messages, and the four academic cues).
- Edge function `legal-research-v1` deployed successfully twice (compile check).
- Temporary diagnostic function `web-tier-probe` deleted.

## Acceptance criteria status

| Criterion | Status |
|---|---|
| Web tier no longer fails 401 across all calls | **Not achievable in code** — provider quota exhausted |
| Otherwise fails loudly and diagnostically | Met (`web_tier_health`, per-query failure classes, explicit stage-run name) |
| Academic cues detected for AW4/AW9/AW7 | Met (regression-tested) |
| AW4 can cite more strong local scholarship | Met (role-diverse 6–8 ceiling) |
| AW9 doctrine-specific search before drafting | Partially — cue fix restores the academic budget; live web search still blocked by quota |
| Q3 attempts canonical acquisition | Met (cap 2 for doctrinal/broad/academic) |
| Q2 remains statute-dominant | Unchanged — no change to statutory binding or non-academic caps |
| No planning layer / no retrieval inflation / no fixed footnote target | Met |
| No source-safety regression | Met — no gate touched; full suite green |
| No Hebrew prose/style change | Met |

## Open item

Live richness validation (AW4 / AW9 / AW7 / Q2 / Q3 footnote counts) cannot show the
web-tier contribution until Perplexity API credits are replenished for the connected
account. Everything else in this track is live.
