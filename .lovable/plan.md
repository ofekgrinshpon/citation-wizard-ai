
# Drafter Cluster-Prevention Plan (prompt-only + telemetry)

Scope: drafter prompt guidance + deterministic cluster telemetry only.
No retrieval, Perplexity, verifier, candidate-pool, source-selection, DB,
frontend, extra LLM call, placement repair, marker movement, thin-space,
Rule 37, or repeated-citation work.

## 1. Prompt change — `supabase/functions/legal-research-v1/stages/drafter.ts` `SYSTEM_PROMPT` (lines ~233–249)

The existing "מיקום הערות שוליים" block already says "source preservation
outranks aesthetics" and "split sentences before clustering". The new
guidance keeps that ordering but explicitly forbids the two failure modes
we still see: clusters on a single word, and a final summary sentence that
re-cites every source.

Replace the current placement block with a tightened version that adds the
user's Hebrew wording verbatim (kept whole so we don't dilute it):

```
מיקום הערות שוליים:
- קדימות שימור מקורות (גוברת על כל כללי המיקום שלהלן):
  * אין לוותר על מקור מאומת או על הערת שוליים תומכת כדי לשפר את האסתטיקה של מיקום ההערות.
  * אם נדרש לבחור בין השארת מקבץ הערות לבין השמטת מקור — השאר את המקור. שיפור מיקום לעולם לא מצדיק הסרת תמיכה.
  * אין למחוק, לאחד, או לדלג על מספר מקור המופיע ברשימת המקורות שניתנה לך.
- הצמדה לטענה הספציפית:
  * הצמד כל הערת שוליים לטענה הספציפית שהיא תומכת בה. אין לרכז כמה הערות שוליים על אותה מילה או בסוף משפט אחד, אלא אם אכן מדובר באותה טענה יחידה הנתמכת במצטבר על ידי כמה מקורות.
  * כאשר כמה מקורות תומכים בפסקה אחת, פצל את הפסקה למשפטים או לטענות משנה, והצב כל הערה במקום הטבעי ליד הטענה שהיא תומכת בה.
  * אין לוותר על מקור מאומת רק כדי לשפר את מיקום ההערות; אם מקור נחוץ, שלב את הטענה שהוא תומך בה בגוף הפסקה.
- איסור "מצבור סיום":
  * אל תוסיף בסוף התשובה משפט מסכם הנושא את כל הערות השוליים.
  * מסקנה או סיכום אינם צריכים לחזור על כל המקורות שכבר תמכו בטענות בגוף התשובה. אם המסקנה אינה מוסיפה טענה חדשה — אל תצרף לה הערות שוליים.
- חזרות סמוכות של אותו סמן: כמו קודם — אין לחזור על אותו מספר על משפטים סמוכים, אך אין להסירו אם נדרש לתמיכה.
- פורמט סמנים: כמו קודם (ספרות עיליות יוניקוד, ללא סוגריים, ¹⁰/¹¹/¹² ולא 10/11/12).
```

Removed sub-bullets ("עדיף לשלוח ¹²³ מאשר להשמיט מקור") are intentionally
dropped — they implicitly licensed clusters. Source-preservation precedence
is preserved by the first block.

No other prompt content changes. No tool-schema change. No emit_draft
parameter change.

## 2. Telemetry — `validatePlacement` (~lines 489–582 in `drafter.ts`) and `PlacementReport` (`lib/types.ts`)

Add deterministic fields needed by the validation report. No gating, no
retry, no repair. Pure measurement.

New fields on `PlacementReport`:
- `max_cluster_len: number` — longest run length from `[⁰-⁹]{2,}` matches
  (0 if no clusters). Existing `cluster_count` stays as "extra markers
  in clusters" for back-compat; add `cluster_run_count` = number of
  cluster runs.
- `final_paragraph_marker_count: number` — distinct markers in the final
  paragraph.
- `final_summary_dump: boolean` — true iff the final paragraph contains
  ≥5 distinct markers OR its last sentence contains ≥5 distinct markers.
- `final_summary_dump_count: number` — 0 or 1 (matches the boolean,
  exposed as a count for aggregation).

Implementation in `validatePlacement`:
- During the cluster scan, track `max_cluster_len = max(m[0].length)`.
- After paragraph split, compute the final paragraph's distinct marker
  count and its last sentence's distinct marker count using existing
  `SUP_TO_DIGIT` walker.
- Append all four fields to the returned object. `ok` definition
  unchanged (still cluster_count===0 && out_of_order===0 && end_dump===0).

Persisted via existing `marker.placement` → `metadata.drafter.marker_validation.placement`. No new metadata blob, no new top-level field.

## 3. Validation harness

New runner: `scripts/legal-research-v1-cluster-prevention-runner.ts`,
modelled on `legal-research-v1-citation-cleanup-runner.ts`.

Fixtures: L1–L6 from `eval/legal-research-v1/fixtures.json` + one ad-hoc
question:
`"האם כישלון מערכתי באכיפת עבירת גביית דמי חסות (פרוטקשן) יכול להוות מחדל חקיקתי בהגנה על הזכות לחיים וביטחון?"`
(id `PROT`).

Per fixture, capture from `qa_logs.metadata`:
- hard gates: `marker_validation.ok`, `internal_id_leak === false`,
  `footnote_count === used_sources.length`,
  `used_sources ⊆ verifier.usable`
- placement: `cluster_count`, `cluster_run_count`, `max_cluster_len`,
  `end_paragraph_dump_count`, `final_paragraph_marker_count`,
  `final_summary_dump_count`, up to 5 `cluster_samples` and
  `end_dump_samples`
- runtime: `total_ms` and Δ vs phaseE5 baseline
- source list count vs candidate pool (sanity: no drops)

Baselines: take the most recent run per fixture from the existing
`reports/legal-research-v1-citation-cleanup-*.json` set as the "before"
snapshot. Re-run with the new prompt as "after". Diff in
`reports/legal-research-v1-cluster-prevention.md`.

Also a small qualitative spot-check (manual, 2–3 lines per fixture) on
whether the answer body reads coherently — captured in the `.md` only.

## 4. Tests

Unit tests in `drafter.cleanup.test.ts` (extend, no new file):
- `validatePlacement` reports `max_cluster_len = 4` for `אחריות¹²³⁴`.
- `final_summary_dump = true` when the last paragraph is
  `לסיכום, האחריות חלה.¹²³⁴⁵`; `false` when markers are scattered.
- Existing cluster/end-dump tests still pass; field counts unchanged.

Prompt change is non-testable in unit tests — covered by the L1–L6+PROT
runner.

## 5. Acceptance gates (reported, not enforced in code)

- All hard grounding gates green across L1–L6+PROT.
- No source drops (used count == prior used count ± natural variance, no
  systematic loss).
- `cluster_count` and `max_cluster_len` decrease materially vs baseline.
- `final_summary_dump_count == 0` on every fixture (especially PROT).
- Runtime delta within noise (≤ a few seconds; we only changed prompt
  text length by ~250 chars).
- Spot-check confirms answers remain coherent.

If clusters or summary dumps persist on PROT after the prompt-only
change, stop and report — no repair/retry will be added in this phase.

## Out of scope (explicit)

Retrieval / Perplexity / verifier / candidate pool / source selection /
DB / frontend / extra LLM call / placement repair / marker movement /
thin-space / comma-separated markers / Rule 37 / repeated-citation
short forms / failing or retrying answers based on the new telemetry.
