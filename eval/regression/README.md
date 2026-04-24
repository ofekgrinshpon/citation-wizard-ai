# Legal-QA Regression Harness

Runs a fixed set of representative queries against the deployed `legal-qa`
edge function, asserts both **counts** (within tolerance bands) and
**shapes** (the specific failure modes we've seen), and diffs against
committed baseline snapshots.

## Quickstart

```bash
# 1. First ever run — capture current state as baseline
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... \
  node eval/regression/run-regression.mjs --update-baseline

# 2. Standard regression check (exits 1 on regression)
node eval/regression/run-regression.mjs

# 3. Subset
node eval/regression/run-regression.mjs --only=Q-extort,Q21

# 4. Multiple repetitions to absorb retrieval noise
node eval/regression/run-regression.mjs --repetitions=2
```

Reports written to `/mnt/documents/legal-qa-regression/<run-id>/`.

## What gets checked

10 stable assertion IDs, defined in `assertions.mjs`:

| ID | What it checks | Bug class it catches |
|----|----------------|-----------------------|
| `COUNT_TOTAL_FN` | `total_footnotes` within fixture's tolerance band | Catastrophic empty / runaway |
| `COUNT_ANCHORED` | `anchored_count >= total - 2` | Url loss / drift |
| `COUNT_RERANK_DROPS` | `metadata.rerank_drops` is an array | Telemetry regression |
| `SHAPE_DUP_STATUTE` | No two legislation FNs share an identity key | **Bug B**: dedupe brittleness |
| `SHAPE_TRUNC` | No citation ends in `התש?.` or trailing comma | **Bug C**: validator weakness |
| `SHAPE_NAKED_ANAPHORA` | No citation begins with `חוק זה` / `תקנות אלו` | **Bug C**: extractor over-match |
| `SHAPE_MIN_TOKENS` | Legislation citations have ≥2 hebrew tokens after keyword | **Bug C**: fragment citations |
| `SHAPE_RULE37_INTEGRITY` | `לעיל ה"ש N` points at non-fallback, non-truncated FN | **Bug E**: broken supra |
| `SHAPE_LEG_NO_SUPRA` | Legislation FNs never referenced via `לעיל ה"ש N` (Rule 37.5) | **Bug E**: rule violation |
| `SHAPE_BODY_COVERAGE` | Every `[N]` in body has a footnote, no orphans either way | Numbering drift |

## Baseline JSON format

```json
{
  "query_id": "Q-extort",
  "captured_at": "2026-04-24T...",
  "code_state": "before-C-E-B-fixes",
  "total_footnotes": 7,
  "footnote_identity_keys": ["law:...", "case:6821/93", ...],
  "known_failing_assertions": ["SHAPE_DUP_STATUTE", "SHAPE_TRUNC"],
  "note": "Each entry in known_failing_assertions must be tracked to a fix (C, E, or B). Remove on fix."
}
```

`known_failing_assertions` is the key trick: the runner expects these to
fail in the baseline state, so the harness exits **0** even when bugs are
present. As we ship C, E, B, we remove items from this list and update
the baseline.

A regression appears when an assertion fails that **isn't** on the
known-failing list — that's a real failure that exits 1.

## Workflow for the C → E → B sequence

1. **Before C:** `node eval/regression/run-regression.mjs` — confirm baseline state, no surprises.
2. **After C deploy:** run again. Expect `SHAPE_TRUNC`, `SHAPE_NAKED_ANAPHORA`, `SHAPE_MIN_TOKENS` to start passing. Open each baseline JSON, remove those IDs from `known_failing_assertions`. Commit. If any *other* assertion newly fails on any other query → C broke something, revert.
3. **After E deploy:** expect `SHAPE_RULE37_INTEGRITY` and `SHAPE_LEG_NO_SUPRA` to pass. Same diff discipline.
4. **After B deploy:** expect `SHAPE_DUP_STATUTE` to pass.

To re-capture all baselines (e.g. after a major intentional change):

```bash
BASELINE_LABEL="post-C-fixes" node eval/regression/run-regression.mjs --update-baseline
```

## Cost

6 queries × 1 rep × ~30–60s = 3–6 min wall time and 6 credits per run.
Acceptable given we run ~3 times across the C/E/B sequence.

## Out of scope

- Grounding/relevance scoring (problem D) — needs a different rubric.
- Academic-mode pipeline.
- CI integration. Run-on-demand only.
