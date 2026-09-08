DROP FUNCTION IF EXISTS public.reap_stale_research_jobs(interval);
REVOKE ALL ON FUNCTION public.reap_stale_research_jobs(interval, interval) FROM public, anon, authenticated;