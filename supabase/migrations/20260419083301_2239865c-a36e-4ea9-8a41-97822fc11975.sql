
-- Fix #2: Add a vector match function that supports source_type filtering
CREATE OR REPLACE FUNCTION public.match_legal_chunks_filtered(
  query_embedding extensions.vector,
  filter_source_type text,
  match_threshold double precision DEFAULT 0.4,
  match_count integer DEFAULT 8
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
      AND d.source_type = filter_source_type
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

-- Fix #3: Tighten keyword scoring. Distinctive terms (length >= 4) are required (AND);
-- short terms remain optional (OR). This breaks ts_rank ties by demanding presence of
-- specific topical words while still tolerating filler.
CREATE OR REPLACE FUNCTION public.search_legal_chunks_text(
  search_query text,
  match_count integer DEFAULT 8
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
SET search_path TO 'public'
AS $function$
DECLARE
  words text[];
  distinctive text[];
  common_words text[];
  and_part text;
  or_part text;
  combined text;
  ts tsquery;
BEGIN
  -- Split tokens, keep words length >= 2
  SELECT array_agg(w)
  INTO words
  FROM unnest(string_to_array(trim(search_query), ' ')) AS w
  WHERE length(w) >= 2;

  IF words IS NULL OR array_length(words, 1) IS NULL THEN
    -- Fallback to plain query
    ts := plainto_tsquery('simple', search_query);
  ELSE
    -- Distinctive: length >= 4 (specific topical Hebrew terms)
    SELECT array_agg(w) INTO distinctive
    FROM unnest(words) AS w WHERE length(w) >= 4;

    -- Common: length 2-3 (short connectors / particles still useful for ranking via OR)
    SELECT array_agg(w) INTO common_words
    FROM unnest(words) AS w WHERE length(w) < 4;

    -- AND distinctive terms together (require all), OR with common words as soft signal
    IF distinctive IS NOT NULL AND array_length(distinctive, 1) IS NOT NULL THEN
      and_part := array_to_string(distinctive, ' & ');
    END IF;

    IF common_words IS NOT NULL AND array_length(common_words, 1) IS NOT NULL THEN
      or_part := array_to_string(common_words, ' | ');
    END IF;

    IF and_part IS NOT NULL AND or_part IS NOT NULL THEN
      combined := '(' || and_part || ') | (' || or_part || ')';
    ELSIF and_part IS NOT NULL THEN
      combined := and_part;
    ELSIF or_part IS NOT NULL THEN
      combined := or_part;
    ELSE
      combined := search_query;
    END IF;

    BEGIN
      ts := to_tsquery('simple', combined);
    EXCEPTION WHEN OTHERS THEN
      -- If tsquery parse fails, fall back to OR of all words
      ts := to_tsquery('simple', array_to_string(words, ' | '));
    END;
  END IF;

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
      to_tsvector('simple', d.title || ' ' || d.citation || ' ' || coalesce(d.case_number,'') || ' ' || coalesce(d.court,'')),
      ts
    )::float AS similarity
  FROM public.legal_documents d
  JOIN LATERAL (
    SELECT c2.id, c2.content
    FROM public.legal_document_chunks c2
    WHERE c2.document_id = d.id
    ORDER BY c2.chunk_index
    LIMIT 2
  ) c ON true
  WHERE to_tsvector('simple', d.title || ' ' || d.citation || ' ' || coalesce(d.case_number,'') || ' ' || coalesce(d.court,''))
        @@ ts
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$function$;
