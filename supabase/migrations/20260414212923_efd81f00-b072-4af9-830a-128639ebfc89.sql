CREATE OR REPLACE FUNCTION public.bulk_update_legal_chunk_embeddings(payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
SET statement_timeout TO '120s'
AS $$
DECLARE
  updated_count bigint;
  item jsonb;
BEGIN
  updated_count := 0;
  FOR item IN SELECT * FROM jsonb_array_elements(payload)
  LOOP
    UPDATE public.legal_document_chunks
    SET embedding = (item->>'embedding')::vector
    WHERE id = (item->>'id')::uuid;
    updated_count := updated_count + 1;
  END LOOP;
  RETURN updated_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bulk_update_legal_chunk_embeddings(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bulk_update_legal_chunk_embeddings(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.bulk_update_legal_chunk_embeddings(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_update_legal_chunk_embeddings(jsonb) TO service_role;