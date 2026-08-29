# doctrinal_candidate_pool_stabilization_v1 — Stage 3 Acceptance Report

**Verdict: ACCEPTED for candidate-pool stabilization; CONDITIONAL for citation yield
on narrow doctrinal questions (B8).**

Sweep: single full run of the 10-query set, sequential, no repeats.
Artifacts: `reports/discovery-precision/dp-stage2-<ID>.json`,
answers: `reports/doctrinal-candidate-pool/STAGE3_ANSWERS.md`.

## 1. Results

| Run | Runtime | Job | Branch | Footnotes | Pool before→after | doctrinal_eligible before→after | Recovery | Suppressible listing ratio | Suppressed | Backfilled | O(n) | Pass |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ACADEMIC | 163 s | done | draft | 3 | 25 → 25 | 6 → 6 | not needed (floor met) | 0.320 → 0.000 | 32 | 13 | ok | PASS |
| NATION-STATE-ACADEMIC | 151 s | done | draft | 2 | 20 → 20 | 5 → 5 | not needed | 0.336 → 0.000 | 37 | 11 | ok | PASS |
| PAYWALL | 161 s | done | draft | 2 | 20 → 20 | 8 → 8 | not needed | 0.453 → 0.000 | 62 | 12 | ok | PASS |
| MMM | 212 s | done | draft | 0 | 22 → 22 | 0 → 0 | skipped (`no_promising_skipped_candidates`) | 0.158 → 0.000 | 12 | 16 | ok | PASS |
| B8-DOCTRINE | 121 s | done | `insufficient_sources_limitation` | 0 | 19 → 19 | 6 → 6 | not needed (floor met) | 0.483 → 0.000 | 71 | 16 | ok | **FAIL** |
| D1-SWEEP | 172 s | done | draft | 1 | 20 → 20 | 7 → 7 | not needed | 0.344 → 0.000 | 43 | 12 | ok | PASS |
| D3 | 141 s | done | draft | 2 | 26 → 26 | 8 → 8 | not needed | 0.254 → 0.000 | 34 | 19 | ok | PASS |
| DARKPATTERNS | 131 s | done | draft | 1 | 13 → 13 | 3 → 3 | not needed | 0.033 → 0.000 | 2 | 4 | ok | PASS |
| R02 (real docket control) | 222 s | done | `docket_limitation` | 0 | 20 → 20 | 0 → 0 | skipped (`task_intent_not_doctrinal:case_holding`) | 0.283 → 0.000 | 36 | 10 | ok | PASS |
| P02 (fabricated docket control) | 141 s | done | `docket_limitation` | 0 | 13 → 13 | 0 → 0 | skipped | 0.362 → 0.000 | 38 | 8 | ok | PASS |

9/10 pass. All 10 jobs reached terminal `done`; no stubs, no placeholder rows, no
orphan qa_logs, no CPU kills, no dangling stage markers. Runtime 121–222 s,
within budget; recovery never had to fire (eligibility floor already met in
every doctrinal run), so recovery cost was 0 ms everywhere.

## 2. Candidate-pool before/after

Pool stabilization is now doing its job upstream: the suppressible
index/listing ratio dropped to **0.000 in all ten runs** (raw pre-suppression
0.033–0.483), 12–71 listing/search/category candidates suppressed per run with
a recorded reason, and 4–19 backfilled candidates restored diversity. Pool size
before/after stabilization is identical in every run, i.e. suppression happened
earlier in discovery and stabilization itself dropped nothing. Doctrinal
eligibility is stable (`before == after` in all runs), and the previously
observed swing to 1 eligible source did not recur.

## 3. Is the original B8/D1 regression fixed?

**D1: yes.** `D1-SWEEP` drafted with cited support (1 footnote, 7 eligible
doctrinal sources) — no insufficiency branch, matching the Stage 2 repeats.

