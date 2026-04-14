-- Temporarily drop the HNSW index to allow fast bulk embedding updates
-- This index makes every vector UPDATE extremely slow due to graph rebuilding
DROP INDEX IF EXISTS public.idx_legal_chunks_embedding_hnsw;