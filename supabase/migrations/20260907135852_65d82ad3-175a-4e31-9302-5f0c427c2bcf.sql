CREATE TABLE public.v2_eval_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id TEXT NOT NULL,
  label TEXT,
  question TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  result JSONB,
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  finished_at TIMESTAMP WITH TIME ZONE
);
GRANT ALL ON public.v2_eval_runs TO service_role;
ALTER TABLE public.v2_eval_runs ENABLE ROW LEVEL SECURITY;