-- Add a text search function as fallback when embeddings aren't available
CREATE OR REPLACE FUNCTION public.search_legal_chunks_text(
  search_query text,
  match_count int DEFAULT 8
)
RETURNS TABLE (
  chunk_id uuid,
  document_id uuid,
  chunk_content text,
  document_title text,
  document_citation text,
  source_type text,
  source_url text,
  metadata jsonb,
  similarity float
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id as chunk_id,
    d.id as document_id,
    c.content as chunk_content,
    d.title as document_title,
    d.citation as document_citation,
    d.source_type,
    d.source_url,
    d.metadata,
    ts_rank(
      to_tsvector('simple', c.content || ' ' || d.title || ' ' || d.citation),
      plainto_tsquery('simple', search_query)
    )::float as similarity
  FROM legal_document_chunks c
  JOIN legal_documents d ON d.id = c.document_id
  WHERE to_tsvector('simple', c.content || ' ' || d.title || ' ' || d.citation)
        @@ plainto_tsquery('simple', search_query)
  ORDER BY similarity DESC
  LIMIT match_count;
$$;