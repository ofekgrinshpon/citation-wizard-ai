# ReLex V2 — Bounded Authority Acquisition (implementation report)

Scope: acquisition orchestration, candidate attachment plumbing, telemetry, tests.
No change to EvidenceStore, identity/judgment gates, verification, temporal logic,
sufficiency, drafting, citation rendering, source tiers, security gates, StopPolicy
budgets, `raw_web_search`, or Perplexity usage.

## 1. Files changed

| File | Change |
| --- | --- |
| `tools/acquisitionLedger.ts` | Target rows gain `expected_identity` (fixed on first open, later opens may only fill missing fields), `concrete_attempts`, `discovery_refreshes_used`, `exhausted`, `exhaust_reason`; candidates gain `local_document_id`, `origin`, `attach_basis`. New `attachCandidates`, `expectedIdentity`, `candidateAttemptKey`, `attemptedKeys`, `concreteUntried`, `attemptsRemaining`, `noteConcreteAttempt`, `canRefreshDiscovery`, `noteDiscoveryRefresh`, `markExhausted`, `memoGateUsed`/`markMemoGateUsed`, `workableTargets`. Constants `MAX_CONCRETE_ATTEMPTS_PER_AUTHORITY = 4`, `MAX_DISCOVERY_REFRESHES_PER_AUTHORITY = 1`. All new state serialized in `toJSON`/`fromJSON`. |
| `shared/urlShape.ts` (new) | Deterministic URL-shape classifier: `concrete_document` vs `discovery_entry` (search paths, free-text query params, hash search routes, bare hosts, unparseable URLs). Shape only — not a quality or trust signal. |
| `tools/acquisitionOrchestrator.ts` (new) | `runAcquireAuthority`, `attachDiscoveryResults`, `pickMemoAcquisitionTarget`, `isConcreteCandidate`, acquisition stats. |
| `agent/researchAgent.ts` | New `acquire_authority` tool; `for_authority` on `search` / `raw_web_search`; `lookup_authority` records expected identity + candidate origins; pre-memo one-shot gate; `untried_acquisition_path` hint when a fetch hits an already-read/exhausted source. |
| `agent/prompt.ts` | Documents `for_authority` and `acquire_authority`; one working rule: use lookup → acquire instead of guessing URLs or retrying failed fetches. |
| `agent/contextWindow.ts` | Open targets now list only **concrete untried** candidates plus the `acquire_authority` call, so the path survives compaction/resume. |
| `types.ts`, `index.ts` | Twelve new optional telemetry counters persisted per run. |
| `src/test/acquisitionOrchestrator.test.ts` (new) | 31 deterministic tests. |

## 2. Exact behaviour

Once a target is open (only `lookup_authority` opens one), `acquire_authority({authority_key})`:

1. **Parent-statute reuse first.** If the target is a section of a statute whose parent
   body is already acquired, the section is located in that body; found → acquired with
   basis `section_located_in_parent_statute_body`, bound to the existing source. Not found
   → the target stays unresolved (non-yielding read recorded). No network call either way.
2. **Candidate queue.** Only concrete candidates are eligible: local corpus rows first,
   then discovered documents in link order, derived/guessed URLs last. Search/portal
   entries stay stored but can never consume an attempt. Previously attempted URLs and
   local rows (matched by the same attempt key the fetch tool writes) are never retried.
3. **Bounded attempts.** Max **4 concrete attempts per authority for the whole run**,
   persisted across chunks and resume; max 1 attempt per pre-memo gate call. Unsafe URLs
   are skipped without consuming an attempt. Each attempt first checks the ordinary
   run-wide fetch budget and consumes it (`policy.note("fetch")`); no capacity →
   `fetch_budget_exhausted`.
4. **Identity is the persisted target's.** The synthetic fetch candidate carries the
   identity fixed when the target was opened. A model-supplied conflicting identity is
   counted (`authority_identity_conflicts`), never used.
5. **Admission unchanged.** Every body goes through the real `runFetch` and the existing
   document / judgment-identity / corroboration gates. Acquisition only decides *what to
   try*, never *what is admitted*.
6. **Outcomes.** `acquired` | `already_acquired` | `needs_discovery` (queue empty, single
   refresh granted) | `exhausted` (`attempt_ceiling` / `no_candidates_left`) |
   `fetch_budget_exhausted` | `target_not_found`. No target is ever invented.
