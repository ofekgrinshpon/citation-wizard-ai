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
- `usableWorkTitle()` rejects file names / CGI paths / placeholders as work
  titles, so a guessed URL cannot masquerade as identity;
- the agent may pass a `work_identity` **hint** used only to *name* the work in
  the rediscovery query; equivalence is computed against the candidate's own
  metadata;
- recovery search prefers `raw_web_search`, falls back to `search`, both
  budget-gated by the existing stop policy.

A recovered candidate re-enters `runFetch` normally: URL safety, document check,
extraction, EvidenceStore, quote windows, span verification, support
verification and provenance gates are unchanged.

## 3. Tests

`src/test/sameWorkLiveRecovery.test.ts` — 13 tests covering R1–R8 plus
`workKey`, `identityFromSearchResult` and work-title quality.
Full suite: **1027 passed / 86 files**. Typecheck clean. `legal-research-v2`
deployed.

## 4. Live validation (after search-provider top-up)

Search discovery is healthy again (`raw_web_search_results > 0` on every run),
so these runs measure the integration, not an outage.

| Run | Triggered | Candidates seen | Rejected on identity | Rejected on host | Recovered |
|---|---|---|---|---|---|
| samework-F1-1789970082691 (corporate governance) | 1 | 6 | 6 | 0 | 0 |
| samework-F4-1789970668026 (Hansmann & Kraakman, named paper) | 3 | 10 | 9 | 0 | 0 |
| samework-F2-1789970924667 (tattoo copyright) | 3 | 15 | 12 | 0 | 0 |

Observations:

- recovery is **demonstrably invoked in live acquisition** on real failed
  academic sources (7 triggers across 3 runs), with real candidate sets;
- `same_work_recovery_skipped_no_identity` fell to 0–1 per run (was 7–12 before
  the work-title fix), so recovery now reaches real work identity;
- every rejection was `rejected_identity` → `no_equivalent_public_copy`; zero
  unsafe hosts were used and zero title-only matches were accepted;
- **no previously blocked public source was recovered.** The dominant cause is
  that the discovery provider returns title + URL but usually no author and no
  reliable year/DOI for the alternate copy, so `isSameWork()` cannot rise above
  `title_only_insufficient`. Loosening it would admit wrong-work bindings, so it
  was left unchanged.

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
