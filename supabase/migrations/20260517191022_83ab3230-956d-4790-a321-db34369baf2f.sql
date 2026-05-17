
UPDATE public.qa_logs
SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
  'checkpoint', 'drafting_failed',
  'checkpoint_at', now(),
  'drafting_path', 'drafting_failed',
  'drafter_failure', jsonb_build_object(
    'reason', 'gateway_timeout',
    'note', 'Edge gateway 150s cap hit before drafter completed (Deep + forced gpt-5 validation run on 2026-05-17). Manually checkpointed.',
    'last_stage', (
      SELECT (elem->>'stage')
      FROM jsonb_array_elements(COALESCE(metadata->'stage_runs', '[]'::jsonb)) AS elem
      ORDER BY (elem->>'completed_at') DESC NULLS LAST
      LIMIT 1
    ),
    'last_model', (
      SELECT (elem->>'model')
      FROM jsonb_array_elements(COALESCE(metadata->'stage_runs', '[]'::jsonb)) AS elem
      ORDER BY (elem->>'completed_at') DESC NULLS LAST
      LIMIT 1
    )
  )
)
WHERE id IN ('1112c6ee-1f4c-4bfc-9c3b-640b6f12eed7','54251423-0f1f-4646-9c47-02b29f8e3f16');
