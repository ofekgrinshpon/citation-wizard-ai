

## Issue
A footnote about firing the Attorney General linked to an unrelated Knesset debate (about digital broadcasting fees). The matcher accepted a Perplexity card whose URL pointed to a completely different topic.

## Root cause
From the logs of the user's query: 8 of 9 cards were Perplexity. The current Tier 2 matcher accepts a Perplexity card on **2 significant-word overlap** (relaxed in the previous fix). For Knesset/government sites, generic words like "כנסת", "דיון", "הצעת", "חוק" appear in almost every page title — so a footnote about "פיטורי היועצת המשפטית לממשלה" can match a "דיון בכנסת על הצעת חוק..." card on words like {"כנסת", "דיון"} or {"הצעת", "חוק"}.

The previous relaxation (3→2 words for Perplexity) traded URL accuracy for citation completeness. We now need to put accuracy back without dropping legitimate citations.

## Fix — `supabase/functions/legal-qa/index.ts`

### 1. Expand the stopword list with high-frequency legal/Knesset boilerplate
Add to the existing stopword filter (used to count "significant" words):
`כנסת, דיון, ישיבה, הצעת, חוק, חוקים, ועדה, פרוטוקול, מליאה, ממשלה, משרד, הוראות, תיקון, מספר, עניין, לעניין`

After filtering, words like "היועצת", "משפטית", "פיטורין", "פיטורי", "יועמ"ש" remain — those are the actually discriminating tokens.

### 2. Restore Perplexity threshold to 3 significant words (after stopword expansion)
With the expanded stopwords, 3-word overlap is achievable for genuine matches but blocks generic Knesset/government boilerplate matches. Local DB cards stay at 3 (unchanged).

### 3. Add a topical-keyword guard for Perplexity matches
For Perplexity cards specifically, require **at least one "topic-bearing" word** (length ≥5, not in stopwords) to overlap between the footnote text and the card title/snippet. This is a cheap second check that kills the "matched only on common short words" case.

### 4. Keep Tier 3 (no-URL fallback) intact
Footnotes that fail the stricter Perplexity check still survive — they just appear without a clickable URL (existing behavior from the previous fix). User sees the citation text, no wrong link.

### 5. Improve logging
When a Perplexity match is rejected by the topical-keyword guard, log: `Rejected Perplexity match for fn #N: only generic words overlapped with card "<title>"`. This makes future debugging trivial.

## Why this works
- Matcher gets back the strictness it needs to refuse wrong URLs
- Legitimate citations are preserved (Tier 3 fallback already shipped)
- The fix is **content-aware** (topic-bearing word required), not just count-based, so it survives both short snippets and long ones

## Out of scope
- No client changes
- No prompt changes
- No DB / schema changes
- No re-rank changes

## File changes
- `supabase/functions/legal-qa/index.ts` — items 1, 2, 3, 5 (item 4 is unchanged, just confirming behavior)

