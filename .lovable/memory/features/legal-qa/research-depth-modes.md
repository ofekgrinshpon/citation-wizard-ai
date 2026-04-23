---
name: Research Depth Modes (Fast / Deep)
description: Two-mode toggle (⚡ Fast / 🧠 Deep) controls Legal Research pipeline behavior via single MODE_PROFILES config object; not a code branch
type: feature
---

# Research Depth Modes

The Legal Research workspace exposes a simple two-button toggle:
- **⚡ מהיר (Fast)** — default
- **🧠 מעמיק (Deep)**

Toggle is shown only in `taskMode === "research"`, persisted to `localStorage` (`relex.research.depth`), and sent in the request body as `depth: "fast" | "deep"`.

## No pricing, no time estimates shown

Per product decision: the toggle is a **quality control**, not a billing decision. We do NOT show credit costs, multipliers, or time estimates in the UI. Both modes currently charge the same `creditCost: 5` until production cost is measured.

## Backend: configuration-only

Single source of truth: `supabase/functions/legal-qa/modeProfiles.ts`. Every per-mode difference is a field on `ModeProfile`:
- `wordRangeMin/Max`, `footnoteFloor`, `footnoteTargetMax` — drafting envelope
- `retrievalRounds` — 1 (Fast) vs 2 (Deep, currently config-only; round-2 retrieval block is a planned follow-up)
- `perplexityCompletionMinAnchored` — Stage E.5 trigger threshold (Fast: <2 core, Deep: <6)
- `anchorPassEnabled` — Fast skips, Deep runs
- `drafterVariant` — Fast `"structured"` (gpt-5-mini), Deep `"legacy"` (gpt-5)
- `drafterTimeoutMs` — Fast 120s, Deep 180s
- `creditCost` — equal for now

`index.ts` calls `resolveModeProfile(body.depth)` once and reads `modeProfile.X` everywhere. No `if (deep)` branches.

## Telemetry

Each `qa_logs.metadata.profile_used = { depth, ...modeProfile }` so eval runs can compare Fast vs Deep behavior on identical questions.

## Rollout status

- ✅ `MODE_PROFILES` config + Fast wiring (Stage E.5 threshold, anchor pass gate, drafter timeout/variant)
- ✅ Frontend toggle (research mode only, default Fast, persisted)
- ⏸ Round-2 retrieval block — deferred to a focused follow-up so it can be eval'd in isolation against Fast baseline
