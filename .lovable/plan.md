
# Stabilize Research Core citation output

Scope: changes only inside `supabase/functions/legal-qa/` (Core files + the Core dispatch block in `index.ts`). **No changes** to `BatchFootnoteBuilder`, `FootnoteReviewCard`, `citation-chat`, `src/components/**`, or any user-facing footnote flow.

---

## 1. No null answer on Core failure (`index.ts`)

Today, both Core-failure upserts (~lines 2622–2641 and 2657–2675) write `answer: null` and rely on `buildCoreFailureResponse` only for the HTTP body.

Fix: compute the Hebrew failure body once, then use it in **both** the response and the `qa_logs.answer` column.

- Refactor `buildCoreFailureResponse(reason)` so it exposes both the string body and a `Response`. Either return `{ body, response }`, or add a sibling `coreFailureBody(reason)` helper.
- In both `core.ok === false` and `catch (coreErr)` branches:
  - `answer: coreFailureBody(reason)` (never `null`).
  - Keep `pipeline_used: "core_failed"`, `core_attempted: true`, `core_last_stage`, `core_stage_runs`, `core_fallback_reason` / `core_error_message`, `core_acceptance_errors`, `core_partial`, `duration_ms` as already set.
- Also update the pre-insert "core_running" row to put a neutral placeholder (e.g. `"מעבד שאלה…"`) in `answer` instead of `null`, so a hard crash never leaves a null-answer row either. (Safe: the success/failure upsert overwrites it.)

Acceptance: `select count(*) from qa_logs where pipeline_used = 'core_failed' and answer is null` returns 0 on the three pilots.

---

## 2. Citation-marker / footnote integrity (`core/footnotes.ts`, `core/citation_quality.ts`, `core/runCore.ts`)

Root cause of Q3's `sup_no_footnote:23`: in `footnotes.ts`, when a `[cite:LSx]` has no entry in the `citations` map, the `forEach` callback `return`s early — so `footnotes` and `marker_to_footnote` get **fewer entries than `occurrences`**. The subsequent right-to-left replacement loop indexes `marker_to_footnote[i]` by occurrence index `i`, which is now misaligned → the wrong superscript is inserted for later occurrences, producing superscripts that point to non-existent footnote numbers.

### 2a. Pre-strip unknown / dropped markers in `citation_quality.ts`

Before calling `buildFootnotes`, the QA pass already strips markers for citations dropped in Phase A. Extend it to also strip markers whose `LS#`:

- does not exist in the ledger (`ledger.entries[*].sources[*].ls_id`), **or**
- does not exist in the `citations` map.

Add these LS ids to the `dropped` set with reason `unknown_marker_not_in_ledger` / `unknown_marker_not_in_citations`. They flow through the existing `stripMarkers` + `removed_citations` + claim-coverage path automatically.

### 2b. Defensive guard in `footnotes.ts`

Even after 2a, harden `buildFootnotes` so an unknown marker can never corrupt indices:

- Build `marker_to_footnote` keyed by occurrence index, but always push **one entry per occurrence** (even when skipped). For skipped occurrences, store `{ occurrence_index: i, ls_id, footnote_number: undefined, skipped: true }`.
- In the replacement loop, when `footnote_number` is `undefined`, replace the marker with `""` (same effect as stripping). This guarantees no leftover `[cite:LS#]` and no orphan superscript.
- Keep emitting the `marker_${ls_id}_has_no_citation` warning so it shows up in `core.warnings`.

### 2c. Tighten acceptance in `runCore.ts`

The current asserts run *after* rendering. Keep them, but:

- Treat `sup_no_footnote:N` as a **hard contract violation**, not just an acceptance error: log to console with full `marker_to_footnote` dump for debuggability before returning `core_failed`.
- Add a final pre-return assert: `!/\[cite:LS\d+\]/.test(qual.rendered_answer)` and `every superscript ∈ fnNumbers`. If either fails, return `core_failed` with `acceptance:render_invariant_violation` — but this should now be unreachable thanks to 2a + 2b.

### 2d. Claim-coverage recomputation

`runCitationQuality` already recomputes `claims_lost_all_support` and downgrades status to `insufficient_verified_sources` when too many claims lose support. After 2a, unknown markers participate in this calculation correctly. If the result is `insufficient_verified_sources`, the existing path returns `ok: false, fallbackReason: "quality_insufficient_verified_sources"` → `index.ts` then writes the Hebrew "insufficient verified sources" message (from §1) into `qa_logs.answer`. No broken answer is ever persisted.

Acceptance: zero `sup_no_footnote` errors, zero leftover `[cite:LS#]`, zero superscripts without a matching footnote in the three pilots.

---

## 3. Mirror Batch Footnote Builder cleanup inside Core only

Add a small deterministic post-processor used **only** by Core — no imports from `src/components/BatchFootnoteBuilder.tsx` or `citation-chat`. The behavior is mirrored, not shared. Location: a new helper `core/citationCleanup.ts` (Core-local), called from:

- `core/citations.ts` → applied to `canonical` strings produced by both the resolver and the passthrough branch in `buildCitationForSource`.
- `core/footnotes.ts` → applied to each footnote `text` (canonical first-use form) just before it is stored. Rule-37 short forms are not touched (they are already constructed deterministically).

### Cleanup operations (deterministic regex/string ops, no LLM)

