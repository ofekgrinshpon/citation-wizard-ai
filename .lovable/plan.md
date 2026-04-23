

## Fast-mode feasibility loop — validation, not final bar

Treat this loop as a checkpoint: does Fast-first architecture clear the engineering floor (~70s / 5 anchored)? The product bar (~30–45s / 4–6 solid) stays open and informs what comes next.

### Changes this loop

**1. Decomposition → Gemini 2.5 Flash** (`supabase/functions/legal-qa/legalResearchModels.ts`)
- Flip `decomposition.primary` from `openai/gpt-5-mini` → `google/gemini-2.5-flash`
- Add `forceProvider: "gemini"` (mirrors the v6 `claimMap` migration)
- Keep `gpt-5-mini` as `fallback` so revert is a one-line flip
- Expected: ~25s → ~6–10s

**2. Anchor pass** (`supabase/functions/legal-qa/index.ts`)
- New stage between `structuredDrafting` and post-processing
- Model: `google/gemini-2.5-flash` with `forceProvider: "gemini"`
- Input: drafted body + existing `sourcePack` + `claimMap` (no new retrieval)
- System prompt ~1k chars, single job: for each `claimMap.claims[]` entry whose anchor sentence has no footnote in body, return `{ sentenceFragment, sourceCardId }`
- Output schema: `{ patches: [{ sentenceFragment: string, sourceCardId: string }] }`, max 4 patches
- Apply patches in TS: locate sentence → append next superscript → push citation → renumber via existing footnote-ordering logic
- 15s timeout. On timeout/empty patches, ship draft as-is.

**3. Fallback drafter footnote anchoring rule** (`supabase/functions/legal-qa/index.ts`)
- One-line addition to legacy/fallback drafter system prompt: every footnote requires either a URL from the source pack OR the marker `(לא נמצאו פרטי פרסום)`
- Closes Q21 regression where fallback produced 4 unanchored statute citations

**4. Coverage-gap instrumentation**
- Already shipped from prior loop. No changes.

### Expected stage budget

```text
decomposition  ~8s   (was ~25s)
retrieval      ~5s   (unchanged)
claim_map      ~5s   (unchanged, Flash)
draft          ~50s  (unchanged, gpt-5-mini compact prompt)
anchor pass    ~7s   (new)
post-process   ~2s
─────────────────────
total mean    ~70s   structured path
```

### Smoke test (Q1, Q6, Q21)

Per question:
- Stage latencies: decomp / retrieval / claim_map / draft / anchor pass / total
- Footnote count + anchored count
- Anchor-pass patch count
- Decomp parse_error rate on Flash
- Whether Q1 still falls back

### Decision gate (re-framed as validation, not success)

| Outcome | Read | Next action |
|---|---|---|
| ≤ 70s mean, ≥ 5 anchored, decomp Flash stable | **Floor cleared, but not yet product bar.** | Run 10-question pilot to confirm baseline holds. Then design the gap-closer loop toward ~45s / 6 anchored. |
| ≤ 70s but coverage stalls at 4 | Floor partially cleared. | One re-test with relaxed anchor-pass threshold. Then pilot. |
| Decomp Flash regresses (parse_error >10%) | Architectural lever spent. | Flip back to `gpt-5-mini`, ship anchor pass alone, accept ~95s. Pilot deferred. |
| Anchor pass produces false positives | Quality regression. | Tighten anchor-pass prompt to strict claim-to-source match. One re-test. |
| Mean stays >85s | Floor not cleared. | Stop tuning. Drafter is the wall — design explicit drafter-on-Flash quality experiment. |

### What this loop does NOT do

- No Deep mode work (no contract, no scaffold, no UI)
- No drafter model change
- No retrieval/ranking/source-pack changes
- No compact structured prompt changes (v8 hardening stays)
- No 10/30-question pilot until smoke test clears the gate

### Deliverables after this loop

- Per-stage latency for all 3 questions
- Footnote count + anchored coverage per question
- Anchor-pass effectiveness (patches applied, false positives)
- Honest read against both the engineering floor (~70s / 5) and the product bar (~45s / 6)
- Single go/no-go for the 10-question pilot, plus the next gap-closer move if the product bar still isn't met

