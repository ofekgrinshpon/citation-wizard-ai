CREATE TABLE public.ai_cost_events (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  function_name text NOT NULL CHECK (function_name IN ('citation-chat','classify-source','verify-source','citation-refill')),
  feature text NOT NULL CHECK (feature IN ('uniform_citation','footnotes','bibliography','refill','unknown')),
  telemetry_request_id uuid,
  telemetry_batch_id uuid,
  attempt_seq integer NOT NULL CHECK (attempt_seq BETWEEN 1 AND 1000),
  stage text NOT NULL CHECK (stage ~ '^[a-z0-9_]{1,40}$'),
  provider text NOT NULL CHECK (provider IN ('perplexity','lovable_gateway')),
  endpoint text NOT NULL CHECK (endpoint IN ('chat_completions','search')),
  model text CHECK (model IS NULL OR model ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$'),
  outcome text NOT NULL CHECK (outcome IN ('ok','http_error','network_error','parse_error')),
  http_status integer CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  latency_ms integer NOT NULL CHECK (latency_ms >= 0),
  provider_request_id text CHECK (provider_request_id IS NULL OR provider_request_id ~ '^[A-Za-z0-9_.:-]{1,100}$'),
  input_tokens bigint CHECK (input_tokens >= 0),
  output_tokens bigint CHECK (output_tokens >= 0),
  total_tokens bigint CHECK (total_tokens >= 0),
  cached_input_tokens bigint CHECK (cached_input_tokens >= 0),
  reasoning_tokens bigint CHECK (reasoning_tokens >= 0),
  citation_tokens bigint CHECK (citation_tokens >= 0),
  search_queries integer CHECK (search_queries >= 0),
  search_context_size text CHECK (search_context_size IN ('low','medium','high')),
  price_version text NOT NULL CHECK (char_length(price_version) <= 40),
  estimated_usd numeric(14,8) CHECK (estimated_usd >= 0),
  estimate_complete boolean NOT NULL DEFAULT false,
  provider_reported_usd numeric(14,8) CHECK (provider_reported_usd >= 0)
);
COMMENT ON TABLE public.ai_cost_events IS 'Per-provider-attempt cost telemetry. Scalars only; no user content or identity. USD only; app units live in credit_ledger.';
REVOKE ALL ON public.ai_cost_events FROM anon, authenticated;
GRANT ALL ON public.ai_cost_events TO service_role;
ALTER TABLE public.ai_cost_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX ai_cost_events_batch_idx ON public.ai_cost_events (telemetry_batch_id, created_at);
CREATE INDEX ai_cost_events_request_idx ON public.ai_cost_events (telemetry_request_id);