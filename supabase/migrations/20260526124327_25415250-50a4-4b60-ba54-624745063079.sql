ALTER TABLE public.legal_research_jobs
  ADD COLUMN IF NOT EXISTS current_stage text,
  ADD COLUMN IF NOT EXISTS completed_stages text[] NOT NULL DEFAULT '{}';