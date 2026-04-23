

# Zoom-out: where Fast/Deep should land, and how to stop the tuning loop

## The honest read on where we are

We've spent v7.0 → v7.7 micro-tuning a single pipeline and trying to make it serve two opposite goals (fast & light vs. rich & reliable) with one set of knobs. That's why every patch fixes one metric and regresses another. **The architecture, not the prompt, is the bottleneck.**

What's actually working today:
- Decomposition + ClaimMap on Gemini Flash: stable, ~8s combined.
- Structured drafter on gpt-5-mini: ~35–50s, good Hebrew prose.
- Perplexity already runs in parallel with local search (metadata-only role, well-defined).
- Telemetry (stage_runs) is honest and queryable.

What's broken:
- One pipeline, one prompt, one source-pack policy → can't satisfy Fast and Deep simultaneously.
- "Anchored count" is computed post-hoc from URL presence → drafter gamed it by inventing footnotes when the floor was raised.
- No source-side fallback when local DB returns `core=0` → drafter improvises instead of the system retrieving more.

---

## 1. The ideal architecture (target end-state)

Two **separately-tuned pipelines** sharing the same retrieval/contracts layer, with one new piece: **a Perplexity completion pass that promotes external sources into the catalog, not just metadata**.

```text
                    ┌─────────────────────────────────┐
                    │   Decompose + Plan (Gemini)     │  shared
                    └────────────┬────────────────────┘
                                 │
            ┌────────────────────┴────────────────────┐
            │  Retrieve: local DB ∥ Perplexity        │  shared
            │  + NEW: promote external hits to        │
            │    catalog cards when authority>=X      │
            └────────────────────┬────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │   ClaimMap + gating     │  shared
                    └────────────┬────────────┘
                                 │
                ┌────────────────┴────────────────┐
                ▼                                 ▼
        ┌──────────────┐                  ┌──────────────┐
        │  FAST path   │                  │  DEEP path   │
        │  ~40-50s     │                  │  ~120-150s   │
        │  450-700 w   │                  │  1200-2000 w │
        │  4-6 cites   │                  │  8-15 cites  │
        │  no anchor-  │                  │  full anchor │
        │  pass        │                  │  pass + 2nd  │
        │  gpt-5-mini  │                  │  retrieval   │
        │              │                  │  round       │
        └──────────────┘                  └──────────────┘
```

Key shared invariants:
- **Anchoring is enforced at parse time, not in the prompt.** Drafter MUST emit `[src-N]` markers. Parser drops any footnote without a matching catalog card. Floors describe required *anchored* citations, not "any 4 footnotes".
- **Source pack guarantees a floor**, not the prompt. If `core=0` after retrieval, the system runs a second-round Perplexity completion to fill the floor before the drafter ever sees the input. This is the new piece you asked about.
- **Mode = product config**, not a code branch. One JSON config (word range, footnote floor, token cap, anchor-pass on/off, second-round retrieval on/off, drafter model).

---

## 2. Shortest path from here to there (3 milestones)

### Milestone A — Stop the regression loop (1 work session)
Single change, no model swaps:
1. **Parser-side anchor enforcement** in `index.ts` post-processing: drop footnotes whose `[src-N]` doesn't resolve to a catalog card; expose `dropped_unanchored_count` in metadata. This kills the v7.7 fabrication problem permanently and makes every future metric honest.
2. **Remove the hard 4-footnote floor from the prompt.** Replace with "use as many `[src-N]` citations as the source pack supports, minimum 2." The system, not the model, owns the floor.
3. Lock v7.6-style Fast prompt (450–700 words, 2048 tokens, no anchor-pass) as the Fast baseline.

After A: Fast is honest. We stop chasing a metric the model is gaming.

### Milestone B — Perplexity completion pass (1–2 sessions)
The piece you raised. Currently Perplexity runs only for **metadata enrichment** of items already in the body. Add a new role: **source completion**.

- After local retrieval, if `sourcePack.core.length < 2` OR `claimMap.uncoveredSubIssues.length > 0`, fire a targeted Perplexity query per uncovered sub-issue asking for primary sources (statutes, case numbers, ס"ח refs).
- Promote returned items to first-class `SourcePackEntry` with `provenance: "perplexity"`, `authority_class` derived from URL pattern, `usable_for_citation: true` only if it carries case number / ס"ח+page.
- Cap at +3 promoted sources per request, 8s budget (parallel with claim_map).
- Anchored-count now naturally rises because the catalog has the cards the drafter needs.

After B: Fast hits 4–6 anchored citations without prompt coercion.

### Milestone C — Deep mode as a config, not a rewrite (1 session)
- Add `depth: "deep"` config block: word range 1200–2000, token cap 4096, footnote floor 8, anchor-pass ON, **second retrieval round** (re-query local + Perplexity using claim-map gaps), drafter `openai/gpt-5` (not mini), `claim_map` on OpenAI gpt-5-mini with seed:7.
- Frontend toggle + 2x credit cost.
- Same code path, different config object.

After C: Deep is a real product, not a separate engineering project.

---

## 3. What to stop tweaking (it's no longer worth time)

- **Prompt floors and word counts.** Diminishing returns. We've seen the model game every floor we set. Move enforcement out of the prompt.
- **OpenAI vs Gemini for claim_map in Fast.** Settled: Gemini Flash. Stop testing this.
- **9-shot stability runs after every prompt edit.** Run them only after architectural changes (Milestones A/B/C), not after wording changes. They cost ~10 minutes each and we're using them as a comfort blanket.
- **Anchor-pass tuning for Fast.** It belongs in Deep. Don't try to make it cheap enough for Fast.
- **Seed-based determinism in Fast.** Gemini ignores it; chasing it is what cost us v7.4.

---

## 4. Honest timeline

Assuming one focused implementation session per milestone, no scope creep, and stability tests only at milestone boundaries:

| Milestone | Work | Outcome | Calendar |
|---|---|---|---|
| **A — Parser anchoring + remove prompt floor** | ~1 session | Fast is *honest* (metrics reflect reality). Not yet rich. | **Today / next session** |
| **B — Perplexity completion pass** | 1–2 sessions | Fast is *usable*: 40–55s wall, 4–6 real anchored cites, 450–700 words. | **2–3 sessions out** |
| **C — Deep mode config** | 1 session | Deep is *usable*: 120–150s, 8–15 anchored cites, 1200–2000 words. | **3–4 sessions out** |

So: **usable Fast in ~2 sessions, usable Deep in ~3–4 sessions** from now. Anything longer means we slipped back into prompt tuning.

---

## Tradeoffs you should know

- **Parser-side anchoring (Milestone A) will *temporarily lower* the visible footnote count** before Milestone B fills it back in. This is the right direction — we trade a fake number for a real one — but expect one round where Fast looks "thinner" on paper.
- **Perplexity completion adds ~5–8s and external API cost** to runs where local DB underperforms. Worth it; it's the only way to hit anchored coverage on niche questions without growing the corpus.
- **Deep mode at gpt-5 + 2 retrieval rounds will cost real money per query.** 2x credits is the floor; we may want 3x.

---

## Recommendation

Approve **Milestone A only** for the next implementation turn. Do not bundle B and C yet. After A lands and we've confirmed metrics are honest, decide on B based on the *real* anchored-coverage number — not the gamed v7.7 number.

If you approve, the next turn implements: parser-side `[src-N]` enforcement, removal of the 4-footnote prompt floor, and a single confirmation 9-shot. Nothing else.