1. **Decode HTML entities**: `&#8217;` → `’`, `&quot;` → `"`, `&amp;` → `&`, `&#39;` → `'`, `&nbsp;` → space, plus the named set used in BFB. Run once at the top.
2. **Dedupe duplicate docket / procedure prefix**: e.g. `בר"מ 5202/20 בר"מ 5202/20 …` → `בר"מ 5202/20 …`. Implement as a regex over `_shared/caseTypePrefixes.ts` prefix list followed by `\s+\d+\/\d+` — if the same `<prefix> <docket>` repeats consecutively, collapse to one occurrence. Apply for all known prefixes (`בג"ץ`, `בר"מ`, `עע"מ`, `ע"א`, `ע"פ`, `רע"א`, `רע"פ`, …, accepting ASCII and Hebrew quotes).
3. **Normalize punctuation**:
   - `,,+` → `,`
   - `\s+,` → `,`
   - `,\s*\.` → `.`
   - collapse `\s{2,}` → ` `
   - trim trailing whitespace before the final period.
4. **Trim broken trailing quote fragments**: if the citation ends with an opening quote followed by < N chars and no closing quote, or with `…"` truncated mid-sentence, strip from the last sentence boundary. Use a conservative regex: keep `"..."` only if both quotes balance; otherwise drop the dangling fragment.
5. **Source-type / label sanity flags** (no rewrites): in `buildCitationForSource`, if `ls.source_type === ""` **or** `(ls.title || "").trim()` matches the uninformative pattern `^\[DOC\]\s+[a-z0-9.-]+$`, add `citation_errors.push("uninformative_label")` and set `citation_quality = "partial"` if it would otherwise be `ok`. Then in `citation_quality.ts` Phase A, treat `uninformative_label` as a drop reason for `approved_web` origin sources (kept for primary). Removed markers flow through the standard `removed_citations` + claim-coverage path.
6. **Preserve Rule 37 invariants**: cleanup runs on canonical text only. Rule 37 short-form generation in `footnotes.ts` (`buildRule37Short`) is **not modified** — every occurrence still gets its own footnote number, repeats use שם / `לעיל ה"ש N`, and legislation never uses `לעיל ה"ש` (Rule 37.5).

### Boundaries

- No new prompt, no GPT call, no schema change.
- Cleanup is idempotent — running it twice produces the same string.
- A unit-style sanity check inside the helper file (commented examples in a JSDoc) documents the inputs/outputs of each transform; we are not adding a Vitest suite in this change.

---

## 4. Validation — run the three Deep pilots one at a time

After deploy, run each pilot in Deep mode (default `RESEARCH_PIPELINE` unset → `core`) and report per query:

1. מהם התנאים למתן צו מניעה זמני?
2. באילו תנאים בית המשפט יתערב בהחלטת רשות מנהלית שלא להפעיל סמכות, ומה ההבחנה בין אי-הפעלת סמכות לבין הפעלת סמכות פגומה?
3. מה מעמדה של הלכת אפרופים לאחר תיקון סעיף 25 לחוק החוזים?

For each row pulled from `qa_logs`:

- `id`, `pipeline_used`, `duration_ms`
- `answer` is non-null (mandatory)
- `metadata.core` present
- final answer text and footnotes list
- regex sweep: no `\[cite:LS\d+\]` leftover; every superscript glyph maps to a footnote number
- no `(ציטוט חסר)` in any footnote text
- Rule-37 sample (if repeats present): repeat uses `שם` or `לעיל ה"ש N`; legislation never uses `לעיל ה"ש`
- remaining placeholders / artifacts
- manual legal grade + citation grade

If any pilot still returns `core_failed`, report the exact `core_fallback_reason`, `core_last_stage`, and `core_acceptance_errors` — **no automatic fallback** to V4/V3.

---

## Files touched

- `supabase/functions/legal-qa/index.ts` — Core dispatch block only (sections around lines 2538–2682). Refactor `buildCoreFailureResponse` to expose the body string; write that body into `qa_logs.answer` on every Core-failure upsert; seed the pre-insert row with a neutral placeholder.
- `supabase/functions/legal-qa/core/footnotes.ts` — always-push-per-occurrence marker_to_footnote; safe replacement when footnote_number is undefined; apply cleanup helper to footnote text.
- `supabase/functions/legal-qa/core/citation_quality.ts` — pre-strip unknown / not-in-citations markers; treat `uninformative_label` as drop reason for approved_web; otherwise unchanged.
- `supabase/functions/legal-qa/core/citations.ts` — call cleanup helper on canonical/passthrough text; flag `uninformative_label`.
- `supabase/functions/legal-qa/core/citationCleanup.ts` — **new**, Core-local. Implements entity decode, duplicate-prefix collapse, punctuation normalization, trailing-fragment trim, label sanity check.
- `supabase/functions/legal-qa/core/runCore.ts` — strengthen acceptance log on `sup_no_footnote` (diagnostic only); no logic change to fallback contract.

## Out of scope (per user)

- `BatchFootnoteBuilder`, `FootnoteReviewCard`, `citation-chat`, all `src/components/**` and the existing footnote review / regenerate / edit / delete flow.
- Citation Review UI, shared citation-core extraction, NotebookLM, scraper.
- Planner / Retrieval / Verifier / Ledger changes.
- Touching V4/V3/V2 files (kept intact for `RESEARCH_PIPELINE=v4|v3` rollback).
