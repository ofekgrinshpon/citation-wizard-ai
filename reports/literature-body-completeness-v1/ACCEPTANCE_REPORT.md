# literature_body_completeness_v1 — Acceptance Report

Date: 2026-09-06
Scope: bounded same-source body re-extraction for already-found, already-fetched strong
literature candidates. No new discovery, no new web search, no new LLM call, no forced
source or citation count, no drafter behaviour change, no weakened integrity/CSM/alignment.

## 1. What was implemented

### New stage — `stages/literatureBodyCompleteness.ts` (`literature_body_completeness_v1`)

1. **Deterministic body-completeness classifier** (`assessBodyCompleteness`)
   Verdicts: `complete | partial | metadata_only | listing_like | failed`, from:
   - body length below the classification floor (`< 800` chars);
   - paragraph count and paragraph length distribution;
   - title/author/journal metadata present but no article text;
   - abstract-only bodies (`תקציר` / `abstract` + short remainder);
   - listing / TOC / search-result / journal-index patterns;
   - navigation, menu and footer repetition ratio;
   - PDF/extraction-failure markers (`%PDF`, `obj`, `endstream`, mojibake runs);
   - absence of legal-substantive vocabulary despite a strong title match;
   - absence of argumentation markers (`לטענת`, `מנגד`, `יש לטעון`, `בניגוד ל…`) in short bodies.

2. **Bounded candidate selection** (`selectReextractionCandidates`)
   Eligible only: already-found, already-attempted strong scholarship candidates whose body is
   not `complete`. Hard exclusions with explicit `skipped_reason`:
   `primary_law_or_news_not_reextracted`, `access_controlled_or_paywalled`,
   `court_host_out_of_scope`, `off_topic_after_body`, `hard_integrity_failure`,
   `body_already_complete`, `not_a_strong_scholarship_candidate`,
   `over_per_run_reextraction_cap`.
   Limits: **max 4 candidates/run, max 2 variants/candidate, max 1 same-page follow,
   25 s stage budget, 12 s per candidate**, plus a hard `Promise.race` wall-clock cap per fetch
   so a hanging host can never stall the pipeline.

3. **Same-source-only re-extraction**
   Reuses the existing bounded `fetchSecondaryBody`; the only permitted variant is a full-text
   link found *on the already-fetched page itself* (`same_page_pdf`, `print_view`, `canonical`).
   No search, no new candidate, no other host.

4. **Conservative acceptance**
   A new body replaces the old one only if it is materially longer (≥1.25× and ≥400 chars),
   substantive (not listing/metadata/abstract-only/extraction-failure), identity-confirmed
   against the article title, and still on-topic. Any failure leaves the original body untouched.

5. **Downstream re-run** — for improved bodies only, the existing (unweakened) body-derived role
   gate and topicality gate re-run. Verifier, CSM, alignment and pack selection are unchanged.

6. **Precise failure reasons** (`explainRemainingWeakBody`) instead of the previous generic
   `body_evidence_too_weak_to_override_slot`.

### Telemetry (persisted under `drafter.doctrinal_sufficiency_trace`)

`literature_body_completeness_version`, `literature_body_completeness_assessment`,
`literature_body_reextraction_candidate`, `literature_body_reextraction_attempt`,
`literature_body_reextraction_result`, `literature_body_reextraction_added_latency_ms`,
`literature_body_downstream_effect` (body_improved, role before/after, topicality before/after,
verifier/pack/cited after, `final_loss_stage`, `final_loss_reason`).

### Tests

`src/test/literatureBodyCompleteness.test.ts` — 25 deterministic tests (classification verdicts,
selection rules and caps, identity confirmation, same-page link safety, acceptance and every
rejection path, disabled path, fetch-error path).
Full suite: **35 files / 403 tests passed**. Typecheck clean. Build log: `build OK`.

## 2. Live validation (5 natural Hebrew prompts)

