## Two real bugs, one root cause + one tuning issue

We dug into `qa_logs` row `d4fdd0c1` to see what actually happened. Both bugs are real, but the diagnosis is different from what the user described.

### Bug A — Footnote 7 stays as a literal `[7]` in the body, never superscripted

The Rule 37 generator IS implemented and it ran (telemetry shows `total_repeats_expanded: 0`). The reason FN7 looks "assigned a late number even though it's the second citation" is **not** that Rule 37 missed a repeat — it's that the **statute-completion stage runs AFTER step 6 (superscript conversion) AND AFTER step 6b (appearance-order reordering)**.

What actually happened in this run:

```text
1. Drafter writes body with [1]…[2] markers (only 2 distinct numbers).
2. Drafter says "חוק יסוד: כבוד האדם וחירותו" inline with NO marker (naked mention).
3. Step 5d (Rule 37 generator) — scans for repeats — none found (only [1] and [2]).
4. Step 6 — converts [1]→¹, [2]→² in body.
5. Step 6b — appearance-order reorder, but there are only 2 footnotes used.
6. Statute-completion (Stage E.5) — detects naked "חוק יסוד…" mention,
   fetches Perplexity citation, appends as footnote #7, and inserts the
   string "[7]" right after the mention in the body.
   ↑ At this point the body is past step 6, so "[7]" never becomes "⁷".
   ↑ Reordering already ran, so the new footnote doesn't get renumbered to
     "appearance position 3" — it stays at #7 (or whatever number the loop
     assigned).
```

Net effect for the user: a literal `[7]` appears mid-paragraph instead of `³`, AND that footnote sits at #7 in the bibliography instead of #3.

**The fix is structural, not Rule-37-related.** Statute completion must produce body markers that go through the same superscript+reorder pipeline as drafter-emitted markers.

### Bug B — `תקנות דמי מחלה` (FN3) is irrelevant to סחיטת דמי חסות

This is a rerank-tuning issue. The regulation matched on the surface token `דמי` shared with the query's `דמי חסות`. The current rerank gate (`score >= 3` for non-caselaw) is forgiving and the rerank prompt's "domain mismatch" example only calls out caselaw mismatches, not legislation. The 5–6 band ("רלוונטי לענף הדין") is also too generous: a sick-pay regulation is technically "labor law" while the question is criminal/constitutional — different ענף דין, but Gemini-flash-lite gave it a 3 anyway.

There's also a secondary issue surfaced by the same row's telemetry:
- `named_statutes: ["חוק יסוד: כבוד האדם וחירותו", "חוק יעילה", "חוק (משטרה"]` — the statute-detection regex catches partial fragments (`"חוק יעילה"` from "חקיקה יעילה", `"חוק (משטרה"` from a parenthesised mention). Only one of three was a real statute name. Tightening the regex prevents wasted Perplexity calls and bogus completions.

---

## Plan

### Fix A1 — Move statute-completion BEFORE step 6 (superscript + reorder)

Restructure the pipeline so statute-completion runs at the same stage boundary as Rule 37: after the AI-footnote build loop, before step 6.

```text
build footnotes  →  Rule 37 short-form generator (step 5d)
                 →  statute completion  ← MOVED HERE (was after step 6b)
                 →  step 6 (superscript conversion)
                 →  step 6b (appearance-order reorder)
```

Concretely in `supabase/functions/legal-qa/index.ts`:

- The current statute-completion block at ~lines 5300–5577 runs against `answer` (the post-superscript string). Move the block up to right after the Rule 37 generator's rewrite-application (~line 4746), and have it operate on `answerBody` (the still-bracket-marker body) and `footnotes` (not yet renumbered).
- Inserts use `[${newFnNumber}]` exactly as today — but now step 6 converts the bracket to a superscript, and step 6b reorders by appearance, so FN7 will collapse to `³` (or whatever its true appearance position is) automatically. The reorder step's existing `reorderMap` rewrites `לעיל ה"ש N` cross-refs in footnote text, so any short-form citations that came from Rule 37 stay consistent.
- Streaming-event ordering: `emitStage("statute_completion", …)` moves with the block — it now fires before `footnote_validate`. The frontend's `StageProgressList` is order-agnostic, so no client change.

This single move fixes the "literal `[7]` in body" bug AND the "footnote 7 sits at end of list" bug.

### Fix A2 — Make Rule 37 generator re-run after statute completion (defensive)

After statute completion inserts new `[N]` markers, the same source could now appear twice in the body (e.g., drafter mentioned חוק יסוד once, and a later paragraph mentions it again — both naked, both get markers from completion, but one should become `שם` per Rule 37). The generator's first pass didn't see those markers because they didn't exist yet.

