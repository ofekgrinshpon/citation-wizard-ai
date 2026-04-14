

## Speed Up Batch Embedding (~60x faster)

### Problem
Current rate: ~100 chunks/min → ~60 hours for 360K chunks. The bottleneck is **one embedding API call per chunk** (20 calls per batch, each with HTTP overhead).

### Solution: Batch inputs in a single OpenAI API call
OpenAI's embedding endpoint accepts an **array of inputs** — up to 2048 texts in one request. Instead of 20 sequential HTTP calls, we send all 20 (or more) texts in **one call** and get all embeddings back at once.

### Changes

1. **Increase `BATCH_SIZE` from 20 to 100** — OpenAI handles this easily in one request
2. **Rewrite `getEmbedding` → `getEmbeddings`** — accept an array of texts, return an array of embeddings in a single API call
3. **Remove per-chunk delay** — no longer needed since it's one API call per batch
4. **Update the processing loop** — bulk-update all chunks in one pass after receiving embeddings

### Expected improvement
- Current: 20 chunks × 1 API call each = ~20 API round-trips per batch (~15s)
- New: 100 chunks × 1 API call total = ~1 API round-trip per batch (~2s)
- Estimated new rate: **~2,000-3,000 chunks/min** → finishes in **2-3 hours**

### Files changed
- `supabase/functions/batch-embed-chunks/index.ts` — rewrite embedding logic to use batch input

### Technical detail
```
// Before: one call per chunk
for (chunk of chunks) {
  embedding = await getEmbedding(chunk.content);
}

// After: one call for all chunks
const texts = chunks.map(c => c.content.slice(0, 8000));
const embeddings = await getEmbeddingsBatch(texts); // single HTTP request
```

