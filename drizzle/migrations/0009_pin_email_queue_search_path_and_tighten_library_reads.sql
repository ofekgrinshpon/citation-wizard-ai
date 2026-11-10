-- Email queue helpers: pin lookup path (bodies already schema-qualify pgmq.*)
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = '';
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = '';
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = '';
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = '';

-- Shared legal library / verified sources: readable by signed-in users only
DROP POLICY IF EXISTS "Anyone can read verified sources" ON public.verified_sources;
CREATE POLICY "Signed-in users can read verified sources"
  ON public.verified_sources FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Anyone can read legal documents" ON public.legal_documents;
CREATE POLICY "Signed-in users can read legal documents"
  ON public.legal_documents FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Anyone can read legal document chunks" ON public.legal_document_chunks;
CREATE POLICY "Signed-in users can read legal document chunks"
  ON public.legal_document_chunks FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.verified_sources FROM anon;
REVOKE ALL ON public.legal_documents FROM anon;
REVOKE ALL ON public.legal_document_chunks FROM anon;

-- email-assets is a public bucket: files are served by public URL without a
-- listing policy, so drop the rule that let any caller list every object.
DROP POLICY IF EXISTS "Email assets are publicly readable" ON storage.objects;