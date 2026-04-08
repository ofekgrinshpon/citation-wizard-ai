
CREATE TABLE public.qa_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  question text NOT NULL,
  local_footnotes_count integer NOT NULL DEFAULT 0,
  perplexity_footnotes_count integer NOT NULL DEFAULT 0,
  total_footnotes integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.qa_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read all qa_logs"
  ON public.qa_logs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
