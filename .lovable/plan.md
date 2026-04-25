# Type-aware citation pipeline for academic chapters

## Problem (recap)

The chapter footnote loop (`legal-qa/index.ts` lines 6218–6238) currently does this for every chapter footnote:

1. Pick `declared = "caselaw"` if a caselaw shape regex matches, else `declared = "statute"`.
2. Call `resolveCitation(text, declared)` — which only knows how to resolve **5 legal source types** (basic_law / primary_legislation / secondary_legislation / case_law_published / case_law_database).
3. Anything that isn't statute/caselaw (journal article, book, book chapter, report, web source, etc.) gets routed as `statute` by default, fails `validateCitation` because it lacks `lawName` / `hebrewYear` / `firstPage`, and is logged as `engine_drop_reason: "missing_required"`.

That's why Q1=0/7, Q2=3/12, Q3=1/18 in the baseline — the resolver isn't broken, it's being **fed the wrong inputs**.

## Goal

Stop misrouting non-legal citations through the legal resolver. Add a classifier in front, route by type, and use distinct telemetry reasons so `missing_required` only means a real legal-citation extraction failure.

## Design

### 1. New `chapterCitationRouter.ts` (Deno-only, in `supabase/functions/_shared/`)

Single file with two responsibilities:

**(a) Classifier** — `classifyChapterFootnote(text: string): FootnoteSourceType`

Returns one of:
- `"statute"` — חוק / חוק-יסוד / פקודה / תקנות / כללים / צו (matches existing legal patterns)
- `"caselaw"` — quoted case prefixes (`בג"ץ`, `ע"א`, etc.), unquoted whitelist (`עב`, `בל`, ...), or `פ"ד`/`פד"ע` series
- `"journal_article"` — quoted title `"…"` + Hebrew journal name from the existing `HEBREW_JOURNALS` list (or `כתב-עת`); also `Vol. N, Page` patterns for English
- `"book"` — bold/italic title (`**…**` / `*…*`) without journal token, optional `(שנה)` at end
- `"book_chapter"` — `"…"` (article-style title) followed by `בתוך` + book reference
- `"report"` — opens with `דו"ח` / `דוח` / `מסמך מדיניות` / `נייר עמדה` / `המרכז למחקר ולמידע של הכנסת`
- `"web_source"` — raw URL pattern OR `(נצפה ב-…)` / `זמין ב-` markers without other source-type signals
- `"unknown"` — none of the above match with confidence

Implementation: ordered cascade of regex tests, first match wins. Patterns reused from `bibliography-lookup` (`HEBREW_JOURNALS`, `JOURNAL_HINT_RE`) and `citationResolver` (legal patterns). Conservative: when in doubt, return `"unknown"` rather than guessing.

**(b) Router** — `routeChapterFootnote(text, opts) → RouteResult`

```ts
type RouteResult =
  | { route: "legal_resolver"; sourceType: "statute" | "caselaw"; result: ResolveResult }
  | { route: "bibliography"; sourceType: BibliographySourceType; canonical: string; warnings: string[] }
  | { route: "skipped"; sourceType: "unknown"; reason: string };
```

- For `statute` / `caselaw` → call existing `resolveCitation(text, declared, opts)` unchanged.
- For `journal_article` → call existing `validateArticleCitation(text, text)` from `bibliography-lookup` (move it into a shared module so both functions can import it; logic is unchanged). This catches the common drafter mistakes (`(כרך X)` wrapper, missing journal name, missing first page) and emits placeholders. **No Perplexity call** — chapter writes already cost 8 credits and adding a per-footnote network round-trip per chapter would 4-10x latency. Use the existing local validator only.
- For `book`, `book_chapter`, `report` → light shape normalization (whitespace, quote canonicalization, missing-year placeholder) and pass through. These are accepted as-is unless they're missing obvious fields, in which case a `[חסר: …]` placeholder is added.
- For `web_source` → pass through after URL whitespace cleanup; flag in telemetry.
- For `unknown` → return `{ route: "skipped", reason: "unclassified_citation_shape" }`. The footnote is **kept verbatim** (matching the current non-blocking philosophy).

### 2. Wire the router into the chapter loop

Replace `legal-qa/index.ts` lines 6218–6238 with:

```text
for each footnote fn:
  if fn.citation contains [חסר ⇒ skip (existing behaviour)
  result = routeChapterFootnote(fn.citation)
  switch result.route:
    legal_resolver:
      if result.result.resolved:
        fn.citation = result.result.canonical
        legalResolved++
      else:
        legalUnresolved++
        legalDropReasons[result.result.reason]++   ← only legal failures
    bibliography:
      fn.citation = result.canonical                ← validated/normalised
      bibRouted[result.sourceType]++
    skipped:
      skipped[result.reason]++                      ← NOT missing_required
```

