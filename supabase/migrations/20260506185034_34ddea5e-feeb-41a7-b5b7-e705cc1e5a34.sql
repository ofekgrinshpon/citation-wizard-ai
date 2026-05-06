DELETE FROM public.legal_document_chunks WHERE document_id IN (
  SELECT id FROM public.legal_documents
  WHERE source_type = 'supreme_court_il'
    AND (title LIKE '%הכרך המלא%' OR title LIKE '%תוכן הענינים%' OR title LIKE '%עמודי פתיחה%' OR title IS NULL)
);

DELETE FROM public.legal_documents
WHERE source_type = 'supreme_court_il'
  AND (title LIKE '%הכרך המלא%' OR title LIKE '%תוכן הענינים%' OR title LIKE '%עמודי פתיחה%' OR title IS NULL);