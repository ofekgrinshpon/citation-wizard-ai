
-- Create HNSW index for fast cosine similarity search on chunk embeddings
CREATE INDEX IF NOT EXISTS idx_legal_chunks_embedding_hnsw
ON public.legal_document_chunks
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Update match_legal_chunks to return up to 2 chunks per document (consistent with text search)
CREATE OR REPLACE FUNCTION public.match_legal_chunks(
  query_embedding extensions.vector,
  match_threshold double precision DEFAULT 0.7,
  match_count integer DEFAULT 10
)
RETURNS TABLE(
  chunk_id uuid,
  document_id uuid,
  chunk_content text,
  document_title text,
  document_citation text,
  source_type text,
  source_url text,
  metadata jsonb,
  similarity double precision
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN QUERY
  WITH ranked AS (
    SELECT
      c.id AS chunk_id,
      d.id AS document_id,
      c.content AS chunk_content,
      d.title AS document_title,
      d.citation AS document_citation,
      d.source_type,
      d.source_url,
      d.metadata,
      (1 - (c.embedding <=> query_embedding))::float AS similarity,
      ROW_NUMBER() OVER (PARTITION BY d.id ORDER BY c.embedding <=> query_embedding) AS rn
    FROM public.legal_document_chunks c
    JOIN public.legal_documents d ON d.id = c.document_id
    WHERE c.embedding IS NOT NULL
      AND (1 - (c.embedding <=> query_embedding)) > match_threshold
  )
  SELECT ranked.chunk_id, ranked.document_id, ranked.chunk_content, ranked.document_title,
         ranked.document_citation, ranked.source_type, ranked.source_url, ranked.metadata, ranked.similarity
  FROM ranked
  WHERE ranked.rn <= 2
  ORDER BY ranked.similarity DESC
  LIMIT match_count;
END;
$function$;
