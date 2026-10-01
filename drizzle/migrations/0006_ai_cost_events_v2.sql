ALTER TABLE public.ai_cost_events
  ADD COLUMN event_kind text NOT NULL DEFAULT 'provider_attempt' CHECK (event_kind IN ('provider_attempt','cache_hit','deterministic')),
  ADD COLUMN origin text NOT NULL DEFAULT 'server_observed' CHECK (origin IN ('server_observed','client_reported')),
  ADD COLUMN requested_model text CHECK (requested_model IS NULL OR requested_model ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$'),
  ADD COLUMN response_model text CHECK (response_model IS NULL OR response_model ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$'),
  ADD COLUMN header_latency_ms integer CHECK (header_latency_ms >= 0),
  ADD COLUMN completion_latency_ms integer CHECK (completion_latency_ms >= 0),
  ADD COLUMN latency_complete boolean NOT NULL DEFAULT false,
  ADD COLUMN capture_status text NOT NULL DEFAULT 'complete' CHECK (capture_status IN ('complete','body_byte_cap','body_time_cap','parse_error','read_error','error_body_unread','stream_unread','flush_deadline','not_applicable')),
  ADD COLUMN request_count integer CHECK (request_count >= 0);

ALTER TABLE public.ai_cost_events DROP CONSTRAINT ai_cost_events_function_name_check;
ALTER TABLE public.ai_cost_events ADD CONSTRAINT ai_cost_events_function_name_check
  CHECK (function_name IN ('citation-chat','classify-source','verify-source','citation-refill','cost-telemetry-event'));
ALTER TABLE public.ai_cost_events DROP CONSTRAINT ai_cost_events_provider_check;
ALTER TABLE public.ai_cost_events ADD CONSTRAINT ai_cost_events_provider_check
  CHECK (provider IN ('perplexity','lovable_gateway','none'));
ALTER TABLE public.ai_cost_events DROP CONSTRAINT ai_cost_events_endpoint_check;
ALTER TABLE public.ai_cost_events ADD CONSTRAINT ai_cost_events_endpoint_check
  CHECK (endpoint IN ('chat_completions','search','none'));
ALTER TABLE public.ai_cost_events DROP CONSTRAINT ai_cost_events_outcome_check;
ALTER TABLE public.ai_cost_events ADD CONSTRAINT ai_cost_events_outcome_check
  CHECK (outcome IN ('ok','http_error','network_error','parse_error','capture_incomplete'));
ALTER TABLE public.ai_cost_events ADD CONSTRAINT ai_cost_events_zero_work_check
  CHECK (event_kind = 'provider_attempt' OR (provider = 'none' AND endpoint = 'none' AND estimated_usd = 0 AND provider_reported_usd IS NULL));
ALTER TABLE public.ai_cost_events ADD CONSTRAINT ai_cost_events_client_origin_check
  CHECK (origin = 'server_observed' OR event_kind <> 'provider_attempt');

COMMENT ON COLUMN public.ai_cost_events.latency_ms IS 'Time to response headers (same as header_latency_ms). Full upstream duration is completion_latency_ms.';
COMMENT ON COLUMN public.ai_cost_events.model IS 'DEPRECATED: alias of requested_model.';

REVOKE ALL ON public.ai_cost_events FROM anon, authenticated;
GRANT ALL ON public.ai_cost_events TO service_role;