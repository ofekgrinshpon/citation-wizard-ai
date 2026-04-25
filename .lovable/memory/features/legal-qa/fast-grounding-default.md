---
name: Fast grounding default (locked 2026-04)
description: Locked Fast-mode grounding architecture — anchor pass primary, Stage 5e fallback with sentence-end placement — plus QA guard flags surfaced in qa_logs.metadata.statute_completion.qa_guard
type: feature
---

# Fast grounding — locked default

After multiple eval batches (April 2026), Fast mode's claim-to-source grounding is locked to:

1. **Anchor pass = primary**. `anchorPassEnabled: true`, `anchorPassMaxPatches: 2` in `modeProfiles.ts`. Runs on every Fast research request.
2. **Stage 5e (statute name completion) = fallback**. Gated in `legal-qa/index.ts` by:
   - source-pack coverage check (any `sourceCard.citation` containing the named statute), and
   - anchor-marker proximity (existing `[N]` within ±240 chars of the mention).
3. **Sentence-end placement**. Markers are inserted at the first sentence terminator (`.`, `?`, `!`, `;`, `\n`) after the matched name, respecting paren/bracket depth. Never name-adjacent.

Do NOT change these without a fresh batch eval.

## QA guard

`statuteCompletionTelemetry.qa_guard` is computed at the end of Stage 5e and stored under `qa_logs.metadata.statute_completion.qa_guard`:

- `name_adjacent_share` — fraction of inserts that were placed adjacent to the name (should be 0).
- `trigger_share_of_named` — `kept_for_completion / max(named_statutes, 1)`.
- `skipped_share` — `skipped_covered_by_primary / max(named_statutes, 1)`.
- `flags.name_adjacent_present` — true if ANY `name_adjacent` placement happened.
- `flags.excessive_trigger` — true if `kept_for_completion >= 5` in Fast.
- `flags.primary_path_silent` — true if ≥3 statutes were named but `skipped_covered_by_primary` is 0 (primary path didn't gate anything → silent regression).
- `any_flag` — OR of the three.

When `any_flag` is true, the edge function logs a `[statute-completion][qa_guard] flags raised: ...` warning.

### Diagnostic query

```sql
SELECT created_at,
       metadata->'statute_completion'->'qa_guard' AS guard,
       metadata->'statute_completion'->>'kept_for_completion' AS kept,
       metadata->'statute_completion'->>'skipped_covered_by_primary' AS skipped
FROM qa_logs
WHERE task_mode = 'research'
  AND (metadata->'statute_completion'->'qa_guard'->>'any_flag') = 'true'
ORDER BY created_at DESC
LIMIT 50;
```

## Files

- `supabase/functions/legal-qa/modeProfiles.ts` — Fast profile annotated as the locked default.
- `supabase/functions/legal-qa/index.ts` — Stage 5e gate + sentence-end placement + qa_guard computation.
- `eval/stage5e-batch.mjs` — harness that surfaces `skipped_covered_by_primary`, `insertion_placement`, `anchor_pass` in the report.
