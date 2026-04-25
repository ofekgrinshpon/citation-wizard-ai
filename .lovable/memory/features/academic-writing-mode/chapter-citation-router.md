---
name: Academic Chapter — Type-Aware Citation Router
description: Chapter footnotes are classified by source type and routed to the appropriate validator (legal resolver vs. article validator vs. light normalization), so non-legal sources no longer pollute legal-resolver telemetry
type: feature
---

Academic chapter writes generate footnotes spanning many source types (statutes, case law, journal articles, books, book chapters, reports, web sources). Routing all of them through the legal `resolveCitation` engine produced false-positive `missing_required` failures — books were rejected for lacking `lawName`, articles for lacking `caseNumber`, etc.

### Mechanism

After footnote parsing, each footnote text is classified by `routeChapterFootnote(text)` from `supabase/functions/_shared/chapterCitationRouter.ts`. The classifier returns `{ type, route, ...validatorOutput }`. Routes:

- `statute` / `caselaw` → existing `resolveCitation` (legal resolver). Only failures here count as legal `unresolved`.
- `journal_article` → shared `validateArticleCitation` from `supabase/functions/_shared/articleCitationValidator.ts` (extracted out of `bibliography-lookup` for reuse).
- `book` / `book_chapter` / `report` / `web_source` / `unknown` → light normalization only (e.g., append `[חסר: שנה]` when year missing). Never enter the legal resolver.

### Telemetry shape (`qa_logs.metadata.chapter_engine`)

Replaced the previous `{resolved_count, unresolved_count, drop_reasons}` binary with:

```json
{
  "classification_counts": { "statute": 3, "caselaw": 4, "journal_article": 6, "book": 2, "book_chapter": 0, "report": 1, "web_source": 1, "unknown": 1 },
  "legal_resolver":      { "attempted": 7, "resolved": 6, "unresolved": 1, "drop_reasons": { "missing_required": 1 } },
  "bibliography_routed": { "journal_article": 6, "book": 2, "book_chapter": 0, "report": 1, "web_source": 1 },
  "skipped":             { "unknown": 1 }
}
```

### QA guard rescoping

`chapter_qa_guard.high_unresolved_share` is now `legal_resolver.unresolved / max(1, legal_resolver.attempted)`, so the threshold (default 0.4) measures **only** legal-citation failures. Bibliography items can no longer raise the flag.

### Telemetry plumbing probe

A `[chapter][metadata-probe]` log line near `qa_logs` insert prints `Object.keys(metadata)` to confirm `profile_used_academic` and `chapter_qa_guard` are present at construction time (they were missing in the baseline `PHASE=before` run).

### Files

- `supabase/functions/_shared/chapterCitationRouter.ts` — classifier + router (new).
- `supabase/functions/_shared/articleCitationValidator.ts` — extracted shared journal-article validator (new).
- `supabase/functions/legal-qa/index.ts` — replaces post-parse resolver loop with `routeChapterFootnote`, refactors `chapter_engine` telemetry, rescopes `high_unresolved_share`, adds metadata probe.
- `supabase/functions/bibliography-lookup/index.ts` — imports the shared article validator instead of owning its own copy.
