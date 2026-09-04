# judgment_body_acquisition_stability_audit_v1 — read-only

No code changed. Fixtures: Q1, Q2, Q3, AW4, AW7, AW9 (latest completed runs).

## Headline

Judgment stubs are **not** an external-acquisition problem. In all six runs
**zero external judgment fetches were needed or made**: every acquisition that ran
succeeded via `local_db_docket_lookup` on our own corpus.

The stubs exist because **exactly one judgment per run is allowed to be upgraded**:

1. Local retrieval emits every caselaw candidate as a **400-char chunk snippet**
   (`localRetrieval.ts:569` `SNIPPET_DEFAULT = 400`; 1200 only for anchor/docket/exact rows),
   even though the matching `legal_documents.content` holds 4.7 K – 1.52 M chars.
2. `body_acquired` — required by `claimSupportCategory.ts:116-129` for
   `judgment_authority` / `court_holding` — is set **only** by
   `judgmentTextAcquisition`, never by local retrieval.
3. `judgmentTextAcquisition` has budget 2–3 per run, but the
   `f07_extraction_stability_v1` guard (`judgmentTextAcquisition.ts:1200-1224`,
   `retrievalBudget.ts:187-192`) stops **all** further acquisition after the first
   success when the question names no docket. Every run therefore shows
   `attempts_made = 1`, `stage_stop_reason = speculative_extraction_stopped`.
4. All remaining judgments stay at ~390–400 chars → Rule E
   `insufficient_authority_for_claim_category` fires correctly → thin answers.

The guard was written for **CPU-heavy binary PDF extraction**. It is being applied to
`local_db_docket_lookup`, a pure Postgres read of 8 chunks that performs no binary
extraction at all. That is the single defect.

### Acquisition stage per run

| fixture | judgment candidates | eligible | attempts_made | successes | method | chars | stop reason |
|---|---|---|---|---|---|---|---|
| Q1 | 10 | 9 | 1 | 1 | local_db_docket_lookup | 11 248 | speculative_extraction_stopped (8 excluded) |
| Q2 | 1 | 1 | 1 | 1 | local_db_docket_lookup | 12 005 | — |
| Q3 | 2 | 2 | 1 | 1 | local_db_docket_lookup | 11 849 | speculative_extraction_stopped (1) |
| AW4 | 2 | 2 | 1 | 1 | local_db_docket_lookup | 11 391 | speculative_extraction_stopped (1) |
| AW7 | 9 | 9 | 1 | 1 | local_db_docket_lookup | 11 324 | speculative_extraction_stopped (8) |
| AW9 | 7 | 7 | 1 | 1 | local_db_docket_lookup | 10 971 | speculative_extraction_stopped (6) |

Every excluded row carries `would_have_been_attempted_under_relaxed_rule = true`.

## 1. judgment_candidate_inventory

origin = `local_db` for every row; `body_chars` is the drafter-visible body.

| run | fixture | ref | doc id | title | body_chars | body_status | acquired | drafter | CSM |
|---|---|---|---|---|---|---|---|---|---|
| 8db58359 | Q1 | s3 | 669c4d1c | בג"ץ 5853-07 אמונה | 6000 | full_body | yes | used | kept (1 claim_mismatch) |
| 8db58359 | Q1 | s1 | 292f3477 | בג"ץ 8242/19 פיזיותרפיה | 395 | stub | no | — | insufficient_authority |
| 8db58359 | Q1 | s4 | 2b7c4615 | רע"א 2299/23 זילברברג | 394 | stub | no | — | insufficient_authority ×2 |
| 8db58359 | Q1 | s5 | 66864fce | ע"פ 4039/19 נחמני | 391 | stub | no | — | insufficient_authority ×2 |
| 8db58359 | Q1 | s15 | 463d9f0e | שלום רמלה 61955-11-21 | 400 | stub | no | — | unrelated_legal_area ×2 |
| 8db58359 | Q1 | s16 | e2f0daa8 | משפחה ב"ש 01930-07-21 | 400 | stub | no | — | unrelated_legal_area |
| dcce07f1 | Q2 | s2 | 2cccfe1b | עליון 5387-20 | 6000 | full_body | yes | used | kept |
| dcce07f1 | Q2 | s3 | 399888ad | מחוזי ת"א 12780-01-23 | 400 | stub | no | — | insufficient_authority |
| 66c454fd | Q3 | s1 | 79ace0e0 | בג"ץ 5658/23 | 6000 | full_body | yes | not emitted | — |
| 6d59bead | AW4 | s13 | 79e86178 | בג"ץ 6427-02 | 6000 | full_body | yes | used | kept |
| 6d59bead | AW4 | s9 | 79ace0e0 | בג"ץ 5658/23 | 392 | stub | no | — | insufficient_authority |
| 6d59bead | AW4 | s4 | 0a717970 | תעבורה חדרה | 400 | stub | no | — | not emitted |
| 95d39b4b | AW7 | s10 | 146159c1 | בג"ץ 11437-05 קו לעובד | 6000 | full_body | yes | used | kept |
| 95d39b4b | AW7 | s3 | 79ace0e0 | בג"ץ 5658/23 | 392 | stub | no | — | not emitted |
| 95d39b4b | AW7 | s9 | 2cccfe1b | עליון 5387-20 | 399 | stub | no | — | not emitted |
| e23681db | AW9 | — | — | — | — | — | — | 0 sources reached drafter | — |

AW9 is a separate failure: 7 judgment candidates existed and one was acquired, but
`sources_passed = 0` at the drafter (empty synthesis pack) — an upstream sufficiency
path, not an acquisition problem.

## 2. judgment_stub_reason

