# f07_proportionality_terminal_failure_v1 — narrow diagnosis (no code changes)

Query (F07): `מהם מבחני המידתיות בביקורת חוקתית בישראל?`
Job `9292bb4a-dd24-4970-b0cd-858ef21e4baa` · run `2d3a1233-7a06-4b8e-b340-1ed05b803e1a`
Job row: `status=failed`, `error=stale_worker_timeout`, `current_stage=retrieval`,
`completed_stages={analyzer,planner}`, wall clock 13m09s (killed at ~12.4s, reaped 13m later).

## 1. Exact last checkpoint before death

23 checkpoints persisted. Last one:

```
12331 ms  judgment_attempt_extract_start
          { host: "www.adalah.org", kind: "pdf", bytes: 854676,
            index: 1, bounded: false, inner_stage: "binary_extract_start",
            candidate_id: "56fc6246-5610-4236-8d5e-f853bf1f9a3b" }
```

No matching `judgment_attempt_extract_done`. The isolate died **inside**
`extractDocumentText()` for the 2nd judgment candidate (an 854 KB PDF).

Immediately preceding trail (abridged):
`retrieval_entered 40` → `local_db_done 5541 (143)` → `perplexity_done 9454 (11)` →
`broad_retrieval_done 9470 (pool 30)` → `judgment_acquisition_start 9494 (30 candidates)` →
attempt #0 `supremedecisions.court.gov.il` 742,685 B PDF: fetch 1.0s, extract 1.2s → 164,311 chars,
post-extract OK, `judgment_attempt_done 11959 (2441 ms, success)` →
attempt #1 `adalah.org` 854,676 B PDF: fetch 313 ms → **extract_start 12331 → silence**.

## 2. Stage at death

**Body acquisition → binary extraction** (judgment text acquisition, attempt index 1).
Not planning, not local retrieval, not perplexity (both already `done`), not verifier,
not drafter, not finalization — those were never reached.

## 3. Was the retrieval governor active?

Yes. `RetrievalBudget` was constructed and running: `retrieval_entered` was written by it,
per-attempt deadlines are present in the checkpoints (`attempt_deadline_ms: 12000`), the
checkpoint persistence path worked to the last instruction, and `allowExtraction` was wired
into `judgmentTextAcquisition` (`opts.allowExtraction`, index 1 was still inside the ledger:
2nd of max 3 extractions, ~1.60 MB of the 5 MB byte allowance).

## 4. Did the hard budget fire?

No. Deadline was 200,000 ms (doctrine_explanation, non-specific-case); death occurred at
~12,400 ms — **6% of the budget**. `budget_exceeded=false`, no
`retrieval_budget_exceeded` / `retrieval_cpu_guard_triggered` checkpoint. This is not a
wall-clock overrun; it is a **CPU-quota** kill.

## 5. Was AbortController passed into the active operation?

Into the *fetch*, yes (the download completed in 313 ms under the per-attempt signal).
Into the *extraction*, no — and it cannot be: `extractDocumentText()` is one synchronous,
uninterruptible CPU step. An `AbortSignal` has no preemption point there.

## 6. Did a synchronous CPU-heavy step bypass the budget?

Yes — by design of the current guard set, which is **per-file, not per-run-CPU**:

| guard | value | attempt #1 (854,676 B) |
|---|---|---|
| `MAX_INLINE_EXTRACTION_BYTES` (speculative) | 900,000 | passed (854,676 < 900,000) |
| `BOUNDED_EXTRACT_BYTES` | 1,600,000 | not triggered → `bounded:false` |
| `MAX_EXTRACT_BYTES` | 4 MB | passed |
| `RETRIEVAL_BUDGET.MAX_EXTRACTIONS_PER_RUN` | 3 | 2nd extraction allowed |
| `MAX_EXTRACTION_BYTES_PER_RUN` | 5 MB | 1.60 MB used → allowed |

Every gate said "go". The step that killed the worker was permitted by all of them.

