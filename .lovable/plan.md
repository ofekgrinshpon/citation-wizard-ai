## Context

All recent citation-quality work was scoped to the **academic chapter** path only:

- Type-aware classifier + router (`chapterCitationRouter.ts`)
- `preResolveNormalize` cosmetic cleanup before `resolveCitation`
- Tightened bare-docket regex requiring a court-name token within ±80 chars
- Stage 2 Perplexity party-lookup retry (`needs_party_lookup` → `lookupPartyNames` → re-route with `partyLookupRetry: true`)
- `case_law_database` `fullDate` relaxation under Stage 2
- Best-effort placeholder emission (`[חסר: ...]`) under Stage 2
- Rich telemetry: `classification_counts`, `legal_resolver`, `bibliography_routed`, `chapterPartyLookup` with `recovered_without_full_date`, `recovered_with_placeholders`, `placeholder_fields`

In `legal-qa/index.ts` line 6272, the entire pipeline above is gated by `if (isAcademicChapter && finalFootnotes.length > 0)`. Fast/Deep research footnotes today get ONLY:

1. Anchor-pass (Fast & Deep, mode-profile gated)
2. The `reasonFor` filter (`url_only` / `broken_title` / `placeholder_dominant` / `too_short` / `missing_parties`)
3. Renumber + orphan-superscript cleanup

No classification, no `resolveCitation`, no Stage 2 party-lookup, no placeholder policy.

## Goal

Bring research-mode footnotes onto the same observability + recovery substrate as chapters, **without** changing Fast/Deep drafting envelopes (`MODE_PROFILES` stays put) and **without** silently changing what citations users see.

Phased so each step is independently evaluable.

## Phase A — Observability only (no behavior change) — **SHIPPED**

Add classification + telemetry for Fast/Deep, NO mutation of footnote text.

### Code (as shipped)

