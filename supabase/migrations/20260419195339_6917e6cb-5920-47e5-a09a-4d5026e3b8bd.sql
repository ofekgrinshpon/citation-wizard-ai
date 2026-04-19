-- Academic Wizard sessions: persist full wizard state to DB so users can
-- resume from any browser/device, not just the one that wrote localStorage.

-- Ensure timestamp helper exists
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE public.academic_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  wizard_step TEXT NOT NULL,
  max_reached_step TEXT NOT NULL,
  current_chapter INTEGER NOT NULL DEFAULT 0,
  chapters JSONB NOT NULL DEFAULT '[]'::jsonb,
  research_question TEXT NOT NULL DEFAULT '',
  outline TEXT NOT NULL DEFAULT '',
  proposed_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_academic_action TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- One active session per (user, project). NULL project_id = "no project" slot.
CREATE UNIQUE INDEX academic_sessions_user_project_unique
  ON public.academic_sessions (user_id, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX academic_sessions_user_id_idx ON public.academic_sessions(user_id);

ALTER TABLE public.academic_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own academic sessions"
  ON public.academic_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own academic sessions"
  ON public.academic_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own academic sessions"
  ON public.academic_sessions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own academic sessions"
  ON public.academic_sessions FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_academic_sessions_updated_at
  BEFORE UPDATE ON public.academic_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();