7. **Attachment.** Results attach to a target either by explicit `for_authority`
   (identity matches ordered first) or implicitly when a result carries the target's
   docket or statute core name. Unrelated results attach to nothing; duplicates are
   deduped by result id / normalized URL / local document id.
8. **Pre-memo gate.** At most once per run: if a CORE claim names a target that still has
   an untried concrete path and fetch budget remains, one attempt is made; if it yields a
   body, the memo is returned unaccepted once with the new source.

## 3. Tests

`src/test/acquisitionOrchestrator.test.ts` — 31 tests: URL-shape classification; first /
second / third / fourth candidate fallback; four-attempt ceiling across calls; exactly one
discovery refresh; continuation after a refresh attaches new candidates; no retry of a
failed URL or local row; ordering (corpus → discovered → derived); discovery entries never
spend an attempt; unsafe URL skipped without cost; run-wide fetch budget consumed and
respected; persisted identity wins over a conflicting model identity; serialization /
resume keeps counters and queue; `target_not_found`; `already_acquired`; fetch exception
does not abort the loop; attachment by docket, by statute name, explicit `for_authority`,
unknown key, search page rejected, no double-attach; section-from-parent found and absent;
pre-memo gate selection, supporting/unrelated claims ignored, no-untried-path ignored,
once-per-run persistence.

**Full suite: 74 files, 807 tests, all passing** (the 5 previously failing
`researchJobMode` cases now pass too). Pre-existing, untouched: two `tsgo` narrowing errors
in `authorityCorroboration.ts` (lines 260, 287) that predate this work and do not affect
runtime or the Deno bundle.

## 4. Focused validation (deployed, background mode)

Baseline = Batch 3 run of the same question; new = run after deploy.

| Q | prompt tokens | steps | footnotes | answer chars | acquisition |
| --- | --- | --- | --- | --- | --- |
| Q18 | 58k → **229k** | 8 → 20 | 0 → **1** | 649 → **1170** | 4 targets, 10 candidates attached, 5 attempts, 1 refresh, **1 acquired**, 1 exhausted |
| Q22 | 151k → **67k** | 14 → 8 | 1 → **2** | 1451 → 1347 | 1 target, 11 attached, 4 attempts, 1 refresh, 0 acquired, 1 exhausted |
| Q23 | 184k → **88k** | 16 → 8 | 2 → **3** | 1719 → 1338 | 3 targets, 44 attached, 8 attempts, 0 acquired, 2 exhausted |
| Q27 (regression) | 286k → 305k | 22 → 21 | 2 → 2 | 1810 → 1897 | 2 targets, 22 attached, 2 attempts, **2 acquired**, 0 exhausted |

- **Q18** was limitation-only in Batch 3 (no footnote, no substantive answer). It now
  delivers a substantive answer on §13 of the Contracts Law with an explicit, honest
  statement that the official statute text was not obtained — the bounded loop reached a
  usable secondary body instead of stopping empty-handed. Cost: it also spent far more
  prompt tokens than the baseline abandonment.
- **Q22 / Q23** improved footnote coverage while cutting prompt tokens by ~55%: fewer
  manual retry loops, targets closing deterministically instead of being re-guessed.
- **Q27** (strong baseline) is unchanged in substance — no regression — and both of its
  targets were acquired within 2 attempts.
- Identity conflicts: 0. Parent-statute reuse: not triggered in these four runs. Memo gate:
  not triggered in these four runs. Attempt ceilings behaved as designed (targets closed
  as `exhausted`, no unbounded retrying).

## 5. Unexpected behaviour / remaining issues

- **Q18 token cost rose sharply.** Persisting instead of abandoning is the intended trade,
  but this run exceeded 200k prompt tokens; worth watching in a full batch.
- **Exhausted ≠ acquired.** Q22/Q23 closed targets without a body: the ceiling works, but
  the underlying egress problem (gov.il 403s, court portal resets) is untouched by design.
- Parent-statute reuse and the pre-memo gate are implemented and unit-tested but were not
  exercised live in this focused set.
- Carried over, unchanged and out of scope: the law-firm header-card false bind and the
  judgment-identity false negatives on some genuine PDF judgments.
- Two pre-existing `tsgo` narrowing errors in `authorityCorroboration.ts` left untouched.

## 6. Verdict

ACQUISITION ORCHESTRATOR SHIPPED — TARGETED VALIDATION PASSED
