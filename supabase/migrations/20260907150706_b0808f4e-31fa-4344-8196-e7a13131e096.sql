ALTER TABLE public.v2_eval_runs
  ADD COLUMN IF NOT EXISTS agent_state jsonb,
  ADD COLUMN IF NOT EXISTS chunk_index integer NOT NULL DEFAULT 0;