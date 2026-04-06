

# Auto-search Israeli court decisions for case law citations

## Context

The gov.il court decisions page (`spokmanship_court`) does not have a public API. Direct server-side calls are blocked by Cloudflare. The site "נט המשפט" (court.gov.il) also requires authentication. There is no official open API for Israeli case law.

## Practical approach: AI-powered web search via Perplexity

The most reliable approach is to use Perplexity (AI search engine) to look up case details when the system classifies a query as case law. Perplexity can search the web (including Nevo, court.gov.il published decisions, legal databases) and return structured results with party names, dates, and court details.

### How it works

```text
User enters: "בג"ץ 1514/01"
     ↓
System classifies → caselaw
     ↓
Edge function calls Perplexity:
  "Find Israeli court case בג"ץ 1514/01: party names, date, court, publication details"
     ↓
Perplexity returns: party names, date, court name, פד"י volume/page (if published)
     ↓
System formats citation per Rule 18/19 and returns to user
```

## Implementation plan

### 1. Connect Perplexity connector
Use the Perplexity connector to provide API access for case law searches.

### 2. Create `case-law-search` edge function
A new edge function that:
- Receives a case number (e.g., "1514/01") and case type prefix (e.g., "בג"ץ")
- Calls Perplexity with a targeted Hebrew query asking for: party names (surname only for individuals), decision date, court name, publication details (פד"י volume/page if published, or database name)
- Parses the response into structured fields
- Returns: `{ parties, date, court, publication, isPublished, databaseName }`

### 3. Integrate into `citation-chat` edge function
- When the source type is classified as case law, call the `case-law-search` function first
- Inject the search results into the AI prompt as verified metadata
- The AI then formats the citation according to Rule 18/19 using real data instead of hallucinating

### 4. Client-side integration
- In `src/pages/Index.tsx` or the chat flow: when source is classified as caselaw, show a brief "searching for case details..." indicator
- No major UI changes needed — the search happens transparently within the existing chat flow

## Limitations to be aware of
- Perplexity searches the open web; it may not find every case (especially unpublished lower court decisions)
- Results depend on what's publicly indexed (Nevo summaries, court press releases, legal blogs)
- The system will fall back to the current behavior (AI generates with `[missing:...]` placeholders) if the search returns no results
- Perplexity has rate limits and costs per request

## Files to create/modify
| File | Change |
|------|--------|
| `supabase/functions/case-law-search/index.ts` | New edge function for Perplexity case law lookup |
| `supabase/functions/citation-chat/index.ts` | Call case-law-search when source is caselaw, inject results into prompt |
| `src/pages/Index.tsx` | Minor: add "searching..." indicator for caselaw queries |

## Alternative considered: Firecrawl scraping
Firecrawl could scrape the gov.il page directly, but Cloudflare protection makes this unreliable. Perplexity is more robust since it aggregates from multiple indexed sources.

