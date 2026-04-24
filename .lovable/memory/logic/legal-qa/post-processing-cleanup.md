---
name: Legal QA Post-Processing Cleanup
description: Final regex-based filters on footnotes — URL/length/substance gates, dropped-count exposure, footnote dedup, statute completion now runs at Step 5e (pre-superscript)
type: logic
---

Final post-processing in `supabase/functions/legal-qa/index.ts` runs after the drafter and before persistence.

## Pipeline ordering (v7.13)

```
build footnotes  →  Step 5d: Rule 37 short-form generator (pass 1)
                 →  Step 5e: statute completion (perplexity, gated by enableDeepPipeline)
                 →  Step 5f: Rule 37 second pass (legislation only, scoped to newly inserted markers)
                 →  Step 6:  [N] → superscript conversion
                 →  Step 6b: appearance-order reorder
                 →  coverage_gap, footnote_validate, grounding sanity check
```

Statute completion was moved up from after Step 6b (where it inserted literal `[N]` strings into the post-superscript answer and bypassed reordering) to Step 5e (where its inserts become real bracket markers that step 6 superscripts and step 6b renumbers by appearance position).

## Footnote dedup
The AI-footnote build loop tracks every `card.id` it has already emitted in `cardIdToNewNumber`, and every fuzzy-URL match in `fuzzyUrlToNewNumber`. When a later AI footnote resolves to an already-cited card (or fuzzy URL), we DO NOT append a new numbered footnote — instead we map `aiFn.num` to the existing new number in `oldIdToNewNumber`. "שם" / "לעיל ה"ש" short-form notes are NOT touched (intentional repeats). Pinpoint divergence is logged as `dedup_with_pinpoint_conflict` and surfaced in `qa_logs.metadata.footnote_dedup`.

## Step 5e — Statute completion (gated by `enableDeepPipeline`)
Scans `answerBody` (still-bracket-marker form) for Hebrew statute mentions via `STATUTE_RE` (`חוק-יסוד: …`, `חוק …`, `פקודת …`, `תקנות …`). A `STATUTE_STOPWORDS` denylist (`יעילה`, `מתאים`, `הולם`, `מספק`, `כללי`, …) and a min-2-Hebrew-token requirement filter false positives like `"חוק יעילה"` from `"חקיקה יעילה"`. A mention is "unanchored" when no existing footnote citation contains the statute name AND no `[N]` marker appears within ~120 chars. Up to 3 unanchored statutes go to Perplexity (`sonar-pro`, 15s timeout, `search_domain_filter=TRUSTED_LEGAL_DOMAINS`). Each candidate is validated by `validatePerplexityCandidate` (URL allowlist + engine resolution). Successful inserts update `sourceCards`, `footnotes`, `oldIdToNewNumber`, `cardIdToNewNumber`, `fnNumberToCard`, and `shortNameRegistry` so the rest of the pipeline (steps 5f, 6, 6b) sees them as native footnotes.

Telemetry: `qa_logs.metadata.statute_completion = { triggered, named_statutes, completed_count, skipped_with_existing, drops, status, duration_ms }`.

## Step 5f — Rule 37 second pass
After statute completion adds new markers, the same statute may be mentioned again later in the body (still naked because pass 1 didn't yet have a footnote for it). Pass 2 walks every newly-inserted legislation footnote, finds re-mentions of its `shortName` in `answerBody` after the first marker, and applies Rule 37.5: if a pinpoint follows (`בעמ' X` / `בס' Y` / `בפס' Z`) → rewrite to `ס' X ל<lawName>`; if no pinpoint and the mention is preceded by a function word (`לפי`, `מכוח`, `על פי`, `של`, `ב`, `ל`) → keep just the law name (no marker, no שם, no לעיל). Pure naked re-mentions are left untouched. Telemetry merges into `rule37_short_forms.pass2_statutes` + cumulative counts.

## Other final filters
- URL / length / substance gates on footnotes (drop empty, junk, duplicates).
- Caselaw guard rejects fabricated citations missing case-number shape.
- Dropped-count surfaced as `qa_logs.metadata.dropped_unanchored_count` + previews.
- Citation engine resolver canonicalises chapter footnotes (academic only) — non-blocking.
