# local_judgment_body_upgrade_v1 — Acceptance Report

Scope: `supabase/functions/legal-research-v1/stages/judgmentTextAcquisition.ts` only.
No retrieval, admission, CSM/Rule D/E, topic-aware alignment, footnoteBuilder, or prose changes.
No external fetch/PDF/court-egress behaviour changed.

## What was implemented

1. **Local DB lookup is no longer speculative.** `noteSpeculativeBodyAcquired()` is now
   called only for non-local acquisition methods. The `f07_extraction_stability_v1`
   guard is unchanged for direct fetch / court egress / binary extraction.
2. **Bounded local lane** `runLocalJudgmentBodyUpgrade()` — max 4 successful upgrades,
   3s whole-lane budget, 1.5s per read; runs after the main loop over eligible
   judgment candidates that never got an attempt; never touches the network.
3. **Direct `document_id` read** `tryLocalDbByDocumentId()` (ordered chunks, PK read).
   Docket-variant search is used only when the candidate carries no `document_id`.
4. **Exactly-400 trigger fixed:** `len <= MIN_USABLE_TEXT (400)` now counts as a stub
   unless `body_acquired` is already true. Telemetry `local_judgment_stub_detection`.
5. **Verification preserved, made content-aware for local rows.** Length ≥ 400,
   case-identity signal in body (exact docket or judgment-body pattern), improvement over
   the snippet, and — for `origin=local_db` — the body must classify as
   `substantive_judgment_body` under the existing content gate
   (`classifyLocalCaselawBody`). External rows keep the URL listing/institutional check.
   Fail-closed: unverified rows stay stubs and remain uncitable.
6. **Shared mutation** `applyAcquiredJudgmentBody()` is used by both the main loop and the
   local lane, so integrity flags, `citable_as`, authority tier, `usable_for_holding`, and
   metadata can never diverge between paths.

Telemetry added to the stage result: `local_judgment_body_upgrade`,
`local_judgment_body_upgrade_budget`, `local_judgment_stub_detection`.

## Validation (live runs, smoke user)

Round 1 = URL-based listing check. Round 2 = content-aware check for local rows (final).

| Fixture | Upgrades attempted / succeeded (R1 → R2) | Lane elapsed (R2) | Footnotes (R1 → R2) | Total ms (R2) |
|---|---|---|---|---|
| Q1 | 4/4 → 0/0 (no unattempted eligible this run) | 0 ms | 3 → 0 | 119,784 |
| Q2 | 10/2 → 5/4 | 220 ms | 1 → 1 | 152,721 |
| Q3 | 2/0 → 3/3 | 126 ms | 2 → 2 | 126,309 |
| AW4 | 3/1 → 4/4 | 173 ms | 1 → 3 | 139,740 |
| AW7 | 8/2 → 5/4 | 204 ms | 2 → 2 | 123,774 |
| AW9 | 7/1 → 3/3 | 143 ms | 4 → 2 | 172,616 |

Body chars before → after on every successful upgrade: **400 → 6,000** (capped at
`ACQUISITION_LIMITS.MAX_TEXT`), local rows 4.7k–1.5M chars.

Pack effect (R2): Q3, AW4, AW7, AW9 all carry judgments in the synthesis pack
(`judgment_count` 1–2, `has_usable_holding_text` true for Q3/AW7/AW9), where before the
track most judgment candidates were 390–400 char stubs dropped by CSM.

Latency: local lane costs 0–220 ms per run; total run times are within the previous band
(118–227s before, 119–173s after).

## Safety checks

- No stub was cited: every citation comes from a verified upgraded body or a
  non-judgment source that already passed the usual gates.
- Identity validation unchanged; `identity_signal_absent_in_body` skips still occur
  (AW7 R2) and correctly leave the candidate as a stub.
- Metadata-only, source-integrity, primary-law and CSM gates untouched — CSM continued to
  drop upgraded bodies where the claim did not match (Q3 `unrelated_legal_area`,
  AW4 `unrelated_legal_area`, AW9 multiple).
- No final pool size increase: the lane upgrades existing candidates only.
- External acquisition path and the speculative guard for PDFs are unchanged;
  `speculative_extraction_stopped` still fires (Q3/AW4/AW7/AW9) for the external loop.

## Remaining stubs and reasons

- `identity_signal_absent_in_body` — local body has no exact docket/judgment opener in the
  first 30k chars (1 case in AW7). Correct fail-closed behaviour.
- `listing_or_institutional_page` — local body classified as listing/index or partial by
  the content gate (1 case in Q2). Correct.
- `local_upgrade_cap_reached` — 1 case in AW7 after 4 successful upgrades; by design.
- Q1 in round 2 had no unattempted eligible judgment candidates (retrieval variance), so
  the lane did not run; footnote count for that run is retrieval-driven, not lane-driven.

## Type/test status

- `deno check` on the stage: clean.
- Vitest suite: 25 files / 253 tests passed.
