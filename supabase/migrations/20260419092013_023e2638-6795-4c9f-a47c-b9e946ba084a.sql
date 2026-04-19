CREATE INDEX IF NOT EXISTS idx_docs_meta_fts
  ON public.legal_documents
  USING gin (to_tsvector('simple',
    title || ' ' || citation || ' ' ||
    coalesce(case_number,'') || ' ' || coalesce(court,'')
  ));