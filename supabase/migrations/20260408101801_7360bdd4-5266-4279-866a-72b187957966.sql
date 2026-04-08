
ALTER TABLE public.legal_documents
  ADD COLUMN IF NOT EXISTS court text,
  ADD COLUMN IF NOT EXISTS decision_date text,
  ADD COLUMN IF NOT EXISTS case_number text,
  ADD COLUMN IF NOT EXISTS judges text,
  ADD COLUMN IF NOT EXISTS procedure_type text,
  ADD COLUMN IF NOT EXISTS district text,
  ADD COLUMN IF NOT EXISTS docx_url text,
  ADD COLUMN IF NOT EXISTS pdf_url text,
  ADD COLUMN IF NOT EXISTS scraped_at timestamptz,
  ADD COLUMN IF NOT EXISTS ingestion_status text NOT NULL DEFAULT 'complete',
  ADD COLUMN IF NOT EXISTS ingestion_error text;
