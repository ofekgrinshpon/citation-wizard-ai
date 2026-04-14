

## Upgrade Retrieval to Semantic Vector Search (Hybrid)

### Current state
- 361,576 chunks across 13,009 documents — **zero have embeddings**
- The `embedding` column (vector(768)) already exists on both `legal_documents` and `legal_document_chunks`
- The `match_legal_chunks` RPC function already exists for vector similarity search
- The `search-legal-sources` edge function already calls `/v1/embeddings` with `text-embedding-3-small` — this is the embedding endpoint we'll use
- No HNSW index exists on the embedding column

### Challenge: Batch embedding 361K chunks
This is a large batch job. At ~500ms per embedding call, processing all 361K chunks sequentially would take ~50 hours. We need a batch edge function that processes chunks in batches, can be called repeatedly, and picks up where it left off.

### Plan

**Phase 1: Database setup (migration)**
- Create an HNSW index on `legal_document_chunks.embedding` for fast cosine similarity search:
  ```sql
  CREATE INDEX idx_legal_chunks_embedding_hnsw
  ON public.legal_document_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
  ```

**Phase 2: Batch embedding edge function**
- Create `supabase/functions/batch-embed-chunks/index.ts`
- Admin-only, processes chunks in batches of 50
- Selects chunks where `embedding IS NULL`, generates embeddings via `/v1/embeddings` (model: `text-embedding-3-small`, dimensions: 768), updates each chunk
- Returns count of processed/remaining chunks
- Can be called repeatedly until all chunks are embedded
- Includes rate-limit-aware delays between calls

**Phase 3: Update `legal-qa` retrieval to hybrid search**
- Add an embedding generation step for the user's query (call `/v1/embeddings`)
- Run both searches in parallel:
  - **Keyword search**: existing `search_legal_chunks_text` RPC (top 5)
  - **Vector search**: new `match_legal_chunks` RPC with query embedding (top 5, threshold 0.7)
- Merge and deduplicate results by `document_id`, keeping the higher similarity score
- Feed combined results into the existing re-ranking step
- Graceful fallback: if embedding generation fails, fall back to keyword-only search (current behavior)

**Phase 4: Update `match_legal_chunks` SQL function**
- The existing function works but only returns 1 chunk per document. Update to return up to 2 chunks (matching the text search behavior) for consistency.

### What you'll need to do after deployment
- Call the batch embedding function repeatedly (via the admin panel or curl) to generate embeddings for all 361K chunks. This will take time but can run in the background. The hybrid search will work immediately — it will just use keyword-only results until embeddings are populated, then gradually improve as more chunks get embedded.

### Technical details
- All embedding generation uses the Lovable AI Gateway `/v1/embeddings` endpoint with `text-embedding-3-small` (768 dimensions)
- HNSW index uses cosine distance (`vector_cosine_ops`) — best for normalized text embeddings
- Hybrid search adds ~200ms latency for query embedding generation
- The batch function processes 50 chunks per call with 200ms delays to avoid rate limits
- Files changed:
  - `supabase/functions/legal-qa/index.ts` (hybrid retrieval)
  - `supabase/functions/batch-embed-chunks/index.ts` (new)
  - SQL migration (HNSW index)
  - `supabase/config.toml` (new function config)

