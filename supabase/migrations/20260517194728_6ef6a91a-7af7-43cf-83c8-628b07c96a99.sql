UPDATE public.qa_logs
SET metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object(
  'checkpoint','drafting_failed',
  'drafter_failure', jsonb_build_object(
    'reason','gateway_timeout',
    'phase','post_claim_map_pre_drafter',
    'last_successful_stage','claim_map',
    'note','Deep mode wall-time exceeded 150s edge gateway cap; pass_d_compact not reached; drafter never invoked.'
  )
)
WHERE id IN ('70f27152-0236-46a0-a6d1-bfcdd17b5d5b','8c365453-d440-4268-bde2-40a928c57e0d');