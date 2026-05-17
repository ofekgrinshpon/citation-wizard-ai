
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS idx_legal_documents_title_trgm
  ON public.legal_documents USING gin (title extensions.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_legal_documents_citation_trgm
  ON public.legal_documents USING gin (citation extensions.gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.search_legal_chunks_trigram(
  search_terms text[],
  match_count integer DEFAULT 12,
  similarity_threshold double precision DEFAULT 0.25
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
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  cleaned_terms text[];
BEGIN
  SELECT array_agg(t) INTO cleaned_terms
  FROM unnest(search_terms) AS t
  WHERE t IS NOT NULL AND length(trim(t)) >= 3;

  IF cleaned_terms IS NULL OR array_length(cleaned_terms, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH doc_scores AS (
    SELECT
      d.id AS doc_id,
      GREATEST(
        COALESCE(MAX(extensions.similarity(d.title, t)), 0),
        COALESCE(MAX(extensions.similarity(d.citation, t)), 0)
      )::float AS sim
    FROM public.legal_documents d
    CROSS JOIN unnest(cleaned_terms) AS t
    WHERE d.title % t OR d.citation % t
    GROUP BY d.id
    HAVING GREATEST(
      COALESCE(MAX(extensions.similarity(d.title, t)), 0),
      COALESCE(MAX(extensions.similarity(d.citation, t)), 0)
    ) >= similarity_threshold
    ORDER BY sim DESC
    LIMIT match_count
  )
  SELECT
    c.id AS chunk_id,
    d.id AS document_id,
    c.content AS chunk_content,
    d.title AS document_title,
    d.citation AS document_citation,
    d.source_type,
    d.source_url,
    d.metadata,
    ds.sim AS similarity
  FROM doc_scores ds
  JOIN public.legal_documents d ON d.id = ds.doc_id
  LEFT JOIN LATERAL (
    SELECT c2.id, c2.content
    FROM public.legal_document_chunks c2
    WHERE c2.document_id = d.id
    ORDER BY length(c2.content) DESC
    LIMIT 1
  ) c ON true
  ORDER BY ds.sim DESC;
END;
$function$;
