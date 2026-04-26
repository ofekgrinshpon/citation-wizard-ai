---
name: Research-mode citation router (Phases A→C)
description: Fast/Deep research footnotes go through the same chapter classifier + legal resolver + Stage 2 party-lookup retry, gated by per-mode flags in MODE_PROFILES
type: feature
---

# Research-mode citation router

The Fast/Deep research pipeline runs the academic-chapter citation router (`routeChapterFootnote` + `resolveCitation` + optional Stage 2 `lookupPartyNames`) over `finalFootnotes` after the existing `reasonFor` filter. Lives in `supabase/functions/legal-qa/index.ts` ~line 6446 in the `if (taskMode === RESEARCH_MODE)` block.

## Behaviour matrix

| classifier route | research-mode action |
|---|---|
| `legal_resolver` + `resolved` | mutate `fn.citation = canonical` (canonical re-emission, Phase B) |
| `legal_resolver` + `needs_party_lookup` (caselaw with docket but missing parties) | defer to Stage 2 if `modeProfile.partyLookupRetryEnabled`, else record drop |
| `legal_resolver` + other unresolved | leave original, count `drop_reason` |
| `bibliography` | DRY RUN — telemetry only (Phase D deferred) |
| `skipped` | telemetry only |

## Stage 2 (Phase C) — per-mode flags

Three flags in `MODE_PROFILES`:
- `partyLookupRetryEnabled` — Deep `true`, Fast `true` (locked 2026-04-26 after Fix C)
- `partyLookupPlaceholderPolicy` — both `"emit"` (partial caselaw > none, matches chapter precedent)
- `partyLookupMaxBatchSize` — Deep `6`, Fast `3` (excess pending → `failure_reasons.skipped_over_batch_cap`)

Stage 2 retry passes `party1Hint`/`party2Hint`/`fullDateHint`/`yearHint` + `partyLookupRetry: true` to a re-route. Research mode does NOT pass `titleHint`/`caseNumberHint` because there is no `fnNumberToCard` map (different from chapters).

## Fix C (2026-04-26) — procedure_type attached to research dockets

`legal_documents.procedure_type` is mixed: ~99 rows are true docket prefixes (`בג"ץ`, `ע"א`, …) and ~10k rows are broad subject categories (`משפחה`, `פלילי`). Helpers `looksLikeDocketPrefix` + `formatDocketForCaseLaw` (in `legal-qa/index.ts`) distinguish them. Prefix → prepend to `case_number` so cards emit `בג"ץ 18225-06-25 …`; category → carried as a weaker `procedure_category` hint. Stage 2's `caseTypeHint` priority: `card.docket_prefix` → `partial.caseType` → `card.procedure_category`. `partyLookup.ts` prompt renders `${prefix} ${caseNumber}` when the hint is a docket prefix. Bare docket stays the back-merge key. `citation-chat` is intentionally out of scope.

## Validated 2026-04-25 (Phase C ship — Deep)

`eval/phase-c-probe.mjs` Q1+Q6:
- **Deep (flag on)**: 8 attempted, 3 recovered + 3 with placeholders, 2 no_match, status `ok`/`no_candidates`. `wall_ms` median 60.2s vs Phase B baseline ~57s = +5.6% (well under 30% gate). Stage 2 wall_ms ~2-4s per request.
- **Fast (flag off)**: `party_lookup === null`, mode stays `canonical_reemission`, `party_lookup_config.enabled === false`. Pure regression — gate works.

## Validated 2026-04-26 (Fast Stage 2 LOCKED ON, run `phase-c-fast-on-2973bd49`)

After Fix C, re-ran `eval/phase-c-fast-on-probe.mjs` Q1+Q6 × 2 reps:
- **attempted=4, recovered=3 (all with `[חסר: caseType]` placeholder), failed=1** (`no_match`).
- **Survival**: 3/3 recovered citations appear in final `response.footnotes` with real party names + dates. Concrete example (Q1 r2 fn#5): `בג"ץ 2592/20 בן שושן נ' יועמ"ש לממשלה (פורסם ב, 28.5.2025)` — the exact resolution the user requested when typing `ע"א 2592/20` in `אזכור אחיד`.
- **Wall-time**: median 42.5s (faster than the ~57s Phase B baseline; Stage 2 itself costs ~3s). Well within the "few seconds" gate.
- **Caveat**: most Fast recoveries still carry a `[חסר: סוג ההליך]` placeholder for the procedure prefix because Fast's drafter sometimes emits dockets without one and `formatDocketForCaseLaw` can't synthesize a prefix it never had. Real party names + date still recovered, which is the high-value half. Future work: teach the Fast drafter to always emit a procedure prefix.

Prior Fast-off attempt (`phase-c-fast-on-0e91a9a7`, 2026-04-25) saw 6× `no_candidates` because cards stored bare `case_number` without prefix — Fix C resolved that.

## Telemetry shape

`metadata.research_engine = { depth, mode, footnotes_scanned, classification_counts, classify_reasons, legal_resolver: { resolved_count, unresolved_count, drop_reasons, canonical_rewrites, needs_party_lookup_candidates }, party_lookup: { attempted, recovered, recovered_with_placeholders, recovered_without_full_date, placeholder_fields, failed, failure_reasons, status, wall_ms } | null, party_lookup_config: { enabled, placeholder_policy, max_batch_size }, bibliography_dry_run, skipped, phase_ms }`

`mode` is `"canonical_reemission"` when Stage 2 didn't run (flag off OR no candidates), `"canonical_reemission+party_lookup"` when it did. Log tag: `[research-engine][phase-c][${depth}]`.

## Out of scope

- Bibliography route mutation in research mode (Phase D, deferred).
- Memo mode (`taskMode === "memo"`) — different envelope.
- Chapter pipeline (~lines 6272-6444) — separate counters, untouched.
