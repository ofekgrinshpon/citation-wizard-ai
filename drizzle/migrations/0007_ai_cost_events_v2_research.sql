ALTER TABLE public.ai_cost_events DROP CONSTRAINT ai_cost_events_function_name_check;
ALTER TABLE public.ai_cost_events ADD CONSTRAINT ai_cost_events_function_name_check
  CHECK (function_name IN ('citation-chat','classify-source','verify-source','citation-refill','cost-telemetry-event','legal-research-v2'));
ALTER TABLE public.ai_cost_events DROP CONSTRAINT ai_cost_events_feature_check;
ALTER TABLE public.ai_cost_events ADD CONSTRAINT ai_cost_events_feature_check
  CHECK (feature IN ('uniform_citation','footnotes','bibliography','refill','legal_research','unknown'));
ALTER TABLE public.ai_cost_events DROP CONSTRAINT ai_cost_events_endpoint_check;
ALTER TABLE public.ai_cost_events ADD CONSTRAINT ai_cost_events_endpoint_check
  CHECK (endpoint IN ('chat_completions','responses','search','none'));
ALTER TABLE public.ai_cost_events DROP CONSTRAINT ai_cost_events_outcome_check;
ALTER TABLE public.ai_cost_events ADD CONSTRAINT ai_cost_events_outcome_check
  CHECK (outcome IN ('ok','http_error','network_error','parse_error','capture_incomplete','stream_error','aborted','incomplete'));
ALTER TABLE public.ai_cost_events DROP CONSTRAINT ai_cost_events_capture_status_check;
ALTER TABLE public.ai_cost_events ADD CONSTRAINT ai_cost_events_capture_status_check
  CHECK (capture_status IN ('complete','body_byte_cap','body_time_cap','parse_error','read_error','error_body_unread','stream_unread','flush_deadline','not_applicable','aborted'));
REVOKE ALL ON public.ai_cost_events FROM anon, authenticated;
GRANT ALL ON public.ai_cost_events TO service_role;