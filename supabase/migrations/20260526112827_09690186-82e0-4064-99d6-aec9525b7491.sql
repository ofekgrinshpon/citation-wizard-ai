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
SET statement_timeout TO '25s'
AS $function$
DECLARE
  overfetch integer;
BEGIN
  overfetch := GREATEST(match_count * 20, 200);
  -- ef_search must be >= LIMIT for HNSW to return enough candidates.
  PERFORM set_config('hnsw.ef_search', GREATEST(overfetch, 200)::text, true);

  RETURN QUERY
  WITH topk AS (
    SELECT
      c.id            AS chunk_id,
      c.document_id   AS document_id,
      c.content       AS chunk_content,
      (c.embedding <=> query_embedding) AS distance
    FROM public.legal_document_chunks c
    ORDER BY c.embedding <=> query_embedding
    LIMIT overfetch
  ),
  scored AS (
    SELECT
      t.chunk_id,
      t.document_id,
      t.chunk_content,
      (1 - t.distance)::float AS similarity,
      ROW_NUMBER() OVER (
        PARTITION BY t.document_id
        ORDER BY t.distance
      ) AS rn
    FROM topk t
    WHERE (1 - t.distance) > match_threshold
  )
  SELECT
    s.chunk_id,
    d.id            AS document_id,
    s.chunk_content,
    d.title         AS document_title,
    d.citation      AS document_citation,
    d.source_type,
    d.source_url,
    d.metadata,
    s.similarity
  FROM scored s
  JOIN public.legal_documents d ON d.id = s.document_id
  WHERE s.rn <= 2
  ORDER BY s.similarity DESC
  LIMIT match_count;
END;
$function$;