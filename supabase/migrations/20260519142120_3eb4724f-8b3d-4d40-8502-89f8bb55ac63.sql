ALTER TABLE public.academic_sessions
  ADD COLUMN IF NOT EXISTS current_run_id uuid,
  ADD COLUMN IF NOT EXISTS current_run_step text,
  ADD COLUMN IF NOT EXISTS current_run_chapter_idx integer;