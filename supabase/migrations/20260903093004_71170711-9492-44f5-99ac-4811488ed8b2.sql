CREATE OR REPLACE FUNCTION public.local_caselaw_body_signals(_doc_ids uuid[])
RETURNS TABLE(document_id uuid, case_number text, body_chars integer, head_text text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.id,
         d.case_number,
         COALESCE(char_length(d.content), 0)::int,
         LEFT(COALESCE(d.content, ''), 3000)
  FROM public.legal_documents d
  WHERE d.id = ANY(_doc_ids)
$$;

REVOKE ALL ON FUNCTION public.local_caselaw_body_signals(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.local_caselaw_body_signals(uuid[]) TO service_role;