---
name: Deep Grounding Default (post-2026-04 tuning)
description: Deep mode mirrors Fast's grounding architecture (anchor pass primary, Stage 5e fallback) with a richer envelope; soft-target footnote prompt, perplexityCompletionMinAnchored=4, mode-aware QA guard
type: feature
---

# Deep Grounding Default

After the Fast grounding architecture was locked (see `fast-grounding-default.md`),
Deep was retuned to share the same primary path with a richer envelope. Validated
2026-04 with `eval/deep-mode-q1-q6-q21.mjs` (before/after on Q1, Q6, Q21).

## Shared with Fast (do not change without an eval)
- **Anchor pass = PRIMARY** claim-to-source grounding path.
- **Stage 5e (statute completion) = FALLBACK** only, gated by source-pack coverage
  and anchor-marker proximity (±240 chars).
- All Stage 5e markers placed at **sentence end**, never name-adjacent.
- QA guard in `qa_logs.metadata.statute_completion.qa_guard` flags regressions.

## Deep-specific knobs (`modeProfiles.ts`)
- `wordRangeMin/Max`: 1200 / 2000
- `footnoteFloor / footnoteTargetMax`: 8 / 14 (soft target — see prompt)
- `retrievalRounds`: 2 (round-2 scoped to claim-map gaps)
- `perplexityCompletionMinAnchored`: **4** (lowered from 6 in 2026-04)
- `anchorPassMaxPatches`: 4 (vs Fast's 2)
- `qaGuardExcessiveTriggerThreshold`: **8** (vs Fast's 5) — Deep can legitimately
  complete more statutes from its larger source pack.
- `drafterVariant`: `"legacy"` (gpt-5)
- `drafterTimeoutMs`: 180000

## Footnote prompt = soft target, not hard reject
Both Fast and Deep use **strong-target** wording in `footnoteFloorBlock`
(`legal-qa/index.ts`). Deep wording adds explicit "**טיב לפני כמות**:
עדיף פחות הערות אמיתיות מאשר יותר הערות מומצאות" so the drafter does not invent
footnotes from memory to hit a quota. Pre-2026-04 Deep used hard-floor wording
("רצפה קשיחה, לא יעד") that the model silently ignored when sources were thin.

## QA guard mode-awareness
The `excessive_trigger` flag fires when
`kept_for_completion >= modeProfile.qaGuardExcessiveTriggerThreshold`. Deep's
threshold (8) prevents false positives on legitimate "list-of-statutes" questions
like Q21 where Stage 5e legitimately completes many references.

## Eval baseline (2026-04, deep-after-0258d22e)
- Q1: 1468w, 5 anchored, no QA flags.
- Q6: 1119w, 3 anchored, no QA flags. (Below 1200 — accept; the soft target
  language correctly let the drafter stop when sources were thin.)
- Q21: 1291w, 11 anchored, `excessive_trigger=true` (kept=20). This is the
  guard correctly identifying a list-heavy question, not a regression.

Comparison report: `/mnt/documents/legal-qa-eval/deep-before-after-comparison.md`.