| Run | Prompt | run_id | Latency | Footnotes | Lit. mode | Assessed | Selected | Attempts | Improved | Stage latency |
|---|---|---|---|---|---|---|---|---|---|---|
| P1 | סקירת ספרות על עילת הסבירות | `ec4aac37-cab6-4eca-a08e-091e7ef7de7e` | 168 s | 2 | true | 8 | 0 | 0 | 0 | 29 ms |
| P2 | סקירת ספרות לסמינריון על הבטחה מנהלית וציפייה לגיטימית | `bc58680d-e152-464f-81cf-5ddcb9e10083` | 177 s | 2 | true | 28 | 1 | 1 | 0 | 1 732 ms |
| P3 | סקירת ספרות על היחס בין מידתיות לסבירות | `98719242-935f-4653-bbc9-6144524582b2` | 172 s | 2 | true | 8 | 1 | 1 | 0 | 1 377 ms |
| P4 | רקע תיאורטי לסמינריון על עילת הסבירות והביקורת עליה | `0fd6d9b7-ae33-4788-9bf7-73edd6101778` | — | — | — | — | — | — | — | — |
| P5 | פרק סקירת ספרות על הסתמכות מול רשות מנהלית | `334162cc-af75-4fea-b202-700c3aea8eb3` | — | — | — | — | — | — | — | — |

P4 and P5 did not produce an answer: both were reaped as `infrastructure_timeout` with
`prior_stage: retrieval`, `trace_stage: retrieval_entering`, i.e. the run hung inside retrieval
before ever reaching the new stage (stage telemetry empty, `literature_body_completeness_version`
absent). During this session 6 of 11 runs hit the same reaper branch; P1 and P3 both failed this
way and then completed normally on retry with unchanged code paths, so this is an infrastructure
hang in retrieval, not a regression from this track. A defensive per-fetch wall-clock cap was
added to the new stage regardless.

Latency of completed runs: 168–177 s, inside the 167–202 s baseline band.
Added stage latency: 29–1 732 ms.

## 3. Downstream effect

| Run | Source | Body improved | Role before → after | In pack | Cited | Loss stage | Reason |
|---|---|---|---|---|---|---|---|
| P2 | עלותו השקועה של התקדים \| מיכל טמיר | no | scholarship → book_or_chapter | yes | no | drafter_utilisation | `secondary_binary_too_large_for_inline_extraction` |
| P3 | נדב דגן, מידתיות חוקתית, סבירות מנהלית | no | scholarship → journal_article | yes | no | drafter_utilisation | `secondary_binary_too_large_for_inline_extraction` |

## 4. Findings

1. The stage is **safe and bounded**: it never selected primary law, court hosts, paywalled
   sources or off-topic candidates; it never replaced a body with a listing, abstract or
   extraction failure; it added at most 1.7 s.
2. **Assessment works**: 8–28 bodies assessed per run, with `complete` / `partial` /
   `metadata_only` verdicts distinguishing genuinely usable bodies from stubs.
3. **Zero bodies were improved**, and both re-extraction attempts died at exactly the same place:
   `secondary_binary_too_large_for_inline_extraction`. The strong Israeli scholarship PDFs
   (Tamir, Dagan) exceed the inline extraction size cap of the shared bounded fetcher, so the
   fuller body can never be obtained through the current fetch path.
4. Consequently footnote counts are unchanged (P1 2, P2 2, P3 2) — the track produced correct
   diagnostics and safety, but no richness gain yet.
5. The old opaque blocker `body_evidence_too_weak_to_override_slot` is now replaced by a precise,
   actionable reason, which is what exposed finding (3).

## 5. Recommendation — exactly one next step

**`large_scholarship_pdf_extraction_v1`** — allow bounded, streamed/paged text extraction for
already-identified scholarship PDFs that currently fail with
`secondary_binary_too_large_for_inline_extraction` (size-aware chunked extraction with a hard
CPU/time cap, first N pages sufficient for classification and quotation), keeping every existing
integrity, paywall and court-host restriction in place. This is the single blocker standing
between the already-found Israeli scholarship and the literature pack.