**B8: partially.** The *pool-level* regression is fixed — B8 no longer starves:
19 candidates, 9 acquired bodies, 8 secondary-typed, `doctrinal_eligible = 6`
at both snapshots, recovery not needed. But the run still terminated in
`insufficient_sources_limitation` with 0 footnotes. This is now a **downstream
sufficiency gate**, not a candidate-pool problem.

### B8 diagnosis (required)

- **Acquired bodies:** 9 (`s5` 10,858 chars, `s8` 16,000 chars, `s6` 1,283 chars,
  `s10` 6,000 chars, plus metadata-thin ones).
- **Eligible doctrinal sources:** 3 by typing (`s5` scholarship, `s6`
  book_or_chapter, `s8` journal_article); 6 by pool snapshot (see §5 metric note).
- **Sufficiency branch:** `insufficient_sources_limitation`,
  reason `no_statutory_caselaw_or_doctrinal_anchor`,
  `sufficiency_authority_basis: insufficient`,
  `authority_type_sufficiency_passed: false`.
- **claim_match_ran:** **no** — `claim_match_not_run_reason:
  deterministic_branch:insufficient_sources_limitation`.
- **claim-source-match drops:** none. The stage never ran
  (`stage_not_run: true`, 0 dropped refs, 0 mismatches, 0 overstatements).
- **Why refs were lost:** not authority category, not claim mismatch, not
  found-only/metadata-only. Citable doctrinal bodies *did* reach the drafter
  (`read_in_full: s5, s6, s8, s10`). They were refused by the depth-mode gate:
  the question was classified `depth_mode: narrow_doctrine`, and the doctrinal
  fallback is only allowed in broad modes —
  `doctrinal_fallback_declined_reason: depth_mode_not_broad`,
  `limited_doctrinal_answer: false`. Additional pressure: 6 candidates were
  `not_doctrinal_type` and one journal article had `no_acquired_body_text`;
  secondary web acquisition stopped at `web_budget_exhausted` after two
  `secondary_binary_too_large_for_inline_extraction` failures and one `http_403`.

So the precise bottleneck is: **narrow_doctrine depth mode disqualifies acquired
doctrinal secondaries from anchoring an answer, even when three of them have
full substantive bodies.**

## 4. Acceptance criteria

| Criterion | Result |
|---|---|
| D1 draft with cited support | PASS (1 footnote) |
| B8 not falling back to insufficiency | **FAIL** → track is conditional for citation yield |
| R02/P02 remain `docket_limitation`, no substitute authority | PASS — both refuse; R02 names the docket only as unavailable |
| No sufficiency thresholds relaxed | PASS — no threshold or gate constant touched in this track |
| No found-only / metadata-only source supports a claim | PASS — `found_only: []` in every drafted run; typing rejects `no_acquired_body_text` |
| Runtime / recovery within budget | PASS — 121–222 s, recovery 0 ms, never triggered |
| No stale jobs, CPU kills, stubs, dangling markers, orphan rows | PASS |

## 5. Metric note

`candidate_pool_stabilization.snapshot_after.doctrinal_eligible` (6 for B8)
counts pool-level typing eligibility, while
`doctrinal_sufficiency_trace.doctrinal_eligible_count` (3) counts refs that
survived body-acquisition eligibility. The two are legitimately different
populations but the shared name is misleading and should be renamed in the next
telemetry pass.

## 6. Next bottleneck

1. **Depth-mode gating of doctrinal fallback** (`depth_mode_not_broad`) — the
   single cause of B8's zero-footnote refusal. A narrow, well-defined doctrinal
   question is exactly the case where acquired scholarship should be allowed to
   support a *limited* doctrinal explanation with an explicit caveat. This should
   be its own track (`narrow_doctrine_limited_doctrinal_answer_v1`), not a
   threshold relaxation.
2. **Secondary web acquisition budget** — `web_budget_exhausted` after large-PDF
   inline-extraction failures and a 403 cost B8 two potential bodies.
3. **MMM** drafts with 0 eligible doctrinal sources and 0 footnotes; institutional
   (Knesset MMM / regulator report) typing yields
   `institutional_typed: 0` and deserves a look.
