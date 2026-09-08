# v2_quotable_span_extraction_and_advisory_pivot_v1 — acceptance report

## Root cause confirmed

Documents were read, but the literal text was only present in the agent's context for a few
turns: `compactAgentMessages` keeps the last 4 tool payloads verbatim and digests older ones to
240 chars. The rolling research state carried source ids, identity and budgets — no text. By the
memo turn the agent had no verbatim material left and reconstructed spans, so 8 of 9 pairs died
at `matchSpan`.

## Changes (V2 only)

- `evidence/quotable.ts` (new) — deterministic literal-excerpt preparation: strip invisible
  bidi/zero-width/soft hyphen, normalize exotic spaces, snap window edges to whitespace. Stored
  bodies untouched.
- `evidence/evidenceStore.ts` — served-quote registry (`serveQuotes`, `servedQuotes`), deduped,
  capped at 24 × 900 chars, serialized with the store; windows snap to word boundaries.
- `tools/fetch.ts` — every path (new fetch, cached read, targeted section, generic re-read)
  returns `exact_source_text: [{quote_id, text}]` plus an explicit verbatim-copy instruction.
  `search_path_exhausted` is now advisory (`same_issue_no_yield` counter); no path withholds text.
- `agent/contextWindow.ts` — the rolling state re-surfaces the last 6 served excerpts with ids.
- `agent/researchAgent.ts` — a suppressed repeat re-attaches that source's served excerpts.
- `agent/prompt.ts` — quoted_span must be copied from `exact_source_text`/state excerpts;
  no-yield signals are advice, not prohibition.
- `verification/spanMatch.ts` — normalization extended (maqaf, ellipsis, zero-width) only.
  Identity, temporal, span and support checks unchanged in strictness; paraphrase still rejected.
- `drafting/render.ts` — internal excerpt ids (`S2-q25`) never printed in a citation.

Tests: `src/test/quotableSpanExtraction.test.ts` (6). Full suite 54 files / 584 tests. Build and
typecheck clean. `legal-research-v2` deployed. V1, models, budgets, guide and drafter unchanged.

## Rerun of the same chapter

Attempt 1 (`b24b02d1…`) died as `stale_worker_timeout` (infrastructure, no heartbeat after 60 s),
credits refunded. Attempt 2 delivered:

- job `a32c87be-f781-4525-a12e-28303a740e63`, run `ddb200d4-5628-4e24-9a8d-98007dab5f5b`
- 356.5 s, 24 steps, 4 chunks, 29 model calls, 326,804 prompt / 16,543 completion tokens
- 8 searches, 5 fetches, 5 lookups; 5 documents discovered, 4 bodies read
- evidence pairs 6 · identity verified 6 · **span verified 2** (was 1 of 9) · supports 2 ·
  temporal current-verified 2 · verified claims 2 · unsupported 2 · invariant errors 0
- cited: S2 nevo.co.il consolidated חוק יחסי ממון — **the exact document that produced zero
  quotable spans last run**
- chapter 1,395 chars, footnote [5], honest disclosure of what could not be verified

## Read

The span-quotability failure is fixed for the statute: the previously unquotable consolidated law
is now the cited source, and no span was rejected as `not_found` for it. Richness is still low,
but the bottleneck has moved: S3 (supremedecisions judgment), S4 (LawMate) and S5 (Haifa
scholarship PDF) were fetched and read yet failed **identity** verification, and 12 turns were
again spent on no-yield re-reads before commit.

## Introduction + Conclusion

Not yet. Body quality is honest but still one-source thin; intro/conclusion depend on the same
evidence base and would reproduce it. Next smallest track: judgment/scholarship identity
verification on fetched bodies (`v2_judgment_and_scholarship_identity_v1`), plus turning the
advisory no-yield signal into an actual dimension pivot.
