
## Problem

For Deep research questions, the progress bar sits at ~1% for the entire run, even though the backend is actively writing checkpoints (`decomposition`, `retrieval`, `claim_map`, `drafting`, `anchor_pass`, …) to `qa_logs.metadata.checkpoint`.

## Root cause

Deep mode does not use SSE — it goes through the async dispatcher (HTTP 202 + `run_id`) and the client polls `legal-qa-status`. `StageProgressList` computes progress from the `stages` array (SSE `stage` events), so for Deep that array stays empty. The polling `onUpdate` callback in `LegalQAChat.tsx` only sets `postProcessingLabel`, but `StageProgressList` deliberately refuses to promote `post_processing` to "running" until all earlier manifest stages are complete. Result: no events ever land, the component renders the synthetic "starter" row clamped to 1–2%.

Fast mode (SSE) and academic chapter writes (SSE) are unaffected.

## Fix (frontend-only)

Translate each polled `checkpoint` into synthetic, cumulative `StageEvent`s in the deep manifest's vocabulary. Reuse the existing weighted progress logic — no changes to `StageProgressList`, no backend changes.

### 1. New helper `src/lib/legalQa/deepCheckpointToStages.ts`

Maps backend checkpoint → deep manifest stage id, and returns the cumulative event list (prior stages `complete`, current stage `running`):

```text
queued / running            → [] (keep starter)
legal_issue_router          → plan running
decomposition               → plan running
open_web_discovery          → plan complete, retrieval running
retrieval                   → plan complete, retrieval running
claim_verification          → plan+retrieval complete, verify running
claim_map                   → plan+retrieval+verify complete, ledger running
drafting                    → …+ledger complete, draft running
anchor_pass                 → …+draft complete, enrich_citations running
completed                   → all complete
failed                      → no-op (error surfaced elsewhere)
```

Function signature:
```ts
export function deepCheckpointToStages(checkpoint?: string | null): StageEvent[]
```

### 2. Use the helper in `LegalQAChat.tsx`

Three `pollLegalQaStatus` call sites all use the same pattern — update each `onUpdate`:

- ~L968 (resume academic Deep mount)
- ~L1059 (resume Deep research mount)
- ~L2166 (live Deep submission)

In each callback, in addition to (or instead of) `setPostProcessingLabel`, call `setStageEvents(deepCheckpointToStages(snap.checkpoint))`. Keep `setPostProcessingLabel` only when `snap.checkpoint === "anchor_pass"` or later, so the "post-processing" row activates correctly at the end.

Reset `stageEvents` (already done at submit) — no extra reset needed.

### 3. No backend, no SSE, no manifest changes

The `DEEP_MANIFEST` weights already produce a smooth 0 → ~92% march; the existing idle-creep in `StageProgressList` will animate between checkpoint updates.

## Out of scope

- Q5 timeout investigation (kept separate per prior instruction).
- SSE for Deep (intentionally async to survive the 150s gateway cap).
- Backend checkpoint granularity (sufficient as-is).

## Verification

1. Submit a Deep research question.
2. Watch the bar advance through "תכנון מחקר" → "אחזור מקורות" → "אימות וסינון" → "מיפוי טענות" → "כתיבת התשובה" → "השלמת ציטוטים" → "בדיקת איכות סופית" as checkpoints flip.
3. Confirm Fast mode and academic chapter SSE progress is unchanged.
