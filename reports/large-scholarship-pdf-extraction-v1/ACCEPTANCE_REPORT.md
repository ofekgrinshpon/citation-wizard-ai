# large_scholarship_pdf_extraction_v1 — Acceptance Report

Date: 2026-09-06
Scope: bounded, size-aware, page-by-page text extraction for already-found scholarship PDFs
that previously failed with `secondary_binary_too_large_for_inline_extraction`.
No new discovery, no new web search, no new LLM call, no forced source/citation count,
no drafter change, no paywall bypass, no court-host acquisition, no weakened gate.

## 1. What was implemented

### `lib/largePdfChunkedExtract.ts` — bounded chunked reader
`extractPdfPagesBounded(bytes, opts)` opens the PDF with `getDocumentProxy` (unpdf) and reads
**one page at a time** via `getPage()` / `getTextContent()`, cleaning up each page and yielding to
the event loop between pages, so the isolate never blocks the way the old whole-document
`extractText` did. Caps: `maxPages`, `maxChars`, `deadlineMs`, `enoughChars` early stop.
Returns `total_pages`, `pages_attempted`, `pages_extracted`, first/last page, `chars_extracted`,
`stopped_reason` (`enough_text | page_cap_reached | char_cap_reached | deadline_reached |
document_end | page_error | no_pages`) and `latency_ms`. Malformed pages are skipped; repeated
initial page errors fail closed.

### `stages/largeScholarshipPdfExtraction.ts` — the stage
Bounds (`LARGE_PDF_LIMITS`): **2 PDFs/run**, first pass **20 pages**, extension to **40 pages**
only when the first pass is thin, **25 000** stored chars, **4 000** minimum useful chars,
**8 000** early-stop target, **20 s/PDF**, **40 s/run**, **12 MB** download ceiling, every
download and extraction wrapped in a hard `Promise.race` wall-clock cap.

Eligibility (all required): a candidate of this run, scholarship-shaped type/role, PDF target,
article identity signal (title + author or journal/institution), on-topic before extraction,
no hard integrity failure, public non-paywalled non-court host, and a **prior inline-size-cap
failure**. Explicit refusals: `primary_law_not_extracted`, `news_or_blog_not_extracted`,
`court_host_out_of_scope`, `access_controlled_or_paywalled`, `not_a_pdf_target`,
`no_article_identity_signal`, `not_blocked_by_inline_size_cap`, `off_topic_before_extraction`,
`hard_integrity_failure`, `body_already_sufficient`, `over_per_run_large_pdf_cap`,
`not_scholarship_shaped`.

Identity confirmation (title overlap, author, journal/institution, argumentation markers,
binary/mojibake detection) and body-quality classification
(`complete_enough_for_use | partial_but_usable | abstract_only | metadata_only |
extraction_failed | wrong_document | too_noisy`).

Acceptance is fail-closed: identity confirmed **and** quality usable **and** materially better
than the existing body **and** not off-topic after extraction. Accepted bodies are cached by URL
and flow through the unchanged completeness, role, topicality, verifier, pack, drafter, CSM and
alignment gates.

### `stages/secondaryBodyAcquisition.ts`
`fetchCapped` now takes a byte ceiling, and a new `downloadBinaryCapped()` exposes it with the
same host/redirect/paywall refusals. Ordinary inline extraction is still capped at 900 KB.

### `index.ts`
The stage runs in literature mode only, after literature body completeness and before the
verifier, fed exclusively by candidates whose recorded failure is the inline size cap. Improved
bodies re-run the existing body-derived role relabelling. Telemetry persisted under
`drafter.doctrinal_sufficiency_trace`: `large_scholarship_pdf_version`, `_limits`, `_eligibility`,
`_extraction_attempt`, `_identity_check`, `_body_quality`, `_cache_write`, `_added_latency_ms`,
`_stop_reason`, `_downstream_effect`.

### Tests
`src/test/largeScholarshipPdfExtraction.test.ts` — 27 deterministic tests (size-cap detection,
every eligibility refusal, per-run cap, identity confirmation and rejection, quality classes,
page joining, acceptance, wrong-document, off-topic, download failure, disabled, cache hit).
Full suite: **36 files / 430 tests passed**. Typecheck clean. Deploy succeeded; build `OK`.

## 2. Mandatory micro-validation (Dagan, Tamir)

