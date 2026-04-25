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
- `partyLookupRetryEnabled` — Deep `true`, Fast `false`
- `partyLookupPlaceholderPolicy` — both `"emit"` (partial caselaw > none, matches chapter precedent)
- `partyLookupMaxBatchSize` — Deep `6`, Fast `3` (excess pending → `failure_reasons.skipped_over_batch_cap`)

Stage 2 retry passes `party1Hint`/`party2Hint`/`fullDateHint`/`yearHint` + `partyLookupRetry: true` to a re-route. Research mode does NOT pass `titleHint`/`caseNumberHint` because there is no `fnNumberToCard` map (different from chapters).

## Validated 2026-04-25 (Phase C ship)

`eval/phase-c-probe.mjs` Q1+Q6:
- **Deep (flag on)**: 8 attempted, 3 recovered + 3 with placeholders, 2 no_match, status `ok`/`no_candidates`. `wall_ms` median 60.2s vs Phase B baseline ~57s = +5.6% (well under 30% gate). Stage 2 wall_ms ~2-4s per request.
- **Fast (flag off)**: `party_lookup === null`, mode stays `canonical_reemission`, `party_lookup_config.enabled === false`. Pure regression — gate works.

## Fast Stage 2 — pending decision

User wants Fast flag flipped on if added latency ≤ "few seconds" AND output quality improves meaningfully. Deep median Stage 2 cost is 2-4s per request. Fast `needs_party_lookup_candidates` is 1-2 per Q1/Q6, so a flip would add roughly the same 2-4s on caselaw-heavy questions. Pending follow-up eval per the C.2 acceptance criteria in `.lovable/plan.md`.

## Telemetry shape

`metadata.research_engine = { depth, mode, footnotes_scanned, classification_counts, classify_reasons, legal_resolver: { resolved_count, unresolved_count, drop_reasons, canonical_rewrites, needs_party_lookup_candidates }, party_lookup: { attempted, recovered, recovered_with_placeholders, recovered_without_full_date, placeholder_fields, failed, failure_reasons, status, wall_ms } | null, party_lookup_config: { enabled, placeholder_policy, max_batch_size }, bibliography_dry_run, skipped, phase_ms }`

`mode` is `"canonical_reemission"` when Stage 2 didn't run (flag off OR no candidates), `"canonical_reemission+party_lookup"` when it did. Log tag: `[research-engine][phase-c][${depth}]`.

## Out of scope

- Bibliography route mutation in research mode (Phase D, deferred).
- Memo mode (`taskMode === "memo"`) — different envelope.
- Chapter pipeline (~lines 6272-6444) — separate counters, untouched.
