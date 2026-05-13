CREATE TABLE public.document_check_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  project_id uuid,
  file_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft',
  notes_count integer NOT NULL DEFAULT 0,
  citations_count integer NOT NULL DEFAULT 0,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  decisions jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.document_check_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own document check sessions"
  ON public.document_check_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own document check sessions"
  ON public.document_check_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own document check sessions"
  ON public.document_check_sessions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own document check sessions"
  ON public.document_check_sessions FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can read all document check sessions"
  ON public.document_check_sessions FOR SELECT
  TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_document_check_sessions_user_updated
  ON public.document_check_sessions (user_id, updated_at DESC);

CREATE TRIGGER update_document_check_sessions_updated_at
  BEFORE UPDATE ON public.document_check_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();