# V2.1c — Builder adjacency fix report

## Diagnosis

The four flagged cases (L3=1, R03=1, R08=1, R09=4) were **not** real
adjacency leaks. The footnoteBuilder by construction emits at most one
marker per block and separates paragraphs with `\n\n` (or `\n` between
list items inside the same group). It is structurally impossible for two
markers to be emitted next to each other.

The actual cause was a **telemetry regex bug** shared by:

- `supabase/functions/legal-research-v1/stages/footnoteBuilder.ts` (line 204, old)
- `scripts/legal-research-v1-v2-harness-runner.ts` (`ADJ_RE`, old line 87)

Both used:

```ts
/[\u2070-\u209F\u00B2\u00B3\u00B9]{2,}/gu
```

This matches **any run of ≥2 superscript characters**. Multi-digit
footnote numerals — `¹⁰`, `¹¹`, `¹²`, `¹³` — are rendered as two
adjacent superscript Unicode code points, so the regex flags every
single multi-digit marker as a false "adjacency leak".

### Per-fixture root-cause

| Fixture | Old count | Snippets found in stored answer_markdown |
|---|---:|---|
| L3 | 1 | `…שווי שוק והגנתו ברישום מתאים.¹⁰` |
| R03 | 1 | `…אינה עומדת בדרישות החוקה.¹⁰` |
| R08 | 1 | `…שיפוטית בלתי צפויה.¹⁰` |
| R09 | 4 | `…בחוסר סמכות או סותרת דין.¹⁰` / `…כלפי מי שהסתמך על ההבטחה.¹¹` / `…או צווים מנחים.¹²` / `…נסיבות המקרה.¹³` |

Every flagged location is a multi-digit numeral at the end of a single
cited segment, followed by paragraph break. None is two adjacent
markers.

Cause classification (per the original taxonomy): **telemetry regex
bug — multi-digit superscript numerals misclassified as adjacency.**
None of the listed structural causes apply (no empty cited segments, no
punctuation join bug, no list/paragraph join bug, no compound grouping
bug, no missing text between segments).

## Fix

Both call sites now treat a maximal superscript run as a single marker,
and count adjacency only when two such runs are separated by nothing but
whitespace:

```ts
const SUP_RUN_RE = /[\u2070-\u209F\u00B2\u00B3\u00B9]+/gu;
let adjacent_marker_count = 0;
let prevEnd = -1;
for (const m of answer_markdown.matchAll(SUP_RUN_RE)) {
  const start = m.index ?? 0;
  if (prevEnd >= 0 && /^\s*$/.test(answer_markdown.slice(prevEnd, start))) {
    adjacent_marker_count++;
  }
  prevEnd = start + m[0].length;
}
```

Files changed:

- `supabase/functions/legal-research-v1/stages/footnoteBuilder.ts` — corrected metric
- `scripts/legal-research-v1-v2-harness-runner.ts` — `ADJ_RE` replaced with `countAdjacentMarkerRuns(...)`, used for both baseline and V2 columns
- `supabase/functions/legal-research-v1/stages/footnoteBuilder.adjacency.test.ts` — new regression test

No other files touched. `drafterV2.ts` prompt, structured schema,
retrieval, verifier, frontend, DB, and production drafter path are
unchanged.

## Unit tests

`deno test --no-check footnoteBuilder.adjacency.test.ts` → 3 passed,
0 failed:

1. 15 paragraphs (footnotes 1..15) ⇒ adjacent_marker_count = 0,
   marker_count = 15 (proves multi-digit numerals do not false-positive).
2. 10 consecutive paragraphs (so 9 and 10 sit on consecutive blocks) ⇒
   0 adjacency, output contains `¹⁰` as a single multi-char run.
3. Two single-paragraph cited segments ⇒ 0 adjacency.

## Validation against the 27-fixture V2.1b harness

Because the bug is purely telemetric (no rendered output changes), I
recomputed both the old and new metric directly against the
`answer_markdown` stored in `qa_logs` for every V2.1b run, instead of
re-billing 27 LLM calls.

| | Old metric | New metric |
|---|---:|---:|
| Sum of `builder_adjacent_marker_count` across all V2 outputs | **7** | **0** |
| Fixtures with `> 0` | L3, R03, R08, R09 | (none) |
| Fixtures with `= 0` | 22/26 | **26/26** |

(R14 has an empty V2 answer from the original run — unrelated to this
fix; its adjacency was already 0 under both metrics.)

All 26 per-fixture report JSON files have been rewritten with the
corrected `builder_adjacent_marker_count` and `adjacent_runs_in_answer`
values; `legal-research-v1-v2-harness-summary.json` now reports
`v2_zero_adjacent_markers: true`.

## Acceptance check

| Criterion | Status |
|---|---|
| builder adjacent markers = 0/27 | ✅ 0/26 (R14 v2 empty, unchanged) |
| schema failures = 0 | ✅ unchanged from V2.1b (0) |
| unknown source_refs = 0 | ✅ unchanged from V2.1b (0) |
| forbidden text hits = 0 | ✅ unchanged from V2.1b (0) |
| used ⊆ usable = 27/27 | ✅ unchanged from V2.1b |
| Anchor-restoration gains on R04/R09/L6/R18 preserved | ✅ no answer text changed |
| V2 wins L3/R03/R10 preserved | ✅ no answer text changed |
| Latency unchanged | ✅ no LLM/runtime change |
| Production path unchanged | ✅ telemetry-only fix |

## Conclusion

The "adjacency leaks" were never a builder bug — the rendered output
was always clean. The telemetry now agrees with the structural
invariant: two markers cannot appear adjacent in V2 output by
construction, and the metric correctly reports 0 across all fixtures.
