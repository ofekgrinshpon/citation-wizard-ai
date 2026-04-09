

## Speed Fix: Skip Embeddings During Ingestion (Also Fixes a Bug)

### Discovery

There is a **major incompatibility** in the current pipeline:

- **Ingestion** generates embeddings using `gemini-2.5-flash-lite` (chat completion that fakes a 768-dim vector)
- **Search** generates query embeddings using `text-embedding-3-small` (a real embedding model)

These produce vectors in **completely different mathematical spaces**. Vector search will never find meaningful matches between them. The embeddings generated during ingestion are essentially wasted effort -- they take most of the time and don't actually work for search.

The good news: `legal-qa` already has a **text search fallback** (`search_legal_chunks_text`) that works perfectly without any embeddings.

### Solution

**Skip all embedding generation during ingestion.** This will:
- Make ingestion **~10x faster** (currently ~80% of time is spent on embedding API calls)
- Eliminate the timeout issues entirely
- Remove the need for wake locks and resume buttons (it'll just finish)
- Fix the broken vector search (no more mismatched embeddings)

Documents and chunks are still stored with full text, so text search works immediately.

### Changes

**1. `supabase/functions/apify-ingest-cases/index.ts`**
- Remove `getEmbedding()` function entirely
- Remove all embedding generation calls (document-level and chunk-level)
- Store chunks with `embedding: null`
- Store documents with `embedding: null`, `ingestion_status: 'complete'`
- Remove inter-chunk delays (no longer needed)
- Expected batch time: ~2-3 seconds instead of ~60+ seconds

**2. `src/components/admin/ApifyIngestionPanel.tsx`**
- Increase `BATCH_SIZE` from 2 back to 10 (batches will be fast now)
- Can simplify/remove the wake lock and resume logic (optional, but no longer critical)

### What about semantic search?

If you want vector search later, we can add a separate "Generate Embeddings" admin button that uses the **correct** `text-embedding-3-small` model to embed all stored chunks. This would be a one-time background process, not part of ingestion.

### Expected result
- 97 documents ingested in ~2-3 minutes total (instead of 60+)
- No timeouts, no pausing, no resume needed
- Text search works immediately
- Vector search can be added properly later

