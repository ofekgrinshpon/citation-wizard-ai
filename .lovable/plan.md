

# Fix: Over-Aggressive Footnote Stripping (0 Footnotes Returned)

## The Problem
The anti-hallucination filter stripped **all 11 footnotes** because `matchFootnoteToCard` couldn't match any AI-written citation to the provided source cards. The logs confirm: 0 local sources survived re-ranking, and all 8 source cards were Perplexity URLs. Since Perplexity cards store only a raw URL as `citation` (e.g., `https://www.nevo.co.il/handlers/...`), the keyword-overlap matching logic (which compares Hebrew words) found zero matches.

## Root Causes
1. **Perplexity cards have URL-only citations** — `matchFootnoteToCard` tries keyword overlap on `card.citation`, but the citation is just a URL, so Hebrew word matching always fails.
2. **URL matching is too narrow** — it only checks the first 30 chars of the URL domain, missing nevo.co.il handler URLs with different query parameters.
3. **No fallback** — when ALL footnotes are stripped, the user gets a body with dangling `[1]...[11]` references and zero footnotes.

## Fix (in `supabase/functions/legal-qa/index.ts`)

### 1. Improve Perplexity URL matching
For Perplexity source cards, extract the domain and key path segments. When the AI footnote contains a URL from the same domain, match it. Also match by nevo document ID patterns.

### 2. Allow Perplexity-sourced footnotes with relaxed matching
Since the AI was explicitly given these Perplexity URLs as source cards, any footnote referencing them is not hallucinated. Add a pass that checks if the footnote text contains any of the Perplexity URLs (or their key identifiers like nevo document IDs).

### 3. Add a safety fallback
If ALL footnotes are stripped (footnotes array is empty but AI wrote footnotes), fall back to keeping the AI-formatted footnotes tagged as "unverified" rather than returning zero footnotes. This prevents the broken UX of a body full of superscript references pointing to nothing.

### 4. Improve re-ranking threshold
The re-ranking filtered out ALL 8 local chunks (scores 0,1,0,0 — the one with score 1 was also dropped). Lower the minimum score or keep at least the top-scoring chunk to avoid 0 local sources.

## Files to Change
- `supabase/functions/legal-qa/index.ts` — improve `matchFootnoteToCard` for Perplexity cards, add empty-result fallback, adjust re-ranking threshold

## Expected Result
- Footnotes from Perplexity-sourced URLs will be correctly matched and kept
- Users will never see a body full of references with zero footnotes
- Local chunks with even marginal relevance won't all be filtered out

