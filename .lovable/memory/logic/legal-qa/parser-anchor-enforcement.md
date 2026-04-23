---
name: Parser-side anchor enforcement (Milestone A)
description: Step 5b in legal-qa drops AI footnotes with no catalog/fuzzy URL match instead of keeping them as source="unverified"; metadata exposes dropped_unanchored_count + previews
type: feature
---

In `supabase/functions/legal-qa/index.ts` Step 5b, AI footnotes that match no source card AND no fuzzy URL are now **dropped** at parse time (previously kept with `source: "unverified"`). The system, not the prompt, owns the citation floor.

**Tracked in `qa_logs.metadata`:**
- `dropped_unanchored_count` — how many AI footnotes were fabricated without a catalog backing
- `dropped_unanchored_previews` — first 5 previews (≤120 chars) for diagnosis

**Prompt change (Fast structured drafter, ~line 2496+):** Removed the hard "450w / 4 anchored footnote" floor. Replaced with target language: 400-700 words, 4-6 anchored, **minimum 2**. Explicit instruction: "אסור לייצר הערה ביבליוגרפית 'מהזיכרון' כדי להגיע ליעד."

**v7.8 9-shot result (Q1/Q6/Q21 × 3):** Avg dropped=3.6/run. Q6 dropped 6-8/run with fn=0 anchored=0 — proving the v7.7 "fn=4" was almost entirely fabrication. Q1 (broad constitutional, has core sources) survives with 1-3 anchored. This is now the honest baseline. Milestone B (Perplexity source completion) is required to lift anchored coverage on Q6/Q21-style questions.
