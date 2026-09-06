# retrieval_timeout_root_cause_audit_v1 — read-only timeout autopsy

Date: 2026-09-06. No code changed, nothing deployed, no production behaviour touched.

Failed runs: P1 `dd012a64-05f3-4a83-8adb-7143dd42395d`, P4 `59786483-3527-4730-86b8-7162c4b587fe`.
Controls: P2 `be9039a5-…`, P3 `e07c853f-…`, P5 `ad945a88-…`.

## Verdict

Primary root cause: **secondary_body_acquisition_hang** — specifically the *inline*
whole-document PDF extraction (`extractDocumentText` → unpdf `extractText`) invoked from
`fetchSecondaryBody`, reached through the second (follow-link) attempt of
`literature_body_completeness_v1`. It is synchronous, CPU-blocking and uninterruptible, so the
surrounding `Promise.race` timer can never fire, the event loop freezes, no checkpoint or DB write
happens again, and the job survives only until the 12-minute stale reaper.

Trigger document: `https://lawjournal.huji.ac.il/article/12/1937` → same-host PDF of **819 239 B**,
~47–94 pages — i.e. just **under** the 900 000 B inline-extraction cap, so it is admitted to the
old whole-document path instead of being refused or read page-by-page.

## 1. Stage timeline (from `legal_research_jobs.result.retrieval_checkpoints`)

P1 (`dd012a64`), created 18:17:54Z, reaped 18:32:xx:

| at_ms | checkpoint |
|---|---|
| 54 / 91 | retrieval_entered / retrieval_started |
| 91 → 3 251 | local_db_start → local_db_done |
| 182 → 12 353 | perplexity_start → perplexity_done |
| 12 353 → 12 556 | candidate_pool / discovery precision → broad_retrieval_done (pool 30) |
| 12 581 → 17 598 | judgment acquisition (2 attempts + 6 skips) |
| 17 667 → 17 688 | statute text acquisition |
| 17 722 → 17 926 | official source discovery |
| 17 948 → 29 337 | canonical registry discovery (11.4 s) |
| 29 374 → 33 149 | canonical authority acquisition (2 probes) |
| 33 194 / 33 262 | natural literature mode / academic body budget (15 selected) |
| 33 283 → 40 491 | secondary body acquisition (6 local hits, 2 web ok, 3 size-cap failures) |
| 40 550 | literature_body_completeness_assessment (assessed 21, selected 4) |
| **40 987** | **post_extract_done chars 1882 — LAST DURABLE WRITE** |
| — | `literature_body_reextraction` never written |
| ~864 s | reaper: `stale_worker_timeout`, refund, no answer |

P4 (`59786483`), created 18:37:19Z, reaped 18:52:00Z:

| at_ms | checkpoint |
|---|---|
| 40 / 78 | retrieval_entered / started |
| 78 → 3 490 | local_db |
| 159 → 15 963 | perplexity |
| 15 964 → 16 198 | pool + discovery precision → broad_retrieval_done (pool 5) |
| 16 224 → 19 544 | judgment acquisition (2 attempts) |
| 19 608 → 19 630 | statute text acquisition |
| 19 653 → 24 311 | official source discovery |
| 24 333 → 35 874 | canonical registry discovery (11.5 s) |
| 35 909 → 35 932 | canonical authority acquisition |
| 35 985 / 36 046 | literature mode / body budget (2 selected) |
| 36 068 → 36 234 | secondary body acquisition (2 local hits, 0 web) |
| 36 269 | literature_body_completeness_assessment (assessed 6, selected 1) |
| **36 777** | **post_extract_done chars 1882 — LAST DURABLE WRITE** |
| — | `literature_body_reextraction` never written |
| ~884 s | reaper: `stale_worker_timeout`, refund, no answer |

Stages with start-but-no-end: `runLiteratureBodyCompleteness` in both runs. Everything before it
completed normally and within the timings of the healthy runs.

## 2. Last successful checkpoint

| field | P1 | P4 |
|---|---|---|
| timestamp | +40 987 ms | +36 777 ms |
| checkpoint | `post_extract_done` (chars 1882) | `post_extract_done` (chars 1882) |
| stage | literature_body_completeness, attempt 1 | same |
| host | lawjournal.huji.ac.il (1 882-char HTML article page) | same |
| durable DB write | `legal_research_jobs.result` checkpoint append | same |
| candidates processed | 21 assessed, 4 selected, 1 attempted | 6 assessed, 1 selected, 1 attempted |
| next expected checkpoint missing | `literature_body_reextraction` | `literature_body_reextraction` |
| continued after main path | no — zero writes of any kind for ~13 min | no |

## 3. Retrieval branch breakdown

