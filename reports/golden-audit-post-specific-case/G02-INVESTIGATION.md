# G02 (Bank Mizrahi) persistence / liveness investigation

Read-only. No code changes.

## 1. Original G02 stuck run

| field | value |
|---|---|
| job_id | `55eb8988-7326-4226-ad0c-0f690007028a` |
| run_id (audit trigger) | returned, but job is keyed by `id` (job_id), not `run_id` |
| status | `running` |
| current_stage | `verifier` |
| completed_stages | `analyzer, planner, retrieval` |
| created_at | 2026-08-06 12:24:13.66Z |
| updated_at | 2026-08-06 12:25:57.29Z |
| time stale | ~50 min at inspection (no update since 12:25:57) |
| error | NULL (no error ever written) |
| verifier started | Yes (stage advanced to `verifier`) |
| verifier completed | No |
| last persisted checkpoint | end of `retrieval` (12:25:57) |
| edge/function logs | **Unavailable** — `function_logs` / `function_edge_logs` return 0 rows for this project (log ingestion empty), so no runtime trace exists for any run, stuck or successful |

## 2. Re-triggered G02 run

| field | value |
|---|---|
| job_id | `85dcdf05-3111-44f7-a121-b1d4d1f1e1da` |
| job row exists | **Yes** |
| qa_logs row exists | No (never reached finalize) |
| status / stage | `running` / `retrieval`, completed `analyzer, planner` |
| created_at / updated_at | 12:57:50Z / 12:59:12Z (stale ~17 min) |
| error | NULL |
| how the script searched | by `run_id` and too early — the table's primary key is `id` (job_id) |
| verdict | The "no job row" report was a **polling artifact**. The row existed. But the run itself genuinely **did not complete** — that part is real. |

## 3. System liveness