### 3. Telemetry shape (chapter_engine block)

Replace the current flat counters with a structured block:

```json
{
  "classification_counts": {
    "statute": 4, "caselaw": 3, "journal_article": 5,
    "book": 2, "book_chapter": 0, "report": 1, "web_source": 1, "unknown": 1
  },
  "legal_resolver": {
    "resolved_count": 6,
    "unresolved_count": 1,
    "drop_reasons": { "missing_required": 1 }   // ONLY statute/caselaw failures
  },
  "bibliography_routed": {
    "count": 8,
    "by_type": { "journal_article": 5, "book": 2, "report": 1 },
    "warnings": { "missing_journal": 1, "missing_first_page": 2 }
  },
  "skipped": {
    "count": 2,
    "reasons": { "engine_skipped_non_legal_type": 1, "unclassified_citation_shape": 1 }
  }
}
```

`missing_required` now appears **only** under `legal_resolver.drop_reasons` and only for genuine statute/caselaw extraction failures — matching what the user asked for.

### 4. Telemetry plumbing fix (carryover from previous diagnostic)

Add a one-line debug log right before the `qa_logs` insert at the end of the chapter path:

```ts
console.log(`[chapter][metadata] keys=${Object.keys(metadata).join(",")} academic=${!!academicProfile}`);
```

This tells us in the next eval whether `profile_used_academic` and `chapter_qa_guard` are absent at construction time (then the bug is upstream — `academicProfile` evaluating falsy) or are stripped during serialization (then the bug is in the writer). No behaviour change; one log line.

### 5. Update `chapter_qa_guard.high_unresolved_share`

Currently this is `unresolvedCount / totalFootnotes`. With the new split, "unresolved" should mean **legal_resolver failures only**, since bibliography items aren't even routed through the engine. Update the formula to:

```text
high_unresolved_share := legal_resolver.unresolved_count / max(1, legal_resolver.resolved_count + legal_resolver.unresolved_count)
```

The flag now correctly answers "of the citations that were SUPPOSED to be legal, how many failed?" — instead of being dominated by correctly-routed bibliography items.

### 6. Reuse from uniform-citation section

- `validateArticleCitation` from `bibliography-lookup/index.ts` → extract into `supabase/functions/_shared/articleCitationValidator.ts`, import from both functions. Logic byte-identical.
- `HEBREW_JOURNALS` list and `JOURNAL_HINT_RE` → same shared module.
- Existing `citationResolver.ts` unchanged.
- The Perplexity-completion path inside `bibliography-lookup` is **not** wired in for chapters in this milestone — adding a network call per footnote is too expensive for an 8-credit chapter write. Documented as a future option.

### 7. Eval

Re-run `PHASE=after node eval/academic-chapter-q1-q3.mjs` and compare against the saved `before` baseline. Success criteria:

- `legal_resolver.drop_reasons.missing_required` for Q1 drops from 7 → ≤1 (most footnotes were never legal in the first place).
- `bibliography_routed.count` is non-zero on all three Q's.
- `skipped.count` for unknown shapes is small (single digits).
- `chapter_qa_guard.high_unresolved_share` no longer lights up false-positively.
- Word counts, narrative phrasing, qualitative chapter quality unchanged (no behaviour drift — the router only changes what reasons are reported and which cleanup function runs per type).

### 8. Files touched

**New**
- `supabase/functions/_shared/chapterCitationRouter.ts` — classifier + router
- `supabase/functions/_shared/articleCitationValidator.ts` — extracted from `bibliography-lookup`

**Modified**
- `supabase/functions/legal-qa/index.ts` — replace lines ~6218–6238 (engine loop) and ~6516–6520 (chapter_engine telemetry block); add the one-line metadata-keys log; tweak `chapter_qa_guard.high_unresolved_share` formula
- `supabase/functions/bibliography-lookup/index.ts` — replace inline `validateArticleCitation` with import from the shared module (zero behaviour change)

**Memory**
- Update `.lovable/memory/features/academic-writing-mode/deep-pipeline-wiring.md` to reflect the new router + telemetry shape.

### Out of scope (deferred)

- Wiring the Perplexity bibliography-lookup network call into the chapter loop — too expensive per footnote; revisit if classification telemetry shows we actually need it.
- Tuning chapter writing behaviour (word counts, narrative voice, anchored thresholds) — explicitly held until the telemetry is honest.
- Porting the router to the React/uniform-citation side — out of scope for this milestone.
