ALTER TABLE public.academic_sessions
  ADD COLUMN IF NOT EXISTS source_registry jsonb NOT NULL DEFAULT '[]'::jsonb;