- Last successful `qa_logs` row: `de28a35b…` at **13:01:29Z** (G01 Ka'adan) — *after* both stuck G02 runs.
- Other jobs complete normally after the stuck runs: 14 `done` vs 5 `running` in the last 6h.
- Queue/background execution is **not blocked**; stale `running` rows have no effect on new jobs (no lock, no shared state).

### Decisive pattern — concurrency, not question

Grouping jobs by launch minute:

| batch | launched | done | stuck |
|---|---|---|---|
| 12:57 | 2 | 1 | 1 |
| 12:44 | 3 | 1 | 2 |
| 12:24 | 2 | 1 | 1 |
| all single-launch batches today (13) | 1 each | 12 | 1 |

**Every parallel batch completes exactly one job and strands the rest**, at whatever stage they had reached (retrieval, verifier, drafter — no consistent stage). G02 ran alone at 09:47 and completed cleanly in 3m22s. So this is not question-specific and not verifier-specific.

## 4. Classification

**Background execution failure under concurrency** (parallel edge invocations of `legal-research-v1` are evicted / starved; the background task dies without writing an error, leaving the row `running`).

Secondary: **polling/reporting artifact** in the audit runner (searched by `run_id` instead of `id`, too early).

Not: job creation failure (rows exist), not verifier-specific hang (stalls at three different stages), not queue/state blockage (unrelated jobs finish fine).

## 5. Action recommendation

1. **Rerun G02 alone**, sequentially.
2. **Continue G04–G20 strictly one at a time** (no parallel triggering) — the audit runner's batching is what produced the stranded rows, not a product defect.
3. No backend code fix is required to proceed; the concurrency limit is worth a separate track if real users may run parallel research jobs.
4. Optional hygiene: mark the pre-existing stale `running` rows as failed so they stop polluting audit tables.

## 6. Addendum — G02 solo rerun (13:34Z, CONC=1, no code changes)

| field | value |
|---|---|
| run_id | `80f64f4c-6215-4d79-a6f6-4a37f915089e` |
| job_id | `261bcbf6-10e4-4547-a337-ee3e1f998513` |
| launched | 13:34:51Z, **strictly alone** (no other fixture in flight) |
| status after ~19 min | `running`, stage `retrieval`, `error` NULL |
| qa_logs row | none |
| outcome | `poll_timeout` |

**This falsifies the concurrency-only classification.** G02 stalls in `retrieval`
even as the only in-flight job, so the earlier stranded runs are not fully explained
by batch parallelism; parallelism at most aggravates a G02-specific retrieval hang
(query: `ע"א 6821/93` Bank Mizrahi, the heaviest specific-case fixture — it previously
completed only once, at 09:47 in 3m22s).

### Audit status
- **Batch-parallel execution remains unsupported for this audit** — all fixtures run one at a time.
- **G04–G20 NOT started.** Per the stop rule ("if a single sequential run gets stuck, stop and investigate"),
  the audit is paused pending investigation of the G02 retrieval hang.
- Pre-existing stale `running` rows (2026-07-31 → 2026-08-06 12:57) are old parallel jobs and are ignored.

### Per-fixture results so far
| id | run_id | job_id | branch | drafted/refused | grade | source pack | primary leads | metadata-only holding | commentary-carried | runtime | stale/verifier-fail/stub | bottleneck |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| G01 Ka'adan | `4a47b287…` | recorded | fast-lane exact docket | drafted | good | official Supreme Court body + 3 supports | yes | no | no | ~3–4 min | no | none |
| G02 Mizrahi | `80f64f4c…` | `261bcbf6…` | — | neither (hung) | technical failure | n/a | n/a | n/a | n/a | >19 min, no completion | **stale job: yes** | retrieval stage hang |
| G03 fake docket | `78d382e5…` | recorded | `docket_limitation` | refused | good | 0 sources (correct) | n/a | no | no | ~2 min | no | none |

---

## 7. G02 retrieval-hang root cause (read-only, no code changes)

### 7.1 Fixture
- Question: `מה נקבע בע"א 6821/93 בנק המזרחי נ' מגדל כפר שיתופי ביחס לסמכות בית המשפט לבטל חוק הסותר חוק יסוד?`
- Detected mode: `specific_case` (from checkpoint detail)
- Detected docket: `ע"א 6821/93` → `aa:6821/93`, `fast_lane_eligible: true`
- Wording **differs** from the passing R02 fixture (`מה נקבע בע"א 6821/93 בנק המזרחי המאוחד נ' מגדל כפר שיתופי?`) — longer, extra holding clause, "המזרחי" without "המאוחד". Docket detection and derived URLs are nevertheless identical.
- Analyzer + planner both completed (`completed_stages = {analyzer, planner}`), so neither is implicated.

### 7.2 Retrieval checkpoints (job `261bcbf6…`, run `80f64f4c…`)
| checkpoint | present | at_ms |
|---|---|---|
| retrieval_started | yes | 0 |
| deterministic_resolution_started | yes | 0 |
| derived_urls_probed | **no** | — |
| derived_url_resolved | no | — |
| broad_retrieval_started | no | — |
| broad_retrieval_done | no | — |
| judgment_acquisition_done | no | — |
| specific_case_resolution_done | no | — |
| guard_triggered / retrieval_timeout | **no** | — |

Job `created_at 13:34:51`, last write `13:35:59` (~68 s), `error` NULL. The identical
signature appears on the earlier parallel run `85dcdf05…` (last checkpoint
`deterministic_resolution_started`, ~82 s). Reproducible, not random.

### 7.3 Where it stopped
**Inside derived-URL probing.** In the fast lane `input.candidates` is empty, so
`runSpecificCaseResolution` has no pool partition work and no `targets` loop; the
only code between `deterministic_resolution_started` and the never-emitted
`derived_urls_probed` mark is the `deriveSupremeCourtFileUrls` probe loop
(`specificCaseResolution.ts:479–534`) — fetch → decode → text clean of up to 4
court.gov.il URLs.

### 7.4 Why the 90 s deadline produced no clean refusal
- Run **was** classified `specific_case`; `RetrievalBudget` **was** created with
  `deadline_ms = 90000` (`index.ts:555`).
- The guard is only consulted **after** the fast lane returns: `budget.exceeded()`
  at `index.ts:610` and the `budget.trigger("post_retrieval")` at `index.ts:839`.
  Nothing inside `runSpecificCaseResolution` sees the budget — it enforces only its
  own `SPECIFIC_CASE_LIMITS.TOTAL_MS = 32 s` / `PER_DERIVED_URL_MS = 6 s`.
- Those inner boxes are `withTimeout` = `Promise.race` + `setTimeout`. They are
  **advisory, not abortive**: `fetchBytes` passes no `AbortSignal`, so a stalled or
  slow-trickling `res.arrayBuffer()` keeps running after the race rejects, and any
  synchronous work (`decodeHebrew` up to 1.2 MB, `plainTextFromTxt`/`normText`
  regexes up to 300 k chars, PDF/DOCX extraction) blocks the event loop so the
  timer **cannot fire at all**.
- Consequence: max theoretical async cost of the loop is 4 × 6 s ≈ 24 s, yet the run
  produced no further checkpoint for 68 s and then went silent with no error —
  i.e. the isolate was killed (CPU/wall limit) while inside a non-preemptible probe.
  Nothing after it ever runs, so no `retrieval_timeout`, no failure write, row stays `running`.

### 7.5 Comparison with passing R02 `5acd0dcb…`
| | R02 (pass) | G02 (hang) |
|---|---|---|
| question | short, no holding clause | long, holding clause |
| docket detection | `ע"א 6821/93` | identical |
| fast_lane_hit | true | never reached |
| derived_urls_probed | 4 | loop entered, never completed |
| derived_url_resolved | EnglishVerdicts `93068210_Z01.txt` at 3462 ms | none |
| retrieval elapsed | 4 462 ms | ≥ 68 s, no completion |
| Perplexity | skipped (fast lane hit) | never reached |
| local queries | 3 | 0 |
| candidate pool | 6 | never built |
| divergence point | — | inside the same probe loop R02 completed in 3.5 s |

The two runs execute the *same* URL list; only the upstream court.gov.il response
differs (R02 got a small 6 000-char English body; G02's probe never returned in
bounded time). So the difference is environmental, and the code has no hard bound
to contain it.

### 7.6 Classification
**Derived URL probe hang + deadline guard not enforced around the awaited retrieval call.**
Both are the same defect: the fast-lane probe is time-boxed only by an
un-abortable `Promise.race`, and the 90 s `RetrievalBudget` is never checked inside
the fast lane. Not a fixture-wording bypass, not a docket-detection failure, not
Perplexity, not the candidate pool, not a persistence bug (the heartbeat wrote
exactly what it could before the isolate died).

### 7.7 Minimal recommended fix (one)
Make the derived-URL probe genuinely abortable: pass
`signal: AbortSignal.timeout(SPECIFIC_CASE_LIMITS.PER_DERIVED_URL_MS)` into
`fetchBytes` (and thread the same deadline through `tryDirectFile`), so a stalled
court.gov.il response is torn down at the network layer instead of leaking past a
`Promise.race`. The loop then always reaches `derived_urls_probed`, the 90 s budget
guard is reached, and G02 either drafts or fires a persisted
`retrieval_timeout` / `docket_limitation` — never stale `running`.
