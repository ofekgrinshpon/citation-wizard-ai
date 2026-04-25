---
name: Deep Grounding Default (post-2026-04 partial revert)
description: Deep mirrors Fast's grounding architecture (anchor pass primary, Stage 5e fallback) with a richer envelope; mode-aware QA guard kept, but Deep keeps hard footnote floor and perplexityCompletionMinAnchored=6 after eval rejected the soft-target tuning
type: feature
---

# Deep Grounding Default

After the Fast grounding architecture was locked (see `fast-grounding-default.md`),
the same architectural model was extended to Deep with a richer envelope. A
2026-04 tuning batch then attempted three changes; only one was validated and
locked in. The other two were reverted.

## Shared with Fast (do not change without an eval)
- **Anchor pass = PRIMARY** claim-to-source grounding path.
- **Stage 5e (statute completion) = FALLBACK** only, gated by source-pack
  coverage and anchor-marker proximity (±240 chars).
- All Stage 5e markers placed at **sentence end**, never name-adjacent.
- QA guard in `qa_logs.metadata.statute_completion.qa_guard` flags regressions.

## Deep-specific knobs (`modeProfiles.ts`)
- `wordRangeMin/Max`: 1200 / 2000
- `footnoteFloor / footnoteTargetMax`: 8 / 14 (**hard floor**, not soft target —
  see prompt note below)
- `retrievalRounds`: 2 (round-2 scoped to claim-map gaps)
- `perplexityCompletionMinAnchored`: **6** (the 2026-04 attempt to lower it to
  4 was reverted — see "What was rejected" below)
- `anchorPassMaxPatches`: 4 (vs Fast's 2)
- `qaGuardExcessiveTriggerThreshold`: **8** (vs Fast's 5) — Deep can
  legitimately complete more statutes from its larger source pack.
- `drafterVariant`: `"legacy"` (gpt-5)
- `drafterTimeoutMs`: 180000

## Footnote prompt = hard floor on Deep, soft target on Fast
Fast uses **soft-target** wording in `footnoteFloorBlock` (`legal-qa/index.ts`).
Deep uses **hard-floor** wording (`רצפה קשיחה ... מינימום ... לא יעד — רצפה`).
The 2026-04 attempt to mirror Fast's soft-target wording on Deep
(`טיב לפני כמות`) was reverted because the eval showed it caused Q6 to
undershoot both the word range (1980 → 1119) and the footnote floor
(anchored 5 → 3). Deep's product promise is a richer envelope, so the floor
must be enforced; the larger source pack + anchor pass cap (4 patches) are
what we rely on to meet it.

## QA guard mode-awareness (KEPT from 2026-04 batch)
The `excessive_trigger` flag fires when
`kept_for_completion >= modeProfile.qaGuardExcessiveTriggerThreshold`. Deep's
threshold (8) prevents false positives on legitimate "list-of-statutes"
questions like Q21 where Stage 5e legitimately completes many references.
This is pure observability with no behavior change — locked in.

## What was rejected in the 2026-04 Deep batch
The before/after eval (`eval/deep-mode-q1-q6-q21.mjs`, baseline file
`/mnt/documents/legal-qa-eval/deep-before-after-comparison.md`) tested three
Deep-specific tuning changes. Outcomes:

| Change | Verdict | Reason |
|---|---|---|
| Mode-aware QA guard (Fast 5 / Deep 8) | **KEPT** | Pure observability win; correctly tagged Q21 as list-heavy, not a regression |
| `perplexityCompletionMinAnchored` 6 → 4 | **REVERTED** | Did not visibly shrink Stage 5e work; Q21 still tripped `excessive_trigger` (kept=20); contributed to Q6 anchored regression |
| Soft-target footnote prompt on Deep | **REVERTED** | Q6 dropped 1980 → 1119 words, anchored 5 → 3; the soft-target language is appropriate for Fast's small envelope but defeats Deep's product promise |

Lesson for future Deep tuning: the architectural pattern from Fast (anchor-pass
primary + Stage 5e fallback) transferred cleanly, but Fast's *prompt language*
is calibrated to Fast's envelope and should not be assumed to transfer.
