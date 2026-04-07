

# Fix Citation Clustering and Source Quality

## Problems
1. **Citation clustering**: Multiple footnote marks (e.g., ¹²³⁴⁵) pile up on a single sentence instead of being spread across the answer
2. **Low-quality sources**: Perplexity returns lawyer blogs and legal review websites instead of primary sources (statutes, case law, academic books)

## Approach
Strengthen both the Perplexity search prompt and the Gemini structuring prompt. No database/v2 needed — the issue is prompt quality.

## Changes

### 1. Perplexity Prompt (`supabase/functions/legal-qa/index.ts`)
- Add `search_domain_filter` to prioritize official legal databases: `nevo.co.il`, `www.nevo.co.il`, `supreme.court.gov.il`, `knesset.gov.il`, `lawdata.co.il`, `psakdin.co.il`
- Rewrite system prompt to explicitly demand **primary sources only**: statutes with S.H./K.T. numbers, court decisions with case numbers, academic books/articles from law journals — NOT blog posts, law firm websites, or legal summaries
- Add negative instruction: "Do NOT cite lawyer blogs, law firm marketing pages, or legal news summaries. Only cite the original statute, court decision, or academic publication."

### 2. Gemini Structuring Prompt (`supabase/functions/legal-qa/index.ts`)
- Add rule: "Each sentence may have AT MOST ONE footnote mark. Spread citations across different sentences. If multiple sources support the same point, place each on a different sentence that discusses a different aspect."
- Add rule: "Prefer fewer, higher-quality footnotes (5-8 per answer) over many low-quality ones."
- Add rule: "Do NOT create footnotes for lawyer blogs, law firm websites, or legal summaries. Only cite primary legal sources: legislation, case law, books, and journal articles."

### 3. Post-processing filter (`supabase/functions/legal-qa/index.ts`)
- After parsing footnotes, filter out any whose URL contains known blog/marketing domains (e.g., patterns like `/blog/`, `law-firm`, `adv-`, `עורכי-דין`)
- Re-number remaining footnotes and update superscripts in the answer accordingly

## Result
Answers will have well-distributed footnotes (one per sentence, 5-8 total) citing only primary legal sources — statutes, court decisions, and academic literature.

