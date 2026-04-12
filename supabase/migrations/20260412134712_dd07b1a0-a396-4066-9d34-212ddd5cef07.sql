
-- Add new columns to qa_logs
ALTER TABLE public.qa_logs
  ADD COLUMN IF NOT EXISTS answer text,
  ADD COLUMN IF NOT EXISTS footnotes jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS task_mode text DEFAULT 'research',
  ADD COLUMN IF NOT EXISTS project_id uuid;

-- RLS: users can read their own qa_logs
CREATE POLICY "Users can read own qa_logs"
  ON public.qa_logs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS: users can insert their own qa_logs
CREATE POLICY "Users can insert own qa_logs"
  ON public.qa_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (
      project_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.projects
        WHERE projects.id = qa_logs.project_id
        AND projects.user_id = auth.uid()
      )
    )
  );
