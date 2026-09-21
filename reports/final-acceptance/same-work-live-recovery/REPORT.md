# Same-Work Recovery — Live Acquisition Wiring

## 1. Deployed call path (inspected first)

`researchAgent` → `raw_web_search` / `search` → `discovered` map → `fetch` tool
→ `runFetch`. `runExactAuthorityRecovery` is an **authority-target** helper
(one bounded discovery refresh per authority key, driven by the acquisition
orchestrator) — it is not the general path for academic works, so the
integration point is the agent's `fetch` branch, immediately after a failed
acquisition.

## 2. What was wired

`tools/sameWorkRecovery.ts` (deterministic helper):
`recoverSameWork({failed_source_identity, failure_class, already_attempted_urls, search})`
→ `{recovered, candidate|reason, telemetry}`.

- one rediscovery query per work (`MAX_QUERIES_PER_WORK = 1`),
  `MAX_RESULTS = 6`, `MAX_CANDIDATE_FETCH_ATTEMPTS = 1`;
- dead-URL dedupe (`normalizeUrlKey`) — the original failed URL is never retried;
- `isSameWork()` decides equivalence, never the model: DOI exact, or high title
  overlap confirmed by a shared author surname or a matching year. Title-only
  stays rejected;
- `isAcceptableAlternativeHost()` stays in the live path (pirate mirrors refused);
- `usableWorkTitle()` rejects file names / CGI paths / placeholders
  (`viewcontent.cgi`, `SSRN_ID…`, `מקור ללא כותרת`) as work titles, so a guessed
  URL can no longer masquerade as identity;
- the agent may pass a `work_identity` **hint** (title/authors/year/doi) used only
  to *name* the work in the rediscovery query; equivalence is still computed
  against the candidate's own metadata;
- recovery search prefers `raw_web_search` and falls back to the ordinary `search`
  discovery tool, both budget-gated by the existing stop policy.

A recovered candidate re-enters `runFetch` normally: URL safety, document check,
extraction, EvidenceStore, quote windows, span verification, support
verification and provenance gates are all unchanged.

Telemetry: `same_work_recovery_triggered / query_count / candidates_seen /
candidates_rejected_identity / candidates_rejected_host / success / failed /
failed_reasons / basis / recovered_host / skipped_no_identity`.

## 3. Tests

`src/test/sameWorkLiveRecovery.test.ts` — 13 tests covering R1–R8 plus
`workKey`, `identityFromSearchResult` and work-title quality.
Full suite: **1027 passed / 86 files**. Typecheck clean. `legal-research-v2`
deployed.

## 4. Live validation

| Run | Result |
|---|---|
| samework-F4-1789967336862 | recovery triggered 3×, 3 queries, 0 candidates |
| samework-F4-1789967486048 | triggered 1×, reason `no_results`, 10 skips (pre-fix identity) |
| samework-F4-1789967642493 | triggered 2×, both `no_results`, 0 identity skips |

Recovery is demonstrably **invoked in live acquisition** and is now reached with
real work identity (skips fell to 0). It could not be completed because the
discovery backend itself is returning nothing:

```
POST https://api.perplexity.ai/search → 401
{"code":"insufficient_quota","message":"You exceeded your current quota…"}
```

`raw_web_search_results = 0` for every call in each run confirms this run-wide.
With zero search results no alternative copy can be seen, so F1/F2/F3 were not
run — they would measure the outage, not the integration.

## 5. Safety

No verification gate weakened, no trusted-domain shortcut, no paywall, login or
CAPTCHA bypass, no second research agent, no new mode/quota/classifier. V1
untouched.

## 6. Verdict

SAME-WORK LIVE RECOVERY — PARTIAL / REVIEW

DETERMINISTIC SAME-WORK CHECK: ACTIVE
OPEN-ENDED RETRY LOOP: NO
VERIFICATION STRICTNESS: UNCHANGED
RESEARCH DEPTH ARCHITECTURE: UNCHANGED
DRAFTER MODEL: UNCHANGED