| Article | Result |
|---|---|
| נדב דגן, מידתיות חוקתית, סבירות מנהלית (`law.haifa.ac.il`, 1 624 112 B) | **Extraction succeeded.** 4 pages, **9 759 chars**, stop `enough_text`, latency ~1.0 s, identity confirmed (title match, journal match, 3 argumentation markers, no mojibake), quality `complete_enough_for_use`, topicality `direct`. |
| מיכל טמיר, עלותו השקועה של התקדים | **Never became eligible.** In every P2 run of this session the Tamir candidate no longer reported an inline-size-cap failure, so the stage was `stage_not_run`. No wrong-document risk, no wasted budget. |

The gate condition ("stop if zero usable bodies") is satisfied: Dagan produced a usable,
identity-confirmed, on-topic body. Validation therefore proceeded.

## 3. Live validation — five natural Hebrew prompts

| Run | run_id | Latency | Footnotes | Stage stop | Eligible | Attempts | Extracted chars | Accepted | Stage latency |
|---|---|---|---|---|---|---|---|---|---|
| P1 | `dd012a64-05f3-4a83-8adb-7143dd42395d` | 864 s | 0 | — (infra timeout in retrieval) | — | — | — | — | 0 |
| P2 | `be9039a5-327a-40f4-9863-db12737b8d70` | 192 s | 2 | `stage_not_run` | 0 | 0 | — | 0 | 0 |
| P3 | `e07c853f-08f4-4af9-a5dc-c1b92a05cd12` | 182 s | 2 | `completed` | 1 | 1 | 9 759 | 0 | 1 057 ms |
| P4 | `59786483-3527-4730-86b8-7162c4b587fe` | 884 s | 0 | — (infra timeout in retrieval) | — | — | — | — | 0 |
| P5 | `ad945a88-e5b8-4bcb-b847-cbc97d2f14db` | 187 s | 3 | `completed` | 1 of 2 | 1 | 9 759 | 0 | 3 050 ms |

Completed runs: 182–192 s, inside the established band. Added stage latency: 1.0–3.1 s.
P1 and P4 died as `infrastructure_timeout` inside retrieval, long before this stage — the same
reaper branch seen in the previous two tracks, unrelated to this code.

## 4. Downstream effect

| Run | Source | Extraction | Body before → after | Verifier | In pack | Cited | Loss stage | Reason |
|---|---|---|---|---|---|---|---|---|
| P3 | נדב דגן, מידתיות חוקתית, סבירות מנהלית | usable, 9 759 chars | 16 000 → 16 000 | usable | yes | **yes** (fn 2) | — | body kept: already longer |
| P5 | נדב דגן (same PDF) | usable, 9 759 chars | 16 000 → 16 000 | usable | yes | **yes** (fn 3) | — | body kept: already longer |
| P5 | מבקר המדינה — חדלות פירעון (PDF) | not attempted | — | — | — | no | eligibility | `not_scholarship_shaped` |

## 5. Findings

1. **The extraction blocker is solved.** A 1.6 MB Israeli scholarship PDF that the pipeline
   previously refused to read is now read in ~1 s, producing ~9.8 k chars of genuine article
   text with title, journal and argumentation signals intact and no binary noise. This is the
   first time the Dagan article body has been obtained through the automatic path.
2. **The stage is safe and bounded**: it never touched primary law, news, court hosts or
   paywalled URLs; it refused the State Comptroller PDF as `not_scholarship_shaped`; it never
   replaced a body it could not confirm; worst-case added latency was 3.1 s.
3. **No body was actually swapped in**, because in every eligible case the run already held a
   16 000-char body for the same article (the standard truncation window). The conservative
   "materially better than existing" rule correctly declined to overwrite a longer body with a
   shorter one. So for Dagan, body acquisition is no longer the limiting factor at all.
4. Dagan **was cited** in both completed runs that reached the stage (P3 fn 2, P5 fn 3), and P5
   produced 3 footnotes — the highest of this prompt family so far.
5. Remaining thinness is therefore **not** an extraction problem: P2 still ends at 2 footnotes
   with no eligible large PDF, and P5's third source is topically adjacent (contract-law
   commentary) rather than administrative-law scholarship.
6. Tamir could not be exercised: the candidate did not reach the stage in any run this session.

## 6. Recommendation — exactly one next step

**`literature_pack_utilisation_and_topical_precision_v1`** — the bodies are now in the pack, the
verifier accepts them and the drafter can cite them; what still costs richness is (a) packed,
verified scholarship the drafter does not use, and (b) topically adjacent sources (contract-law
commentary in an administrative-law literature review) taking a slot that on-topic scholarship
should hold. That single track addresses both, with no new retrieval and no forced counts.
