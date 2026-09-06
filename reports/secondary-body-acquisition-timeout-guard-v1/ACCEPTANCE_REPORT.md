# secondary_body_acquisition_timeout_guard_v1 — Acceptance Report

## 1. What changed

- `stages/secondaryBodyAcquisition.ts`
  - PDF detection now happens **before** the binary branch. Every PDF reaching
    secondary body acquisition, its follow-link path, or literature body
    completeness is read through `extractPdfPagesBounded`
    (`lib/largePdfChunkedExtract.ts`), page-by-page, yielding to the event loop.
  - The 900 KB `MAX_INLINE_EXTRACTION_BYTES` cap no longer decides the PDF path.
    It still applies to DOCX only, which remains on `extractDocumentText`.
  - New bounds `SECONDARY_PDF_GUARD`: 20 pages, 25,000 chars max,
    8,000 chars "enough", 12,000 ms deadline.
  - New telemetry `secondary_pdf_extraction_guard` with phases
    `start` / `finish` / `refused` / `failed` and fields: run_id, source_id,
    stage, url, final_url, host, bytes, old_path_would_have_been_inline,
    extractor_used, pages_attempted, pages_extracted, chars_extracted,
    stop_reason, latency_ms, accepted, rejection_reason.
  - `SecondaryBodyAcquisitionInput.run_id` added so guard events carry run and
    candidate identifiers.
- `index.ts` — passes `run_id` to secondary acquisition and passes
  `{ stage: "literature_body_completeness", run_id }` on the completeness fetch.
- `src/test/secondaryPdfGuard.test.ts` — 7 tests.

Unchanged: retrieval, discovery, web search, model calls, prompts, drafter,
court-host acquisition, verifier / CSM / alignment / source-integrity,
paywall and access-control rules, citation or source counts.

## 2. Durable diagnosability

Every PDF extraction writes a durable stage event before it begins and again on
finish, refusal, or failure. A future hang is therefore locatable to a single
URL, host and byte size.

## 3. Validation A — direct reproduction (the exact HUJI PDF)

| item | value |
|---|---|
| page | https://lawjournal.huji.ac.il/article/12/1937 |
| PDF bytes | 819,239 (below old 900 KB cap → old path would have been inline) |
| detected as | PDF (%PDF header + content-type) |
| extractor used | bounded page-by-page |
| total pages | 84 |
| pages attempted / extracted | 3 / 3 |
| chars extracted | 8,620 |
| stop reason | `enough_text` |
| wall time | 536 ms |
| whole-document extraction | never entered |

## 4. Validation B/C — live runs

| prompt | run_id | status | latency | reaper | footnotes |
|---|---|---|---|---|---|
| P1 סקירת ספרות על עילת הסבירות | 180ee642-a49d-40c0-99fe-b57ea045d03c | done | 183.6 s | no | 4 |
| P4 רקע תיאורטי לסמינריון | 600eaf95-886b-43a7-8d0d-ad29ba7a9ae0 | done | 141.9 s | no | 1 |
| P3 (control) מידתיות מול סבירות | 83cc8461-e078-48c2-a8ca-d355ab2c9f2b | done | 197.6 s | no | 3 |

An earlier batch of 9 runs on the same build also all finished (150–254 s,
`status=done`, no `stale_worker_timeout`). Prior failures were 864–884 s hangs.

### Guard events (live)

| run | stage | host | bytes | old_inline | pages | chars | stop | ms | result |
|---|---|---|---|---|---|---|---|---|---|
| P1 | secondary | en-law.tau.ac.il | 956,194 | false | 4 | 8,650 | enough_text | 156 | accepted |
| P1 | secondary | en-law.tau.ac.il | 951,957 | false | 4 | 8,671 | enough_text | 75 | accepted |
| P1 | secondary | hapraklit.co.il | 700,648 | true | 5 | 10,229 | enough_text | 90 | accepted |
| P1 | secondary | law.haifa.ac.il | 260,083 | true | – | – | – | – | refused: budget spent |
| P1 | literature_completeness | lawjournal.huji.ac.il | **819,239** | true | – | – | – | – | refused: budget spent |
| P1 | literature_completeness | lawjournal.huji.ac.il | 430,750 / 834,107 | true | – | – | – | – | refused: budget spent |
| P3 | secondary | law.tau.ac.il | 951,957 | false | 4 | 8,671 | enough_text | 151 | accepted |

Key facts: the exact killer PDF (819,239 B) was encountered again, in the same
literature-completeness stage, and was handled in milliseconds by the extraction
ledger instead of freezing the isolate. Both below-cap (700 KB, 260 KB, 430 KB)
and above-cap (956 KB, 1.62 MB in the earlier batch) PDFs now take the bounded
path; `old_path_would_have_been_inline` is recorded on each.

## 5. Acceptance

| criterion | result |
|---|---|
| no 800+ second hang | pass — max observed 258 s across 12 runs |
| no stale-worker reaper kill | pass |
| all PDFs bounded, below and above old cap | pass |
| whole-document extractor unreachable for PDFs | pass (unit test scans source) |
| safety / integrity unchanged | pass |
| tests | 37 files / 437 tests pass; typecheck clean |
| deployment | `legal-research-v1` deployed |

Richness was explicitly not optimised in this track. Footnote counts (4 / 3 / 1)
are incidental and vary run to run.

## 6. Residual observation (not fixed here)

The run-level extraction ledger is exhausted by secondary acquisition before
literature completeness runs, so completeness-stage PDFs are refused with
`secondary_extraction_budget_spent` rather than read. This is a budgeting
question, not a hang, and is out of scope for this track.