## 7. Candidate count and extraction count before death

- Local DB candidates: 143 · Perplexity: 11 · merged pool after integrity: **30** (0 rejects).
- Judgment acquisition candidates: 30, attempts made: 2.
- Extractions: **1 completed** (742,685 B → 164,311 chars) + **1 in flight** (854,676 B).
- Cumulative bytes fed to synchronous extraction: **1,597,361 B**, plus ~164 K chars of
  post-extract cleaning already spent on attempt #0.

## 8. Longest step

Never reported (no terminal telemetry). From the trail: local DB 5,463 ms;
perplexity 9,299 ms (overlapping); judgment attempt #0 2,441 ms — of which **1,194 ms was
pure synchronous PDF extraction**. The fatal step (attempt #1 extraction) ran >0 ms and
never returned.

## 9. Same class as F02/F05, or different?

**Same family (synchronous binary extraction), different trigger.**
F02/F05 died on a *single* oversized / legacy-format binary — fixed by per-file size sniffs
and `looksBinary`, and both now finish clean (F02 68.7 s, F05 100.6 s, 1 extraction / 184 KB).
F07 dies on **cumulative CPU across several individually-legal extractions**: two ~750–855 KB
PDFs plus the post-extract normalization of a 164 K-char body inside one isolate. The
per-file ceilings are correct; the per-run CPU accounting is too generous (3 extractions /
5 MB), and it charges only *input bytes*, not extracted chars or post-extract work.

Corroborating: F06 survived a single 1,128,295 B extraction; F05 survived a single 184 KB one.
Only F07 attempted a second one.

## 10. Why no terminal branch was written

The isolate was killed mid-instruction, so nothing downstream ran: no sufficiency gate, no
drafter, no `insufficient_sources_limitation` / `docket_limitation` fallback, no qa_logs
terminal write. The only qa_logs row for this run is the trace row written at 10:52:32 with
`trace_stage=retrieval_entering, trace_status=in_progress` (`answer` empty) — hence
`no_terminal_qa_row` + `empty_answer_body`. The job row stayed `running` until the external
stale-worker reaper marked it `failed / stale_worker_timeout` 13 minutes later.

Structurally: the partial-result fallback of `retrieval_budget_enforcement_v1` is reachable
only from the wall-clock deadline path. A CPU kill has **no** in-isolate recovery path,
so there is currently no code path that can emit a terminal branch for this failure mode.

## 11. Minimal fix recommendation (not implemented)

Three small, retrieval-only changes; no planner/drafter/legal-quality impact.

1. **Charge real CPU cost to the run ledger, and tighten it.**
   In `RETRIEVAL_BUDGET`: `MAX_EXTRACTIONS_PER_RUN: 3 → 1` for speculative
   (non-requested-docket) acquisition, keep 2 for exact-docket/requested authority, and lower
   `MAX_EXTRACTION_BYTES_PER_RUN` to ~1.2 MB for the speculative class. Also charge extracted
   *chars* (÷ a constant) back into `extraction_bytes` after each extraction, so a
   164 K-char body consumes the allowance it actually cost.

2. **Stop speculative extraction once one body already succeeded.**
   In `judgmentTextAcquisition`, when `trigger` is `metadata_only` / `text_below_threshold`
   and `is_requested=false`, skip further binary extraction after the first successful
   acquisition (fall back to metadata-only classification, which the metadata-only holding
   gate already handles safely).

3. **Make the CPU kill terminal-visible.**
   Write a durable `pre_extract_commit` checkpoint carrying enough state that the stale-worker
   reaper can convert `stale_worker_timeout` into a real user-facing limitation row
   (`retrieval_interrupted_limitation`, with the existing Hebrew partial-retrieval disclosure)
   instead of a bare failure. This is a reaper/finalization change, not a retrieval one, and
   guarantees "every job reaches a terminal result" even when the isolate dies.

Suggested validation after the fix (cost-controlled, per instruction): **F07, R02, P02, B8** only.