Run Rule 37 generator a second time after statute completion, scoped to the newly inserted markers only. Cheap re-walk of `answerBody`; reuses `shortNameRegistry` (recomputed for the new footnotes only) and the existing rewrite logic. Telemetry merges into the same `rule37_short_forms` block (cumulative counts).

### Fix A3 — Tighten statute-mention regex

Current named-statute extractor produces false positives (`"חוק יעילה"` from "חקיקה יעילה", `"חוק (משטרה"` from "המאבק (משטרה ופרקליטות)"). Tighten:

- Require the statute keyword (`חוק`, `חוק-יסוד`, `פקודת`, `תקנות`) to be **followed by either** a colon (basic laws) **or** a Hebrew word that doesn't start with `(` and isn't a known stop-word (`יעילה`, `מתאים`, `הולם`, `מספק`, …).
- Require a minimum length of 2 Hebrew words after the keyword before terminating on `,`/`.`/`)`.
- Add a denylist of generic descriptors that are never statute names.

This prevents wasted Perplexity calls and downstream bogus footnotes.

### Fix B1 — Tighten the rerank gate for non-caselaw

Two-line change in `rerankLocalMatches` (~lines 1199–1213):

- Raise the non-caselaw hard floor from `score >= 3` to `score >= 4`. Score 3 in the current rubric is "נוגע באופן רחוק / רקע כללי" — that's exactly the "תקנות דמי מחלה" failure mode. Score 4 forces the LLM to commit to "ענף דין קרוב" before passing.
- Caselaw stays at `>= 5` (already tighter), and the safety-valve fallback for caselaw-domain questions still allows `>= 3` so we don't ever empty the caselaw bucket.

### Fix B2 — Sharpen the rerank prompt with a legislation-specific example

Add one line to the prompt's anti-pattern section (~line 1114):

> דוגמה נוספת: שאלה על דין פלילי / סדר ציבורי + מקור על דיני עבודה, מיסוי, ביטוח לאומי = ציון 0–2, גם אם יש מילת מפתח משותפת ("דמי", "תשלום", "הסדר") — ענף הדין שונה.

Single-shot prompt addition. No code branching — the rerank model already returns 0–10.

### Fix B3 — Telemetry: log dropped-by-rerank doc titles + reasons

Currently `console.log` shows the score map but the doc titles/reasons aren't persisted. Add a `rerank_drops` array to `qa_logs.metadata`:

```text
rerank_drops: [
  { title: "תקנות דמי מחלה …", source_type: "israeli_law", score: 3, reason: "below_floor" },
  …
]
```

Capped at 10 entries. Lets us validate the gate change against future runs without re-tracing every query.

### What we are NOT doing in this pass

- Not retraining the rerank model — we're staying with Gemini-2.5-flash-lite. The prompt + gate change is enough.
- Not adding source-type-vs-question-type filtering. That's heuristic territory that risks over-filtering. The rerank tightening should be sufficient.
- Not retroactively rewriting old `qa_logs` rows.
- Not changing the drafter prompt to force `[N]` reuse over inline `שם`. The Rule 37 generator already handles the `[N]`-reuse path; the inline `שם` path is a different (and currently-correct) drafter behavior that's unrelated to bug A.

## Files touched

- `supabase/functions/legal-qa/index.ts`
  - Move statute-completion block (~5300–5577) up to after Rule 37 (~line 4746); switch its `answer` writes to `answerBody`.
  - Add second Rule 37 pass after statute completion, scoped to newly inserted markers.
  - Tighten named-statute regex + denylist (~5400 area).
  - Raise rerank non-caselaw floor `3 → 4` (~line 1199).
  - Add legislation example to rerank prompt (~line 1114).
  - Persist `rerank_drops` to `qa_logs.metadata` (~line 5670 area).
- `.lovable/memory/logic/legal-qa/post-processing-cleanup.md` — note the new ordering (statute-completion now between Rule 37 pass 1 and step 6).
- `.lovable/memory/logic/legal-qa/relevance-filtering.md` — bump documented gate threshold to `>= 4` for non-caselaw.

## Acceptance

- A repeat run of the same סחיטת-דמי-חסות query: footnote for חוק-יסוד appears as a superscript in the body (no literal `[N]`) AND lands at appearance position (≤3), not at the end.
- `qa_logs.metadata.statute_completion.named_statutes` for that run contains only real statute names (no `"חוק יעילה"`).
- `qa_logs.metadata.rerank_drops` includes `תקנות דמי מחלה` for that query (or it never enters retrieval at all).
- No regression: `qa_logs.metadata.rule37_short_forms` continues to fire on queries where the drafter does reuse `[N]` markers.
- Frontend `StageProgressList` still shows `statute_completion` event; only its position in the sequence shifts earlier.