1. After the `validFootnotes` filter (`legal-qa/index.ts` ~line 6446, immediately after the academic-chapter routing block), a `if (taskMode === RESEARCH_MODE && finalFootnotes.length > 0)` block runs `routeChapterFootnote(fn.citation)` — **dry-run only**, never overwrites `fn.citation` or any other field.
2. The classifier is called with **no `titleHint` / `caseNumberHint`** because research mode does not maintain a `fnNumberToCard` map keyed by footnote number; that's the honest observability baseline. Phase B/C can add hints later.
3. Aggregated under `metadata.research_engine` with the following shape (note `_dry_run` suffixes — explicit observation-only naming so future readers know Phase A didn't mutate):

```json
{
  "depth": "fast" | "deep",
  "mode": "observability_only",
  "footnotes_scanned": N,
  "classification_counts": {...},
  "classify_reasons": {...},
  "legal_resolver_dry_run": {
    "resolved_count": N,
    "unresolved_count": N,
    "drop_reasons": {...},
    "needs_party_lookup_candidates": N
  },
  "bibliography_dry_run": { "count": N, "by_type": {...}, "warnings": {...} },
  "skipped": { "count": N, "reasons": {...} },
  "dry_run_ms": N
}
```

`needs_party_lookup_candidates` is the Phase C preview — count of footnotes that *would* enter the Perplexity party-lookup retry if we turned it on for this depth.

4. `[research-engine][phase-a][${depth}]` log line emitted once per request for log-grep observability.

### Validation

- Run `eval/fast-parity-q1-q6-q21.mjs` and `eval/deep-mode-q1-q6-q21.mjs` as `phase-a-research-engine`.
- Acceptance:
  - `metadata.research_engine` present on every research-mode row.
  - `classification_counts` totals + `bibliography_dry_run.count` + `skipped.count` = `footnotes_scanned`.
  - `validFootnotes` content + `answer` body **byte-identical** to a baseline run on the same fixture (citations not mutated).
  - No regression on `anchored_count`, `dropped_unanchored_count`, `qa_guard` flags.
- If those hold, Phase A lands as a pure observability win.

## Phase B — Adopt `preResolveNormalize` + canonical re-emission for legal-routed Fast/Deep footnotes

Smallest behavioral change: when classifier says `statute` or `caselaw`, run cleanup + `resolveCitation`, and **only if `resolved === true`** overwrite `fn.citation` with the canonical form. Unresolved → leave the original text exactly as-is.

### Code

- Promote Phase A's observation block: when `route === "legal_resolver"` and `result.resolved`, set `fn.citation = result.canonical` and switch the telemetry counter from `would_resolve` → `resolved`.
- For `route === "bibliography"` (journal/book/report/web): **do NOT** overwrite in Phase B. Research mode citations are AI-generated with explicit prompt rules, and forcing `validateArticleCitation` could add `[חסר: ...]` markers that conflict with the existing `placeholder_dominant` filter. Defer to Phase D.
- For `route === "skipped"`: telemetry only.

### Why this is safe

`resolveCitation`'s canonical form is the *same* legal text in cleaner shape (e.g. fixes trailing supra fragments, balances parens). It cannot introduce hallucinations because it only re-emits fields it parsed.

### Validation

- `research-router-B` against same Q1/Q6/Q21 fixture.
- Acceptance:
  - For each footnote where `would_resolve` was true in Phase A, the new `canonical` string differs from the original ONLY in cosmetic ways (whitespace, punctuation noise, paren balance). Spot-check 5 examples in the eval summary.
  - `anchored_count` unchanged or up. `dropped_unanchored_count` unchanged.
  - No new entries in `qa_guard.flags`.

## Phase C — Stage 2 party-lookup retry for Fast/Deep caselaw

Mirror the chapter Stage 2 loop into research mode. This is the highest-leverage but also highest-risk step, so it lands behind a feature flag in `MODE_PROFILES`.

### Mode profile addition

In `supabase/functions/legal-qa/modeProfiles.ts`:

```ts
/** Enable Stage 2 Perplexity party-lookup retry on caselaw footnotes
 *  flagged needs_party_lookup. Off by default for Fast (latency-sensitive),
 *  on for Deep. */
partyLookupRetryEnabled: boolean;

/** When the retry succeeds but only a placeholder citation can be emitted,
 *  whether to keep it (`emit`) or drop it (`drop`). Fast: drop, Deep: emit. */
partyLookupPlaceholderPolicy: "emit" | "drop";
```

Defaults:

| field | fast | deep |
|---|---|---|
| `partyLookupRetryEnabled` | `false` | `true` |
| `partyLookupPlaceholderPolicy` | `drop` | `emit` |

Rationale: Fast's product promise is sub-2-minute latency; an extra Perplexity round-trip per unresolved caselaw can easily add 5-15s. Deep already takes longer and benefits more from coverage. Both can be flipped per-mode without code changes.

### Code

In the Phase B block, when a legal-routed caselaw returns `reason === "needs_party_lookup"` AND `modeProfile.partyLookupRetryEnabled`:

1. Collect into `pendingPartyLookup[]` exactly like the chapter loop (lines ≈6275–6354).
2. After the first pass, batch-call `lookupPartyNames(requests)`.
3. Re-route each hit with `partyLookupRetry: true`.
4. Apply the placeholder policy: if `result.placeholders?.length` and `modeProfile.partyLookupPlaceholderPolicy === "drop"`, treat as `failed` instead of `recovered`.

### Telemetry

Add `research_engine.party_lookup` mirroring `chapter_engine.party_lookup`:
`attempted`, `recovered`, `recovered_without_full_date`, `recovered_with_placeholders`, `placeholder_fields`, `failed`, `failure_reasons`, `status`.

### Validation

- Run `eval/fast-parity-q1-q6-q21.mjs` AND `eval/deep-mode-q1-q6-q21.mjs` (both have caselaw-heavy questions) as `research-router-C-fast` and `research-router-C-deep`.
- Acceptance:
  - Fast: `party_lookup` field is `null` (flag off) — pure regression test that the gate works.
  - Deep: `party_lookup.attempted > 0` on at least one of Q1/Q6 (constitutional caselaw).
  - Deep: `wall_ms` increase ≤ 30% vs the deep-baseline measured before C.
  - Deep: at least one `recovered` or `recovered_with_placeholders` across the 3 questions, OR a documented justification that none of the AI's caselaw citations were bare-docket form (i.e. nothing to recover).
- If `wall_ms` blows up or recovery is 0/0 across two repeats, flip Deep's flag back to `false` and treat Phase C as wired-but-disabled, same outcome as the chapter `recovered_without_full_date` story.

## Phase D — DEFERRED (not part of this plan)

- Bibliography route mutation (journal/book/report/web canonicalization) for research mode. Risk of conflict with `placeholder_dominant` filter and the `legislation-footnote-exception` "(לא נמצאו פרטים בבליוגרפיים)" pattern.
- Porting Phase A–C to `taskMode === "memo"` (Legal Assistant memo). Different envelope, different prompt, separate eval.

## Files touched

- `supabase/functions/legal-qa/index.ts` — add the research-router block after `validFootnotes`, mirror chapter telemetry.
- `supabase/functions/legal-qa/modeProfiles.ts` — add `partyLookupRetryEnabled` + `partyLookupPlaceholderPolicy` per mode.
- `.lovable/memory/logic/legal-qa/research-router.md` — new memory documenting the research-mode router and per-mode policy.
- `.lovable/plan.md` — replace with the C/D outcome.

## What we explicitly are NOT changing

- `MODE_PROFILES` drafting envelopes (word ranges, footnote floors, anchor pass settings).
- Drafter prompts (Fast structured / Deep legacy).
- The existing `reasonFor` filter (`url_only`, `broken_title`, `placeholder_dominant`, `too_short`, `missing_parties`) — this remains the final gate. Even after Phase C, a placeholder-emitted citation must still pass it. Specifically: `placeholder_dominant` drops unanchored citations with `[חסר]`; Stage 2 placeholder citations carry `source = "perplexity"` from `lookupPartyNames`, so they ARE anchored and survive. This is the same invariant that already protects chapters.
- `src/data/citationEngine.ts` (React side) — Stage 2 stays Deno-only, same as chapters.
- The academic chapter pipeline — chapter telemetry shape and behavior unchanged.
