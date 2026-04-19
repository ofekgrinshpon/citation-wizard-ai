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
  result_count integer := 0;
  attempt_top1_word text;
BEGIN
  -- Tokenize: drop length<2 noise
  SELECT array_agg(w)
  INTO words
  FROM unnest(string_to_array(trim(search_query), ' ')) AS w
  WHERE length(w) >= 2;

  IF words IS NULL OR array_length(words, 1) IS NULL THEN
    ts := plainto_tsquery('simple', search_query);
  ELSE
    SELECT array_agg(w ORDER BY length(w) DESC, w) INTO sorted_words
    FROM unnest(words) AS w;

    -- ── Attempt 1: top-2 AND + rest OR ──
    IF array_length(sorted_words, 1) <= 2 THEN
      required := sorted_words;
      boosters := NULL;
    ELSE
      required := sorted_words[1:2];
      boosters := sorted_words[3:array_length(sorted_words, 1)];
    END IF;

    and_part := NULL; or_part := NULL;
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
      ts := NULL;
    END;
  END IF;

  -- ── Run attempt 1 into a temp table to count rows ──
  CREATE TEMP TABLE IF NOT EXISTS _slc_results (
    chunk_id uuid, document_id uuid, chunk_content text,
    document_title text, document_citation text, source_type text,
    source_url text, metadata jsonb, similarity double precision
  ) ON COMMIT DROP;
  TRUNCATE _slc_results;

  IF ts IS NOT NULL THEN
    INSERT INTO _slc_results
    SELECT
      c.id, d.id, c.content, d.title, d.citation, d.source_type, d.source_url, d.metadata,
      (
        ts_rank(
          to_tsvector('simple',
            d.title || ' ' || d.citation || ' ' ||
            coalesce(d.case_number,'') || ' ' || coalesce(d.court,'')
          ), ts
        )
        + ts_rank(c.content_tsv, ts)
        + CASE
            WHEN to_tsvector('simple',
                   d.title || ' ' || d.citation || ' ' ||
                   coalesce(d.case_number,'') || ' ' || coalesce(d.court,'')
                 ) @@ ts
              AND c.content_tsv @@ ts
            THEN 0.1 ELSE 0
          END
      )::float
    FROM public.legal_documents d
    JOIN LATERAL (
      SELECT c2.id, c2.content, to_tsvector('simple', c2.content) AS content_tsv
      FROM public.legal_document_chunks c2
      WHERE c2.document_id = d.id
        AND to_tsvector('simple', c2.content) @@ ts
      ORDER BY ts_rank(to_tsvector('simple', c2.content), ts) DESC
      LIMIT 1
    ) c ON true
    WHERE
      to_tsvector('simple',
        d.title || ' ' || d.citation || ' ' ||
        coalesce(d.case_number,'') || ' ' || coalesce(d.court,'')
      ) @@ ts
      OR c.content_tsv @@ ts
    ORDER BY 9 DESC
    LIMIT match_count;

    GET DIAGNOSTICS result_count = ROW_COUNT;
  END IF;

  -- ── Attempt 2: top-1 AND + rest OR fallback ──
  IF result_count = 0 AND sorted_words IS NOT NULL AND array_length(sorted_words, 1) >= 2 THEN
    attempt_top1_word := sorted_words[1];
    RAISE NOTICE 'Keyword search fallback triggered: %', attempt_top1_word;

    required := sorted_words[1:1];
    boosters := sorted_words[2:array_length(sorted_words, 1)];
    and_part := array_to_string(required, ' & ');
    or_part := array_to_string(boosters, ' | ');
    combined := '(' || and_part || ') | (' || or_part || ')';

    BEGIN
      ts := to_tsquery('simple', combined);
    EXCEPTION WHEN OTHERS THEN
      ts := NULL;
    END;

    IF ts IS NOT NULL THEN
      INSERT INTO _slc_results
      SELECT
        c.id, d.id, c.content, d.title, d.citation, d.source_type, d.source_url, d.metadata,
        (
          ts_rank(
            to_tsvector('simple',
              d.title || ' ' || d.citation || ' ' ||
              coalesce(d.case_number,'') || ' ' || coalesce(d.court,'')
            ), ts
          )
          + ts_rank(c.content_tsv, ts)
          + CASE
              WHEN to_tsvector('simple',
                     d.title || ' ' || d.citation || ' ' ||
                     coalesce(d.case_number,'') || ' ' || coalesce(d.court,'')
                   ) @@ ts
                AND c.content_tsv @@ ts
              THEN 0.1 ELSE 0
            END
        )::float
      FROM public.legal_documents d
      JOIN LATERAL (
        SELECT c2.id, c2.content, to_tsvector('simple', c2.content) AS content_tsv
        FROM public.legal_document_chunks c2
        WHERE c2.document_id = d.id
          AND to_tsvector('simple', c2.content) @@ ts
        ORDER BY ts_rank(to_tsvector('simple', c2.content), ts) DESC
        LIMIT 1
      ) c ON true
      WHERE
        to_tsvector('simple',
          d.title || ' ' || d.citation || ' ' ||
          coalesce(d.case_number,'') || ' ' || coalesce(d.court,'')
        ) @@ ts
        OR c.content_tsv @@ ts
      ORDER BY 9 DESC
      LIMIT match_count;

      GET DIAGNOSTICS result_count = ROW_COUNT;
    END IF;
  END IF;

  -- ── Attempt 3: plainto_tsquery final fallback ──
  IF result_count = 0 THEN
    RAISE NOTICE 'Keyword search fallback triggered: plainto (query=%)', search_query;
    ts := plainto_tsquery('simple', search_query);
    IF ts IS NOT NULL THEN
      INSERT INTO _slc_results
      SELECT
        c.id, d.id, c.content, d.title, d.citation, d.source_type, d.source_url, d.metadata,
        (
          ts_rank(
            to_tsvector('simple',
              d.title || ' ' || d.citation || ' ' ||
              coalesce(d.case_number,'') || ' ' || coalesce(d.court,'')
            ), ts
          )
          + ts_rank(c.content_tsv, ts)
        )::float
      FROM public.legal_documents d
      JOIN LATERAL (
        SELECT c2.id, c2.content, to_tsvector('simple', c2.content) AS content_tsv
        FROM public.legal_document_chunks c2
        WHERE c2.document_id = d.id
          AND to_tsvector('simple', c2.content) @@ ts
        ORDER BY ts_rank(to_tsvector('simple', c2.content), ts) DESC
        LIMIT 1
      ) c ON true
      WHERE
        to_tsvector('simple',
          d.title || ' ' || d.citation || ' ' ||
          coalesce(d.case_number,'') || ' ' || coalesce(d.court,'')
        ) @@ ts
        OR c.content_tsv @@ ts
      ORDER BY 9 DESC
      LIMIT match_count;
    END IF;
  END IF;

  RETURN QUERY
  SELECT r.chunk_id, r.document_id, r.chunk_content, r.document_title, r.document_citation,
         r.source_type, r.source_url, r.metadata, r.similarity
  FROM _slc_results r
  ORDER BY r.similarity DESC
  LIMIT match_count;
END;
$function$;