CREATE OR REPLACE FUNCTION public.search_legal_chunks_text(search_query text, match_count integer DEFAULT 8)
 RETURNS TABLE(chunk_id uuid, document_id uuid, chunk_content text, document_title text, document_citation text, source_type text, source_url text, metadata jsonb, similarity double precision)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  words text[];
  sorted_words text[];
  required text[];
  boosters text[];
  and_part text;
  or_part text;
  combined text;
  ts tsquery;
BEGIN
  SELECT array_agg(w)
  INTO words
  FROM unnest(string_to_array(trim(search_query), ' ')) AS w
  WHERE length(w) >= 2;

  IF words IS NULL OR array_length(words, 1) IS NULL THEN
    ts := plainto_tsquery('simple', search_query);
  ELSE
    SELECT array_agg(w ORDER BY length(w) DESC, w) INTO sorted_words
    FROM unnest(words) AS w;

    IF array_length(sorted_words, 1) <= 2 THEN
      required := sorted_words;
      boosters := NULL;
    ELSE
      required := sorted_words[1:2];
      boosters := sorted_words[3:array_length(sorted_words, 1)];
    END IF;

    IF required IS NOT NULL AND array_length(required, 1) IS NOT NULL THEN
      and_part := array_to_string(required, ' & ');
    END IF;

    IF boosters IS NOT NULL AND array_length(boosters, 1) IS NOT NULL THEN
      or_part := array_to_string(boosters, ' | ');
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
      BEGIN
        ts := to_tsquery('simple', array_to_string(words, ' | '));
      EXCEPTION WHEN OTHERS THEN
        ts := plainto_tsquery('simple', search_query);
      END;
    END;
  END IF;

  RETURN QUERY
  WITH q AS (SELECT ts AS tsq)
  SELECT
    c.id AS chunk_id,
    d.id AS document_id,
    c.content AS chunk_content,
    d.title AS document_title,
    d.citation AS document_citation,
    d.source_type,
    d.source_url,
    d.metadata,
    (
      ts_rank(
        to_tsvector('simple',
          d.title || ' ' || d.citation || ' ' ||
          coalesce(d.case_number,'') || ' ' || coalesce(d.court,'')
        ),
        q.tsq
      )
      + ts_rank(c.content_tsv, q.tsq)
      + CASE
          WHEN to_tsvector('simple',
                 d.title || ' ' || d.citation || ' ' ||
                 coalesce(d.case_number,'') || ' ' || coalesce(d.court,'')
               ) @@ q.tsq
            AND c.content_tsv @@ q.tsq
          THEN 0.1
          ELSE 0
        END
    )::float AS similarity
  FROM public.legal_documents d
  CROSS JOIN q
  JOIN LATERAL (
    SELECT c2.id, c2.content, to_tsvector('simple', c2.content) AS content_tsv
    FROM public.legal_document_chunks c2
    WHERE c2.document_id = d.id
      AND to_tsvector('simple', c2.content) @@ q.tsq
    ORDER BY ts_rank(to_tsvector('simple', c2.content), q.tsq) DESC
    LIMIT 1
  ) c ON true
  WHERE
    to_tsvector('simple',
      d.title || ' ' || d.citation || ' ' ||
      coalesce(d.case_number,'') || ' ' || coalesce(d.court,'')
    ) @@ q.tsq
    OR c.content_tsv @@ q.tsq
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$function$;