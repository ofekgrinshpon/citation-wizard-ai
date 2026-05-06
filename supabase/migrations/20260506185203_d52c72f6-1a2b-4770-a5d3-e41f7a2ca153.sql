DELETE FROM public.legal_document_chunks WHERE document_id IN (
  SELECT id FROM public.legal_documents WHERE source_type = 'supreme_court_il'
);

DELETE FROM public.legal_documents WHERE source_type = 'supreme_court_il';