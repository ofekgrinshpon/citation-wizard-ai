

## Fix: Improve source relevance in Legal QA

### Problem
The retrieval pipeline matches keywords, not legal topics. A question about "presidential pardons" retrieves any document mentioning "president" — including cases about government formation, ministerial appointments, etc. The AI then cites these irrelevant sources because they were provided as context.

### Root cause
1. **Keyword-only retrieval**: `search_legal_chunks_text` uses PostgreSQL `ts_rank` on title/citation text with OR logic. No semantic understanding.
2. **Only first chunk returned**: The lateral join gets `chunk_index = 0` only — often just an abstract or header, not the substantive content.
3. **No re-ranking step**: All 10 matches go straight to the AI with equal weight.

### Proposed fix: AI-based re-ranking step

Add a lightweight re-ranking step between retrieval and prompt construction. Use the AI (or a fast model) to score each retrieved source's relevance to the specific legal question, then keep only the top sources.

**File: `supabase/functions/legal-qa/index.ts`**

**A. Add a re-ranking function (~after line 160)**

After local search returns 10 matches, send a quick scoring request to Gemini Flash asking it to rate each source's relevance (0-10) to the specific legal question. This uses the source title + first chunk excerpt. Keep only sources scoring 5+.

```text
Input:  question + 10 source titles/excerpts
Output: relevance scores (0-10) for each
Filter: keep only score >= 5
```

This adds ~2-3 seconds but dramatically improves citation quality.

**B. Retrieve more chunks per document (~modify SQL function)**

Change the lateral join from `LIMIT 1` to `LIMIT 2` so the AI gets more context per document (not just the intro paragraph). This helps both the re-ranker and the final AI judge relevance.

**C. Pass relevance scores to the AI prompt**

Tag source cards with their relevance score so the AI can prioritize higher-scored sources:
```
[1][מאומת][רלוונטיות: 9] בג"ץ 428/86 ברזילי נ' ממשלת ישראל — פסיקה
[2][מאומת][רלוונטיות: 3] בג"ץ 4588/04 העמותה... — פסיקה  ← filtered out
```

### Alternative: Embedding-based search (longer-term)

The database has a `vector(768)` embedding column on `legal_documents`, but it's currently bypassed (the code hard-codes empty results for the embedding model). Re-enabling semantic search with a working embedding model would be the best long-term fix but requires generating embeddings for all ~19,670 documents.

### Technical details
- Primary changes in `supabase/functions/legal-qa/index.ts`
- SQL function update via migration for multi-chunk retrieval
- Re-ranking uses the same Gemini Flash model (fast, ~2s for 10 sources)
- Total latency increase: ~2-3 seconds
- No UI changes needed

