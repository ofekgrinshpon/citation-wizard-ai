CREATE OR REPLACE FUNCTION public.bulk_update_legal_chunk_embeddings(payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  updated_count bigint;
BEGIN
  UPDATE public.legal_document_chunks AS ldc
  SET embedding = (item->>'embedding')::vector
  FROM jsonb_array_elements(payload) AS item
  WHERE ldc.id = (item->>'id')::uuid;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bulk_update_legal_chunk_embeddings(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bulk_update_legal_chunk_embeddings(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.bulk_update_legal_chunk_embeddings(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_update_legal_chunk_embeddings(jsonb) TO service_role;