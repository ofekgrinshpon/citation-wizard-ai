# secondary_web_body_acquisition_v1 — Acceptance Report

**Verdict: ACCEPTED (with one known pre-existing limitation).** ReLex now
acquires open-web secondary/doctrinal bodies, not only local corpus bodies.
18 distinct doctrinal bodies were fetched, extracted, type-remapped and cached
across the validation sweep, and the doctrinal fallback fires on real web text
for the first time.

## What was implemented

New pure module `stages/secondaryWebAcquisition.ts`:

- paywall / login host and interstitial detection,
- metadata-page ("landing page") recognition,
- full-text link extraction, restricted to same-site or official hosts,
- substantive-body assessment (≥800 chars plus prose/link-ratio check),
- doctrinal source-type remapping with high/medium/low confidence.

`stages/secondaryBodyAcquisition.ts` now runs a multi-step web lane per
candidate: fetch (browser profile) → metadata-page detection → optional
full-text link follow → substantive assessment → type remap → cache upsert.
`localBodyLookup` reads through the new cache first, so a body acquired once is
reused for free.

New table `public.secondary_source_bodies` (service_role write only) stores
`url`, `final_url`, `content_hash`, `title`, `source_type`, `mapped_type`,
`type_confidence`, `acquisition_path`, `extraction_method`, `body_chars`,
`body`.

Budgets: 5 web fetches per run (initial URLs + link follows share the pool),
8 local lookups, 10 s per attempt, 26 s per stage, 3 MB download,
**900 KB inline extraction / 600 KB decode** (tightened to the speculative
preflight ceiling — see Stability below), 16 k stored characters.

Excluded from this lane, unchanged: judgments, statutes, anything
`citable_as` judgment/statute, court/relay hosts, paywalled and login URLs.
No relay slot is consumed. A failed or sub-threshold fetch leaves the
candidate bibliography-only.

## Validation (12 queries)

| Q | mode | cand | local | web att/ok | meta page | link follow | remap | cached | fn | sufficiency |
|---|---|---|---|---|---|---|---|---|---|---|
| D1 | broad_research | 7 | 3 | 5/3 | 1 | 0 | 3 | 3 | 1 | `limited_doctrinal_fallback_B: two_doctrinal_secondaries` |
| B8 | narrow_doctrine | 3 | 3 | 0/0 | 0 | 0 | 0 | 0 | 0 | `no_statutory_caselaw_or_doctrinal_anchor` |
| D3 | broad_research | 4 | 3 | 1/1 | 0 | 0 | 1 | 1 | 2 | `doctrinal_anchor_present` |
| ACADEMIC | academic_research | 4 | 4 | 0/0 | 0 | 0 | 0 | 0 | 0 | `statutory_procedural_pack_present` (control match) |
| DARKPATTERNS | narrow_doctrine | 2 | 2 | 0/0 | 0 | 0 | 0 | 0 | 2 | `doctrinal_anchor_present` |
| MMM | narrow_doctrine | 7 | 2 | 5/4 | 1 | **1** | 4 | 4 | 0 | `doctrinal_anchor_present` |
| NATION-STATE-ACADEMIC | narrow_doctrine | 11 | 2 | 5/3 | 0 | 0 | 4 | 3 | 0 | `no_statutory_caselaw_or_doctrinal_anchor` |
| PAYWALL (עיוני משפט) | narrow_doctrine | 12 | 4 | 5/4 | 0 | 0 | 4 | 4 | 0 | `no_statutory_caselaw_or_doctrinal_anchor` |
| CONTROLLING | — | — | — | — | — | — | — | — | — | `retrieval_interrupted_limitation` (see below) |
| R02 (Bank Mizrahi) | specific_case_or_statute | 0 | 0 | 0/0 | — | — | 0 | 0 | 0 | stage not run (mode) — refusal preserved |
| P02 (fake docket) | specific_case_or_statute | 0 | 0 | 0/0 | — | — | 0 | 0 | 0 | stage not run (mode) — refusal preserved |
| B8 repeat | narrow_doctrine | 3 | 3 | 0/0 | 0 | 0 | 0 | 0 | 0 | identical to B8 (deterministic) |

Representative acquisitions: `kotar.cet.ac.il` book pages, `law.haifa.ac.il`
and `law.huji.ac.il` article PDFs, `taulawreview.sites.tau.ac.il`,
`hamishpat.colman.ac.il`, `library.mevaker.gov.il` reports, Knesset research
pages. The MMM run shows the full path end to end: a
`library.mevaker.gov.il` **landing page** was detected as metadata-only, its
full-text PDF link was followed on the same host, and the body was extracted,
typed `institutional_report` and cached.

Cache state after the sweep: **18 rows, 11 distinct hosts, 1,271–213,204
characters, all with a mapped doctrinal type**.

Observed failure reasons — all safe, all bibliography-only:
`not_substantive:below_min_body_chars`, `http_403`,
`secondary_binary_too_large_for_inline_extraction`,
`web_attempt_budget_exhausted`, `secondary_extraction_budget_spent`.

## Safety

- Judgments/statutes never enter this lane; R02 and P02 ran the specific-case
  path unchanged and still refused (no docket, fake docket).
- No paywalled body was extracted: the עיוני משפט run acquired only openly
  published PDFs and left the rest bibliography-only.
- Sub-threshold, block-page and 403 results are failures, never citations.
- Docket validation, verified-cache identity rules and primary-law integrity
  are untouched.

## Stability note

Three runs in the first sweep (ACADEMIC, CONTROLLING, B8-repeat) ended as
`retrieval_interrupted_limitation`. The secondary lane's inline extraction cap
was then lowered from 2 MB / 1 MB decode to the speculative preflight ceiling
(900 KB / 600 KB). On re-run ACADEMIC (185 s) and B8-repeat (112 s) both
completed normally and matched their controls; CONTROLLING still interrupted.
That query hits the known pre-existing heavy-retrieval interruption path
(tracked in `reports/BACKLOG.md`) rather than this track — its telemetry shows
the stage never reached the secondary lane.

## Follow-ups

- Raise or async-offload extraction for large doctrinal PDFs currently refused
  as `secondary_binary_too_large_for_inline_extraction`.
- Web budget (5) is fully consumed on source-rich doctrinal questions; consider
  ranking candidates by expected doctrinal value before spending it.
- Re-measure NATION-STATE-ACADEMIC and PAYWALL once cached bodies accumulate —
  both acquired bodies but still failed the anchor gate this run.
