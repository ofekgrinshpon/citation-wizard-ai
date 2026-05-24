
CREATE TABLE public.legal_research_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid NULL,
  question text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  result jsonb NULL,
  error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.legal_research_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own research jobs"
  ON public.legal_research_jobs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own research jobs"
  ON public.legal_research_jobs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can read all research jobs"
  ON public.legal_research_jobs FOR SELECT
  TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_legal_research_jobs_user_created
  ON public.legal_research_jobs (user_id, created_at DESC);

CREATE TRIGGER update_legal_research_jobs_updated_at
  BEFORE UPDATE ON public.legal_research_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
