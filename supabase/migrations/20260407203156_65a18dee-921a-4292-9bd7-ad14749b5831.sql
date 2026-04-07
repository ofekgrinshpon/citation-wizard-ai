
-- Enable pgvector in extensions schema
CREATE EXTENSION IF NOT EXISTS vector SCHEMA extensions;

-- Create legal_documents table
CREATE TABLE public.legal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  citation text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  embedding extensions.vector(768),
  source_url text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create legal_document_chunks table
CREATE TABLE public.legal_document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.legal_documents(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  embedding extensions.vector(768),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX legal_documents_source_type_idx ON public.legal_documents (source_type);
CREATE INDEX legal_document_chunks_document_id_idx ON public.legal_document_chunks (document_id);

-- Enable RLS
ALTER TABLE public.legal_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_document_chunks ENABLE ROW LEVEL SECURITY;

-- RLS policies for legal_documents
CREATE POLICY "Anyone can read legal documents"
  ON public.legal_documents FOR SELECT USING (true);

CREATE POLICY "Admins can manage legal documents"
  ON public.legal_documents FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));

-- RLS policies for legal_document_chunks
CREATE POLICY "Anyone can read legal document chunks"
  ON public.legal_document_chunks FOR SELECT USING (true);

CREATE POLICY "Admins can manage legal document chunks"
  ON public.legal_document_chunks FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));

-- Similarity search function using plpgsql to handle schema resolution
CREATE OR REPLACE FUNCTION public.match_legal_chunks(
  query_embedding extensions.vector,
  match_threshold float DEFAULT 0.75,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  chunk_id uuid,
  document_id uuid,
  chunk_content text,
  document_title text,
  document_citation text,
  source_type text,
  source_url text,
  metadata jsonb,
  similarity float
)
LANGUAGE plpgsql STABLE
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id AS chunk_id,
    d.id AS document_id,
    c.content AS chunk_content,
    d.title AS document_title,
    d.citation AS document_citation,
    d.source_type,
    d.source_url,
    d.metadata,
    (1 - (c.embedding <=> query_embedding))::float AS similarity
  FROM public.legal_document_chunks c
  JOIN public.legal_documents d ON d.id = c.document_id
  WHERE (1 - (c.embedding <=> query_embedding)) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.update_legal_documents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_legal_documents_updated_at
  BEFORE UPDATE ON public.legal_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_legal_documents_updated_at();
