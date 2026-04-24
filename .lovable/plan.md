## Goal

Stop shipping fixes that introduce new bugs. Build a regression harness for `legal-qa` that:
1. Runs a fixed set of representative queries against the deployed edge function.
2. Asserts both **counts** (within tolerance bands) and **shapes** (the specific failure modes we've actually seen).
3. Diffs against committed baseline snapshots so intentional changes are explicit and unintentional ones fail loudly.
4. Captures the current (buggy) state as the "before" baseline so we can prove C/E/B fixes actually move the needle without breaking other queries.

Reuses the existing `eval/` infrastructure (auth flow, edge-function call, `qa_logs` lookup) — does not replace `run-eval.mjs` or `stability-test.mjs`.

---

## Fixture queries (6)

Chosen to cover the failure modes we've actually seen, plus stable controls:

| ID | Query | Why |
|----|-------|-----|
| Q6 | באילו נסיבות ניתן לאכוף תניית אי-תחרות בחוזה עבודה בישראל? | Stable control — was clean before regressions |
| Q-extort | סחיטת דמי חסות — היקף האחריות הפלילית והאזרחית | The query that surfaced duplicate statutes + irrelevant FNs + broken supra |
| Q21 | מה קובע סעיף 17 לחוק שירות המדינה (מינויים)... | Statute-anchored, exercises pinpoint + statute-completion path |
| Q22 | מהי המשמעות של סעיף 39 לחוק החוזים (חלק כללי)... | Statute-anchored with named law in body — exercises Rule 37.5 |
| Q-basic-law | מהו היקף ההגנה החוקתית על הזכות לחירות לפי חוק-יסוד: כבוד האדם וחירותו? | Forces "חוק-יסוד:" extraction path (the regex special case) |
| Q-procedural | מתי בית המשפט יתיר תיקון כתב טענות בשלב מתקדם של ההליך? | Procedural domain, low statute density, stresses grounding/relevance |

Stored as a JSON file so adding/removing queries doesn't require code changes.

---

## Files created

```text
eval/regression/
  fixtures.json              # 6 queries + tolerance bands + per-query overrides
  assertions.mjs             # Pure shape-check functions (no I/O), exported and unit-tested
  run-regression.mjs         # CLI: run fixtures → collect → assert → diff baseline → exit 0/1
  baselines/
    .gitkeep                 # Snapshots written here on first run with --update-baseline
  README.md                  # How to run, how to update baselines, what each assertion checks
```

No changes to existing `eval/*.mjs` files. No changes to `supabase/functions/legal-qa/`.

---

## What the runner does

```text
┌─────────────────────────────────────────────────────────────────┐
│ 1. Mint admin JWT (reuse stability-test.mjs auth flow)         │
│ 2. For each fixture query:                                     │
│      POST to /functions/v1/legal-qa                            │
│      Wait, fetch matching qa_logs row by metadata.eval_run_id  │
│      Capture: footnotes[], total_footnotes, metadata.*         │
│ 3. For each result, run assertions:                            │
│      - Count assertions (tolerance bands)                      │
│      - Shape assertions (the bug-class checks below)           │
│ 4. Diff result snapshot vs baselines/<query-id>.json           │
│      - Field-level diff on counts                              │
│      - Set diff on footnote identity keys                      │
│ 5. Write report.md + report.json to /mnt/documents/legal-qa-   │
│    regression/<run-id>/                                        │
│ 6. Exit 0 if all pass, 1 if any assertion fails                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Assertions (the checks that would have caught the recent bugs)

**Count assertions** (per query, from `fixtures.json`):
- `total_footnotes` within `[min, max]` band (e.g. 5–12)
- `anchored_count >= total_footnotes - 2`
- `metadata.rerank_drops` is an array (field exists; doesn't have to be non-empty)

**Shape assertions** (universal — apply to every query):

1. **No duplicate statutes.** Compute a normalized identity key for each `legislation_*` footnote (mirror the logic from the DB function `compute_verified_source_identity`: strip year suffixes, gazette refs, lowercase, collapse whitespace). Fail if two FNs share a key. *Catches: duplicate `תקנות דמי מחלה` style bugs.*

2. **No truncated citations.** Reject any footnote whose `citation` field matches `/התש[א-ת]?\.\s*$/` or ends mid-word (`/[א-ת]\.\s*$/` without preceding `עמ` / `ס"ח` / known abbreviations). *Catches: `התשע.` truncation.*

3. **No naked anaphora as statute name.** Reject footnotes whose `citation` begins with `חוק זה`, `תקנות אלו`, `החוק האמור`, `הפקודה הנ"ל`, etc. *Catches: extractor over-matching pronouns.*

4. **Min token requirement.** Any `legislation_*` citation must have ≥2 Hebrew word-tokens after `חוק`/`פקודת`/`תקנות`. *Catches: `חוק יעילה`-class fragments.*

5. **Rule 37 short-form integrity.** For every body occurrence of `לעיל ה"ש N` or `שם` (Rule 37.7), verify FN N exists, is not flagged `fallback: true` in metadata, and has a non-truncated citation. *Catches: supra pointing at garbage.*

6. **Legislation never gets supra.** Per Rule 37.5: no `legislation_*` footnote may be referenced via `לעיל ה"ש N` in the body. Must use `ס' X ל<lawName>` form or full re-cite. *Catches: rule violations from generator.*

7. **Body coverage.** Every footnote number `[N]` referenced in `answer` body has a corresponding entry in `footnotes[]`, and vice versa (no orphans either way). *Catches: numbering drift.*

8. **Identity-key set diff vs baseline.** Symmetric difference between current run's footnote identity-keys and the baseline's. Surfaces additions/removals query-by-query without requiring exact match (counts can drift by ±1 on retrieval noise without failing).

Each assertion has a stable ID (`SHAPE_DUP_STATUTE`, `SHAPE_TRUNC`, etc.) so failures in `report.md` are greppable and stable across runs.

---

## Baseline snapshots

`baselines/<query-id>.json` shape:

```json
{
  "query_id": "Q-extort",
  "captured_at": "2026-04-24T...",
  "code_state": "before-C-E-B-fixes",
  "total_footnotes": 7,
  "anchored_count": 5,
  "footnote_identity_keys": ["law:חוק העונשין|...", "case:6821/93", ...],
  "known_failing_assertions": ["SHAPE_DUP_STATUTE", "SHAPE_TRUNC", "SHAPE_RULE37_INTEGRITY"]
}
```

The `known_failing_assertions` field is the key trick: the runner expects these to fail in the baseline state, so the harness exits **0** even though the bugs are present. As we ship C, E, B, we remove items from this list. A regression appears when an assertion fails that **isn't** on the known-failing list — that's a real failure that exits 1.

This is what lets us (a) capture the buggy "before" state without the harness screaming, and (b) prove that each fix removes specific assertion failures without introducing new ones.

---

## How we'll use this in the C → E → B turns

1. **End of this turn:** harness exists, runs against deployed function, baselines captured with current bugs documented in `known_failing_assertions`. I'll report which assertions fail per fixture so you see the "before" state.
2. **Before C:** run harness, confirm baseline state.
3. **After C:** run harness. Expect `SHAPE_TRUNC`, `SHAPE_NAKED_ANAPHORA`, `SHAPE_MIN_TOKENS` to start passing on Q-extort and Q-basic-law. Update baselines, remove those IDs from `known_failing_assertions`. If any other assertion newly fails on any other query → C broke something, revert.
4. **After E:** expect `SHAPE_RULE37_INTEGRITY` and `SHAPE_LEG_NO_SUPRA` to pass. Same diff discipline.
5. **After B:** expect `SHAPE_DUP_STATUTE` to pass.

---

## Out of scope for this turn

- No changes to `supabase/functions/legal-qa/index.ts`. Pipeline behaviour is unchanged; we're only observing it.
- No CI integration. Harness is run-on-demand via `node eval/regression/run-regression.mjs`. CI hook is a separate decision.
- No grounding/relevance scoring (problem D) — that needs its own scoring rubric and a different harness shape; out of scope for the C/E/B sequence.
- No fixture for the academic-mode pipeline; this harness covers `legal-qa` research mode only.

---

## Risks and mitigations

- **Retrieval noise:** the same query can return 6 vs 7 FNs across runs. Mitigation: tolerance bands on counts; identity-key set-diff (not exact equality) for shape; option to run each fixture N=2 times and union the assertion failures (harness flag `--repetitions`, default 1 to keep cost down).
- **Cost:** 6 queries × ~30–60s each = 3–6 min wall time and 6 credits per run. Acceptable given we run it ~3 times across the C/E/B sequence.
- **Auth flakiness:** reuse the proven magic-link flow from `stability-test.mjs` verbatim.
- **`known_failing_assertions` becoming a dumping ground:** every entry must have a tracking note (which fix is expected to remove it: C, E, or B). Enforced by a comment field in the baseline JSON.

---

## Deliverable at end of this turn

- 5 new files under `eval/regression/`.
- Captured baseline JSONs for all 6 fixture queries (one harness run against the current deployed function).
- A short readout in chat showing the per-query assertion-failure summary — that's the "before" snapshot we'll measure C, E, B against.

After you approve, I switch to default mode and execute.