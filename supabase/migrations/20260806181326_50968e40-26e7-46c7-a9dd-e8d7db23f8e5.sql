CREATE OR REPLACE FUNCTION public.reap_stale_research_jobs(_max_age interval DEFAULT interval '12 minutes')
RETURNS TABLE(reaped_id uuid, prior_stage text, stale_seconds double precision)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.legal_research_jobs j
     SET status = 'failed',
         error = 'stale_worker_timeout',
         updated_at = now()
   WHERE j.status IN ('running', 'queued')
     AND j.updated_at < now() - _max_age
     AND j.created_at < now() - _max_age
  RETURNING j.id,
            j.current_stage,
            EXTRACT(EPOCH FROM (now() - j.created_at))::double precision;
$$;

REVOKE ALL ON FUNCTION public.reap_stale_research_jobs(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_stale_research_jobs(interval) TO service_role;

SELECT cron.schedule(
  'reap-stale-research-jobs',
  '* * * * *',
  $cron$ SELECT public.reap_stale_research_jobs(); $cron$
);