| source | fixture | body_chars | local doc | local body chars | acquisition attempted | failure | classified reason |
|---|---|---|---|---|---|---|---|
| s1 | Q1 | 395 | 292f3477 | 14 371 | no | — | body_acquisition_skipped_due_budget (speculative stop) |
| s4 | Q1 | 394 | 2b7c4615 | 49 233 | no | — | body_acquisition_skipped_due_budget |
| s5 | Q1 | 391 | 66864fce | 142 411 | no | — | body_acquisition_skipped_due_budget |
| s15 | Q1 | 400 | 463d9f0e | 9 586 | no | — | body_acquisition_skipped_due_budget |
| s16 | Q1 | 400 | e2f0daa8 | 4 717 | no | — | body_acquisition_skipped_due_budget |
| s3 | Q2 | 400 | 399888ad | 53 451 | no | — | local_row_has_long_body_but_pack_used_stub (`already_has_usable_text`) |
| s9 | AW4 | 392 | 79ace0e0 | 1 520 046 | no | — | body_acquisition_skipped_due_budget |
| s4 | AW4 | 400 | 0a717970 | 12 543 | no | — | body_acquisition_skipped_due_budget |
| s3 | AW7 | 392 | 79ace0e0 | 1 520 046 | no | — | body_acquisition_skipped_due_budget |
| s9 | AW7 | 399 | 2cccfe1b | 251 141 | no | — | body_acquisition_skipped_due_budget |

None are `local_row_actually_short`, `wrong_local_row_selected`, fetch failures,
PDF-extraction failures, identity failures, or `external_source_metadata_only`.

Secondary sub-cause: candidates whose snippet lands at exactly 400 chars can be typed
`substantive_excerpt` and skipped as `already_has_usable_text`
(`judgmentTextAcquisition.ts:1044-1055` triggers on `len < 400`) — Q1 row 6 and Q2 s3.

## 3. local_judgment_body_match

Every stub resolves to its own local row: the candidate already carries the
`document_id` it was retrieved from, so `match_method = candidate_document_id`,
`match_confidence = exact`, `safe_to_upgrade = yes` — the body is the same row the
snippet was cut from, no identity risk. Local body sizes: 4 717 / 9 586 / 12 543 /
14 371 / 49 233 / 53 451 / 142 411 / 251 141 / 1 520 046 chars.

Note: the current `tryLocalDbByDockets` ignores this and re-searches
`legal_documents` by docket ilike variants (`judgmentTextAcquisition.ts:740-787`) —
extra DB work and an avoidable mismatch surface for the row we already hold.

## 4. judgment_acquisition_path

No external judgment path was exercised in any of the six runs: no discovery URL was
fetched for a judgment body, so no HTTP status, no PDF extraction, no identity
validation, no cache hit, no cooldown. Canonical acquisition was `docket_cap_zero`
(Q2, Q3) or disabled (Q1). External acquisition is therefore **not** the bottleneck
for these fixtures.

## 5. judgment_body_recovery_estimate

| fixture | stubs | safe local recoverable | pack-propagation | external | unrecoverable | expected usable judgments | expected footnote gain | risk |
|---|---|---|---|---|---|---|---|---|
| Q1 | 5 | 5 | 0 | 0 | 0 | +2 to +3 (2 are off-area and stay dropped by Rule D) | +1 to +2 | low |
| Q2 | 1 | 1 | 1 | 0 | 0 | +1 | +1 | low |
| Q3 | 0 | 0 | 0 | 0 | 0 | 0 (loss is drafter emission, not body) | 0 | low |
| AW4 | 2 | 2 | 0 | 0 | 0 | +1 (בג"ץ 5658/23) | +1 | low |
| AW7 | 2 | 2 | 0 | 0 | 0 | +2 | +1 to +2 | low |
| AW9 | n/a | — | — | — | — | 0 until the empty-pack bug is fixed | 0 | low |

Total: 10 stubs, 10 safely recoverable from our own corpus, 0 needing any network.

## 6. Recommended implementation (smallest safe)

**`local_judgment_body_upgrade_v1`** — two narrow changes inside
`judgmentTextAcquisition` only:

1. Classify `local_db_docket_lookup` as **non-speculative**: it performs no binary
   extraction, so it must not call `noteSpeculativeBodyAcquired()` and must not be
   blocked by `speculativeExtractionBlocked()`. External/PDF methods keep the guard
   exactly as-is. Add a separate small cap (e.g. max 4 local upgrades/run, ≤3 s total)
   so the stage stays bounded.
2. When the candidate already carries a `document_id` from local retrieval, read that
   row's chunks directly instead of re-searching by docket; keep the existing
   docket/title body verification before the text is used.

Optional follow-up (separate track): make the acquisition trigger `len <= 400` so
exactly-400 snippets are not treated as `already_has_usable_text`.

Not recommended: broader retrieval, CSM/Rule D-E changes, higher citation caps,
citing stubs, external retry work.

## Safety risks

- **Wrong-body risk:** near zero — the upgraded text comes from the same
  `legal_documents` row the candidate was retrieved from; docket/title verification
  is retained.
- **CPU/isolate risk:** the guard being relaxed exists to prevent isolate kills from
  PDF extraction. Relaxation must be strictly limited to the DB path and capped;
  otherwise the f07 failure mode returns.
- **Latency:** each local upgrade cost ~1–3 s in these runs; 3 extra upgrades is
  within the retrieval budget but should be measured in validation.
- **More real bodies means more citable judgments**, so Rule D/E and topic-aware
  alignment will now decide more refs — their precision must be re-checked, but no
  gate is weakened by this change.