| branch | started | ended | elapsed_ms | ops | completed | hanging | slowest op | suspected |
|---|---|---|---|---|---|---|---|---|
| local DB / RPC | 78–91 | 3 251–3 490 | ~3 400 | 4–6 queries | all | 0 | vector match | no |
| perplexity / web | 159–182 | 12 353–15 963 | 12–16 s | 4–9 queries | all | 0 | pplx query | no |
| pool / discovery precision | 12.3 s | 16.2 s | 200 ms | deterministic | all | 0 | — | no |
| judgment acquisition | 12.6 s | 19.5 s | 3–5 s | 2 fetch attempts | all | 0 | attempt 1.6 s | no |
| statute acquisition | — | — | 22 ms | 0 | all | 0 | — | no |
| official discovery | 17.7 s | 24.3 s | 0.2–4.7 s | 1–2 probes | all | 0 | named probe | no |
| canonical registry discovery | 17.9 s | 35.9 s | 11.4–11.5 s | search calls | all | 0 | registry search | no |
| canonical acquisition | 29.4 s | 35.9 s | 0.02–3.8 s | 0–2 probes | all | 0 | probe | no |
| secondary body acquisition | 33.3 / 36.1 s | 40.5 / 36.2 s | 7.2 s / 166 ms | 15 / 2 candidates | all | 0 | web body 1.5 s | no |
| **literature body completeness** | **40.55 / 36.27 s** | **never** | **≥ 823 000 / 847 000** | 1 attempt + follow | 1 fetch | **1** | **PDF inline extract** | **YES** |
| large PDF stage | never reached | — | — | — | — | — | — | no |
| verifier prep | never reached | — | — | — | — | — | — | no |

## 4. External fetch audit

Every fetch in the run has an `AbortSignal.timeout` (`fetchCapped` / `officialFetch`,
`PER_ATTEMPT_MS`), and the completeness loop additionally wraps `fetchBody` in a
`Promise.race` with a computed remaining-time rejection. So **the network layer is not the gap**.

| run | stage | host | elapsed | settled | timeout | abort |
|---|---|---|---|---|---|---|
| P1 | secondary body | hapraklit.co.il | ~1.6 s | yes (ok, 16 000 ch) | yes | yes |
| P1 | secondary body | taulawreview.sites.tau.ac.il | ~1.8 s | yes (ok) | yes | yes |
| P1 | secondary body | en-law.tau.ac.il ×2, law.haifa.ac.il | 0.7–1.5 s | yes (size-cap refusal) | yes | yes |
| P1/P4 | completeness attempt 1 | lawjournal.huji.ac.il (HTML, 1 882 ch) | ~0.4 s | yes | yes | yes |
| **P1/P4** | **completeness attempt 2 (follow link)** | **lawjournal.huji.ac.il PDF, 819 239 B** | **never recorded** | **no** | timer exists but **cannot fire** | signal exists but **cannot abort CPU** |

Measured independently during this audit: the page is reachable (HTTP 200, 20 kB) and links a
same-host PDF of 819 239 B, ~47–94 pages, downloaded in 1.6 s. Under the 900 000 B
`MAX_INLINE_EXTRACTION_BYTES` cap → admitted to `extractDocumentText` (unpdf whole-document
`extractText`), which is a single uninterruptible synchronous pass.

Answer to the key question: no fetch lacks a wall-clock timeout; the *extraction after the fetch*
is what has none, and it is CPU-bound rather than awaitable, so existing timeouts are inert.

## 5. RPC / DB audit

| operation | table/rpc | elapsed | returned | suspected |
|---|---|---|---|---|
| vector match | `match_legal_chunks` | within 3.2–3.5 s local block | yes | no |
| text search | `search_legal_chunks_text` | same block | yes | no |
| secondary cache lookups | `secondary_source_bodies` select | 40–100 ms each (6 hits P1, 2 P4) | yes | no |
| cache upsert | `secondary_source_bodies` upsert | inside 1.5 s web attempts | yes | no |
| checkpoint writes | `legal_research_jobs` update | every ~20–80 ms until the freeze | yes until freeze | no |

No DB/RPC operation is slow, unbounded or unreturned. The hang is not database-side.

## 6. Promise / concurrency audit

| group | stage | promises | max conc. | waits for all | per-promise timeout | group timeout | suspected |
|---|---|---|---|---|---|---|---|
| local queries | local retrieval | 4–6 | pooled | allSettled | yes | budget | no |
| perplexity fan-out | web retrieval | 4–9 | adaptive | allSettled | yes | budget | no |
| judgment attempts | acquisition | sequential | 1 | n/a | yes | yes | no |
| secondary body loop | acquisition | sequential | 1 | n/a | `AbortSignal.timeout` | budget-gated | no |
| **completeness attempt** | completeness | `Promise.race([fetchBody, timer])` | 1 | n/a | yes (race) | `PER_CANDIDATE_MS`/`TOTAL_MS` | **YES — race is defeated by synchronous CPU** |

No optional branch is awaited without a guard; the failure is that all guards are cooperative
(timers, `budgetExceeded()` polls, abort signals) and a blocking synchronous extraction starves
the event loop, so none of them ever run. The retrieval budget object exists but is polled, not
enforced.

## 7. Candidate / loop audit

