

## Next move: instrument the structured drafter for citation coverage, then add a single "anchor pass"

### Direct answers to your two questions

**1. The single change most likely to improve citation richness without re-inflating latency:**

Add a **post-draft "anchor pass"** that re-runs only over the drafted memo (not the full pipeline) with one job: scan each substantive claim in the body and attach a footnote from the *already-retrieved source pack* if one exists and the drafter missed it. No new retrieval. No new reasoning. Just claim-to-source matching against material we already paid for.

Why this and not anything else:
- The smoke test produced ~2 footnotes per memo despite v4 logs showing **6+ ranked source cards available per question**. So the bottleneck is not retrieval quality and not source availability — it's **the structured drafter under-using the sources it was handed**. The compact prompt (~6–8k chars, down from ~28k) almost certainly stripped too much of the "you must anchor every claim" reinforcement along with the redundant rules.
- Fixing this at the drafter prompt level (option A) is risky: every prompt-tuning round in this thread has traded one property for another (latency vs. coverage vs. format compliance). We've seen that loop play out three times now.
- Re-running retrieval (option B) is expensive and unnecessary — the source pack is already in memory.
- A targeted second pass on `gemini-2.5-flash` over a ~1500-word memo + ~6 source cards is a structured tool-call task — empirically 3–8s on Flash. Adds latency we can afford, and is the same model+stage shape as `claim_map`, which we already proved is fast and reliable.

**2. Realistic targets for a user-facing version:**

| Metric | Current (pilot v6) | Target for "ship as default" | Target for "ship as opt-in deep mode" |
|---|---|---|---|
| Mean wall time | ~92s | **≤ 60s** | ≤ 100s |
| P90 wall time | ~105s | ≤ 75s | ≤ 130s |
| Footnotes per memo | ~2 | **≥ 5** (on questions with ≥5 available cards) | ≥ 4 |
| Anchored claim coverage | not measured | **≥ 70%** of substantive claims | ≥ 60% |
| Structured path success | 100% (3/3) | ≥ 95% | ≥ 90% |

**Honest read:** ≤60s as default is aggressive given the current ~32s decomp + ~7s claim_map + ~50s draft floor. It probably requires *also* moving decomposition off `gpt-5-mini` onto Flash (decomp is the next-largest stage and is also a structured-output task). That is the *follow-up* move, not this one. **This loop's job is to fix coverage first**, because shipping a fast-but-thinly-cited Legal Research tool is worse than shipping a slightly slower well-cited one — under-citation is the single user-visible failure mode that erodes trust in legal AI.

---

### Concrete plan for the next loop

**Step 1 — Instrument before changing anything (no code shipped, ~5 min).**
Re-run the same 3-question smoke test (Q1, Q6, Q21) but add logging that captures, per question:
- Number of source cards passed into the structured drafter
- Number of those source cards actually cited in the final memo
- List of substantive claim sentences in the body that have no footnote (heuristic: sentences containing legal terms — חוק / סעיף / פס"ד / קבע / נפסק / הלכה — without an adjacent superscript)

This gives a real "coverage gap" number instead of the proxy of "footnote count." If coverage is already 70%+ and the issue is just that some questions genuinely have few claims, the anchor pass is unnecessary and we should instead just raise the visible footnote count by tweaking the drafter prompt back up slightly. We need this number before committing to the bigger change.

**Step 2 — Build the anchor pass (only if Step 1 confirms the gap).**

Add a new stage in `legal-qa/index.ts` between `structuredDrafting` and `post-processing`:

```text
[draft] → [anchorPass] → [post-processing footnote filters]
```

`anchorPass` contract:
- Input: drafted memo body + the same `sourcePack` already passed to the drafter + the `claimMap` already produced
- Model: `google/gemini-2.5-flash` (same as `claim_map`, same `forceProvider: "gemini"`)
- System prompt: ~1k chars. One job — "for each claim in `claimMap.claims` that has `anchor: true` but does not appear as a footnote in the body, return a JSON patch with the exact sentence to anchor and the source card id to attach."
- Output schema: `{ patches: [{ sentenceFragment: string, sourceCardId: string }] }`
- Apply patches in code (not by re-prompting the drafter): find the sentence in the body, append a superscript, push the citation into the footnote list.
- Hard cap: max 4 patches per memo (prevent over-citation). Anchor pass adds nothing if the drafter already cited well.

**Step 3 — Re-run the 3-question smoke test with the anchor pass enabled.**

Compare:
- Footnotes per memo (expect 2 → 4–6)
- Coverage % (expect ~30–40% → ~65–75%)
- Wall time delta (expect +5–10s, landing at ~100–115s)
- Any new false-positive citations (anchor pass attached a source to a claim it shouldn't have)

**Step 4 — Decision gate:**
- If coverage hits target and false-positive rate is low → run the 10-question pilot to confirm at scale, *then* the 30-question run becomes product-relevant.
- If coverage improves but false positives appear → tighten the anchor pass prompt to require strict claim-to-source semantic match (one more iteration, not a rewrite).
- If wall time blows past 120s → drop anchor pass to top-3 patches only.

### What this loop does NOT do
- No changes to retrieval, ranking, or source pack assembly.
- No changes to decomposition (Flash migration is the follow-up move, gated on this one succeeding).
- No changes to legacy path.
- No 10-question or 30-question rerun until the 3-question coverage instrumentation + anchor pass land.

### What I'll deliver after this loop
- Coverage gap baseline (Step 1 numbers) — so we have a real metric, not just footnote count
- Anchor pass effect (Step 3 numbers) — coverage delta, latency delta, false positive count
- A single go/no-go: "anchor pass is the right ship; now run the 10-question pilot" or "coverage is fine, the issue is something else and here's what."

