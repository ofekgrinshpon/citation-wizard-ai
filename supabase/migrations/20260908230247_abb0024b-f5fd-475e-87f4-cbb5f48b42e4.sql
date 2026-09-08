CREATE OR REPLACE FUNCTION public.search_legal_chunks_text(search_query text, match_count integer DEFAULT 8)
 RETURNS TABLE(chunk_id uuid, document_id uuid, chunk_content text, document_title text, document_citation text, source_type text, source_url text, metadata jsonb, similarity double precision)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '25s'
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
  ts_top1 tsquery;
  has_hit boolean := false;
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

  IF ts IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.legal_document_chunks c2
      WHERE to_tsvector('simple', c2.content) @@ ts
      LIMIT 1
    ) INTO has_hit;
  END IF;

  IF NOT has_hit AND sorted_words IS NOT NULL AND array_length(sorted_words, 1) >= 2 THEN
    BEGIN
      ts_top1 := to_tsquery(
        'simple',
        '(' || sorted_words[1] || ') | (' ||
        array_to_string(sorted_words[2:array_length(sorted_words, 1)], ' | ') || ')'
      );
    EXCEPTION WHEN OTHERS THEN
      ts_top1 := NULL;
    END;

    IF ts_top1 IS NOT NULL THEN
      RAISE NOTICE 'Keyword search fallback triggered: %', sorted_words[1];
      ts := ts_top1;
      SELECT EXISTS (
        SELECT 1 FROM public.legal_document_chunks c2
        WHERE to_tsvector('simple', c2.content) @@ ts
        LIMIT 1
      ) INTO has_hit;
    END IF;
  END IF;

  IF NOT has_hit THEN
    RAISE NOTICE 'Keyword search fallback triggered: plainto (query=%)', search_query;
    ts := plainto_tsquery('simple', search_query);
  END IF;

  IF ts IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH q AS (SELECT ts AS tsq),
  chunk_cands AS (
    -- Candidate pool is relevance-ordered BEFORE truncation, with a
    -- deterministic tie-break so identical queries select identical pools.
    SELECT
      c2.id          AS cid,
      c2.document_id AS did,
      ts_rank(to_tsvector('simple', c2.content), q.tsq) AS content_rank
    FROM public.legal_document_chunks c2, q
    WHERE to_tsvector('simple', c2.content) @@ q.tsq
    ORDER BY ts_rank(to_tsvector('simple', c2.content), q.tsq) DESC, c2.id ASC
    LIMIT 2000
  ),
  top_chunk_per_doc AS (
    SELECT cid, did, content_rank
    FROM (
      SELECT cid, did, content_rank,
             ROW_NUMBER() OVER (PARTITION BY did ORDER BY content_rank DESC, cid ASC) AS rn
      FROM chunk_cands
    ) s
    WHERE rn = 1
  ),
  meta_cands AS (
    SELECT
      d.id AS did,
      ts_rank(
        to_tsvector('simple',
          d.title || ' ' || d.citation || ' ' ||
          coalesce(d.case_number,'') || ' ' || coalesce(d.court,'')
        ),
        q.tsq
      ) AS meta_rank
    FROM public.legal_documents d, q
    WHERE to_tsvector('simple',
      d.title || ' ' || d.citation || ' ' ||
      coalesce(d.case_number,'') || ' ' || coalesce(d.court,'')
    ) @@ q.tsq
    ORDER BY ts_rank(
        to_tsvector('simple',
          d.title || ' ' || d.citation || ' ' ||
          coalesce(d.case_number,'') || ' ' || coalesce(d.court,'')
        ),
        q.tsq
      ) DESC, d.id ASC
    LIMIT 500
  ),
  all_docs AS (
    SELECT did FROM top_chunk_per_doc
    UNION
    SELECT did FROM meta_cands
  )
  SELECT
    c.id           AS chunk_id,
    d.id           AS document_id,
    c.content      AS chunk_content,
    d.title        AS document_title,
    d.citation     AS document_citation,
    d.source_type,
    d.source_url,
    d.metadata,
    (
      coalesce(m.meta_rank, 0)
      + coalesce(tc.content_rank, 0)
      + CASE
          WHEN m.meta_rank IS NOT NULL AND tc.content_rank IS NOT NULL
          THEN 0.1
          ELSE 0
        END
    )::float AS similarity
  FROM all_docs ad
  JOIN public.legal_documents d        ON d.id = ad.did
  LEFT JOIN top_chunk_per_doc tc       ON tc.did = ad.did
  LEFT JOIN meta_cands m               ON m.did = ad.did
  LEFT JOIN public.legal_document_chunks c ON c.id = tc.cid
  ORDER BY similarity DESC, d.id ASC
  LIMIT match_count;
END;
$function$;