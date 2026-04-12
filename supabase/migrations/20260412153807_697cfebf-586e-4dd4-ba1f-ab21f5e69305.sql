
CREATE OR REPLACE FUNCTION public.search_legal_chunks_text(search_query text, match_count integer DEFAULT 8)
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
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  or_query text;
  ts tsquery;
BEGIN
  SELECT string_agg(word, ' | ')
  INTO or_query
  FROM unnest(string_to_array(trim(search_query), ' ')) AS word
  WHERE length(word) >= 2;

  IF or_query IS NULL OR or_query = '' THEN
    or_query := search_query;
  END IF;

  ts := to_tsquery('simple', or_query);

  RETURN QUERY
  SELECT
    c.id AS chunk_id,
    d.id AS document_id,
    c.content AS chunk_content,
    d.title AS document_title,
    d.citation AS document_citation,
    d.source_type,
    d.source_url,
    d.metadata,
    ts_rank(
      to_tsvector('simple', c.content),
      ts
    )::float AS similarity
  FROM public.legal_document_chunks c
  JOIN public.legal_documents d ON d.id = c.document_id
  WHERE to_tsvector('simple', c.content) @@ ts
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$function$;
