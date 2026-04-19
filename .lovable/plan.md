

## Why you got only 2 footnotes

From the edge function logs for your query:
- The AI generated **10 footnotes**.
- The strict footnote-to-source matcher (added in the previous fix) **dropped 8 of them** as "unmatched" and kept only 2.
- Logged messages: `Stripped unmatched footnote #1`, `#3`, `#4`, `#5`, `#6`, `#7`, `#9`, `#10`.

The previous fix was working as designed, but **too aggressively** for this query because:

1. **Most sources came from Perplexity** (8 of 10 cards), not the local DB. Perplexity returns short web snippets whose wording rarely overlaps with a properly-formatted Israeli legal citation (e.g. `בג"ץ 653/88 צוק נ' שר הביטחון, פ"ד מג(2) 714 (1989)`).
2. **Tier 1 (case number) failed** because the snippet text rarely includes the formal case number `653/88`.
3. **Tier 2 (≥3 significant words)** failed because Perplexity snippets are short and topical, not citation-shaped.
4. **Re-ranking silently degraded**: `Re-ranking: could not parse scores, using all sources` — the threshold protection didn't engage, so weak Perplexity cards reached the AI anyway.

Net effect: the matcher correctly refused to attach wrong URLs, but it also threw away footnotes whose citation text was actually fine — just not provable against the available cards.

## Fix — relax the matcher safely (single file: `supabase/functions/legal-qa/index.ts`)

The goal: keep wrong-URL prevention, but stop dropping legitimate citations.

### 1. Add Tier 3: keep footnote without a URL when no card matches
Currently, no match → drop entirely. Change to: no match → **keep the footnote text, omit the URL** (so the user still sees the citation but no broken link). The bug we were preventing is wrong URLs — a footnote with no link at all is fine.

### 2. Match by case number against the card's `case_number` field, not just citation text
For local DB cards, also check `card.case_number` (already in `legal_documents`). This catches cases where the AI cites `12345/22` and the card has it as a structured field but not in the snippet body.

### 3. Lower Tier 2 to `≥2 significant words` for Perplexity cards specifically
Perplexity snippets are shorter than full citations, so 3-word overlap is unrealistic. Use 2-word for `provenance === "perplexity"`, keep 3-word for local DB cards.

### 4. Body marker handling for kept-without-URL footnotes
When a footnote is kept without a URL, its `[N]` marker stays in the body (currently it's stripped because the footnote was dropped). Renumber as usual.

### 5. Log re-rank failure more loudly + lower threshold fallback
When score parsing fails, fall back to `score >= 5` filter on raw similarity instead of "use all" — this stops weak Perplexity cards from reaching the AI in the first place.

## Out of scope
- No client changes.
- No prompt changes.
- No DB changes.

## File changes
- `supabase/functions/legal-qa/index.ts` — items 1–5 above.