| run | stage | initial | processed | remaining | duplicate attempts | retry | exit condition | exited |
|---|---|---|---|---|---|---|---|---|
| P1 | secondary body | 15 selected | 15 | 0 | 0 | 0 | web_budget_exhausted | yes |
| P1 | completeness | 21 assessed / 4 selected | 1 | 3 | 0 | 1 follow (max 1) | variants/time caps | **no** |
| P4 | secondary body | 2 | 2 | 0 | 0 | 0 | completed | yes |
| P4 | completeness | 6 assessed / 1 selected | 1 | 0 | 0 | 1 follow | variants/time caps | **no** |

No candidate explosion, no retry storm, no growing queue. P1 has a much larger pool (30 vs 5) but
that is not what killed it — P4 with 5 candidates died identically.

## 8. Failed vs completed comparison

| metric | P1 failed | P4 failed | P2 done | P3 done | P5 done | suspicious |
|---|---|---|---|---|---|---|
| pool size | 30 | 5 | 17 | 8 | 31 | no |
| secondary bodies acquired | 8 | 2 | 6 | 2 | 4 | no |
| completeness assessed / selected | 21 / 4 | 6 / 1 | 14 / 0 | 6 / 1 | 24 / 1 | no |
| completeness attempts | 1 (unfinished) | 1 (unfinished) | 0 | 1 | 1 | — |
| completeness added latency | never returned | never returned | 50 ms | 1 264 ms | 3 604 ms | **yes** |
| attempt-1 result | HTML 1 882 ch + PDF follow link | HTML 1 882 ch + PDF follow link | none | no follow | no follow | **yes** |
| follow-link PDF under 900 KB | **yes (819 239 B)** | **yes (819 239 B)** | n/a | n/a | no (over cap → fast refusal) | **yes — the discriminator** |
| large-PDF stage | never reached | never reached | not run | 1 057 ms | 3 050 ms | no |
| total | 864 s → reaper | 884 s → reaper | 192 s | 182 s | 187 s | — |

Both failing prompts are "עילת הסבירות" literature prompts; both surface the same HUJI law-journal
article page, whose short 1 882-char HTML body triggers the same-page full-text follow, whose PDF
sits just below the inline cap. The three healthy runs either made no follow, or their oversized
PDFs were refused instantly by the same cap.

## 9. Root-cause classification

Primary: **secondary_body_acquisition_hang** — uninterruptible synchronous inline PDF extraction in
`fetchSecondaryBody` (`extractDocumentText` → unpdf whole-document `extractText`), invoked from the
follow-link attempt of `literature_body_completeness_v1`.

- Evidence: last durable write in both runs is `post_extract_done` of completeness attempt 1;
  the very next code path is `findSamePageFullText` → second `fetchBody` → PDF branch; the linked
  PDF is 819 239 B / ~47–94 pages, i.e. under the 900 000 B cap; the guarding `Promise.race`,
  `AbortSignal` and `budgetExceeded()` polls are all cooperative and cannot preempt a blocking
  synchronous pass; no further write of any kind occurs for ~13 minutes; healthy runs execute the
  identical stage in 0.05–3.6 s.
- Exact stage / operation: `stages/literatureBodyCompleteness.ts` attempt loop →
  `index.ts` `fetchBody` → `stages/secondaryBodyAcquisition.ts:fetchSecondaryBody` PDF branch →
  `lib/attachments.ts:extractDocumentText`.
- Why P1/P4 and not P2/P3/P5: only these two reached a follow-link PDF **below** the inline cap;
  larger PDFs are refused in milliseconds and the chunked reader is never in this path.
- Deterministic given the same candidate (same query family, same source), intermittent across
  prompts because it depends on which article page is selected for re-extraction.
- Category: missing *enforceable* bound on CPU-bound work, not a slow dependency, loop or
  infrastructure fault.

Secondary contributing factors:
1. `large_scholarship_pdf_extraction_v1`'s bounded page-by-page reader is used only for PDFs
   **above** the cap; the dangerous mid-size band (roughly 200 KB–900 KB) still uses the old
   whole-document call.
2. Observability gap: the completeness attempt writes no checkpoint between "fetch started" and
   "attempt finished", so a freeze inside it is invisible.
3. The reaper is the only real stop: there is no stage-level wall-clock kill that can end a run
   whose isolate is blocked.

Explicitly excluded by evidence: db_rpc_hang, vector_search_timeout, perplexity_or_web_retrieval_hang,
candidate_loop_or_retry_explosion, canonical_source_acquisition_hang, promise_group_never_settled
(the group exists and is guarded; the guard is simply unable to preempt).

## 10. Recommended next implementation track

**`secondary_body_acquisition_timeout_guard_v1`** — make binary extraction inside secondary /
completeness body acquisition non-blocking and hard-bounded (route mid-size PDFs through the
existing bounded page-by-page reader with a wall-clock cap that can actually fire), so a single
article PDF can never freeze the isolate. Nothing else in this audit justifies a different track.
