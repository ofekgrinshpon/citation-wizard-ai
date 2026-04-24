---
name: Legal QA Post-Processing Cleanup
description: Final regex-based filters on footnotes — URL/length/substance gates, dropped-count exposure, footnote dedup, post-draft statute completion
type: logic
---

Final post-processing in `supabase/functions/legal-qa/index.ts` runs after the drafter and before persistence.

## Footnote dedup (Fix 1)
The AI-footnote build loop tracks every `card.id` it has already emitted in `cardIdToNewNumber`, and every fuzzy-URL match in `fuzzyUrlToNewNumber`. When a later AI footnote resolves to an already-cited card (or fuzzy URL), we DO NOT append a new numbered footnote — instead we map `aiFn.num` to the existing new number in `oldIdToNewNumber`, so the body's `[N]` markers get rewritten to point at the first occurrence. "שם" / "לעיל ה"ש" short-form notes are NOT touched (intentional repeats).

Pinpoint divergence (e.g. "בעמ' 5" vs "בעמ' 12" on the same card) is logged as `dedup_with_pinpoint_conflict` and surfaced in `qa_logs.metadata.footnote_dedup = { merged_count, with_pinpoint_conflict, samples }` (first 3).

## Post-draft statute completion (Fix 2, gated by `enableDeepPipeline`)
Runs after `coverage-gap`, before final grounding sanity check. Scans the drafted `answer` body for Hebrew statute mentions (`חוק-יסוד: …`, `חוק …`, `פקודת …`, `תקנות …`). A mention is considered "unanchored" when:
1. No existing footnote citation contains the statute name, AND
2. No `[N]` marker or superscript appears within ~120 chars of the mention.

Up to 3 unanchored statutes are sent to a targeted Perplexity (`sonar-pro`, 15s timeout, `search_domain_filter=TRUSTED_LEGAL_DOMAINS`) call asking ONLY for `type="statute"` entries with year_hebrew + year_gregorian + ס"ח/ק"ת + page + URL. Each candidate is validated by `validatePerplexityCandidate` (URL allowlist + engine resolution). For each valid result we:
- Push a new `SourceCard` with `provenance="perplexity_completion"`.
- Append a new footnote to `finalFootnotes`.
- Insert `[newFnNumber]` right after the first naked mention in `answer`.

Telemetry: `qa_logs.metadata.statute_completion = { triggered, named_statutes, completed_count, skipped_with_existing, drops, status, duration_ms }`.

## Other final filters
- URL / length / substance gates on footnotes (drop empty, junk, duplicates).
- Caselaw guard rejects fabricated citations missing case-number shape.
- Dropped-count surfaced as `qa_logs.metadata.dropped_unanchored_count` + previews.
- Citation engine resolver canonicalises chapter footnotes (academic only) — non-blocking.
