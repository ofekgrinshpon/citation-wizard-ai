CREATE OR REPLACE FUNCTION public.search_legal_chunks_tsquery(
  tsq_primary text,
  tsq_fallback text DEFAULT NULL,
  raw_query text DEFAULT NULL,
  match_count integer DEFAULT 8
)
RETURNS TABLE(chunk_id uuid, document_id uuid, chunk_content text, document_title text, document_citation text, source_type text, source_url text, metadata jsonb, similarity double precision, tsquery_used text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '25s'
AS $function$
DECLARE
  ts tsquery;
  used text;
  has_hit boolean := false;
BEGIN
  IF tsq_primary IS NOT NULL AND length(trim(tsq_primary)) > 0 THEN
    BEGIN
      ts := to_tsquery('simple', tsq_primary);
      used := 'primary';
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

  IF NOT has_hit AND tsq_fallback IS NOT NULL AND length(trim(tsq_fallback)) > 0 THEN
    BEGIN
      ts := to_tsquery('simple', tsq_fallback);
      used := 'fallback';
    EXCEPTION WHEN OTHERS THEN
      ts := NULL;
    END;
    IF ts IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM public.legal_document_chunks c2
        WHERE to_tsvector('simple', c2.content) @@ ts
        LIMIT 1
      ) INTO has_hit;
    END IF;
  END IF;

  IF NOT has_hit AND raw_query IS NOT NULL AND length(trim(raw_query)) > 0 THEN
    ts := plainto_tsquery('simple', raw_query);
    used := 'plainto';
  END IF;

  IF ts IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH q AS (SELECT ts AS tsq),
  chunk_cands AS (
    SELECT
      c2.id          AS cid,
      c2.document_id AS did,
      ts_rank(to_tsvector('simple', c2.content), q.tsq) AS content_rank
    FROM public.legal_document_chunks c2, q
    WHERE to_tsvector('simple', c2.content) @@ q.tsq
    LIMIT 2000
  ),
  top_chunk_per_doc AS (
    SELECT cid, did, content_rank
    FROM (
      SELECT cid, did, content_rank,
             ROW_NUMBER() OVER (PARTITION BY did ORDER BY content_rank DESC) AS rn
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
    )::float AS similarity,
    used AS tsquery_used
  FROM all_docs ad
  JOIN public.legal_documents d        ON d.id = ad.did
  LEFT JOIN top_chunk_per_doc tc       ON tc.did = ad.did
  LEFT JOIN meta_cands m               ON m.did = ad.did
  LEFT JOIN public.legal_document_chunks c ON c.id = tc.cid
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.search_legal_chunks_tsquery(text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_legal_chunks_tsquery(text, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.search_legal_chunks_tsquery(text, text, text, integer) TO authenticated;