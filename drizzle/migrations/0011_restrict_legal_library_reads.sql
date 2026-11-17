DROP POLICY IF EXISTS "Signed-in users can read legal documents" ON public.legal_documents;
DROP POLICY IF EXISTS "Signed-in users can read legal document chunks" ON public.legal_document_chunks;

DROP POLICY IF EXISTS "Signed-in users can read verified sources" ON public.verified_sources;
CREATE POLICY "Signed-in users can read approved verified sources"
ON public.verified_sources
FOR SELECT
TO authenticated
USING (verification_status = 'verified');