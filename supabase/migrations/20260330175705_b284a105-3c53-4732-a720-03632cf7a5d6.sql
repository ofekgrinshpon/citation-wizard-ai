CREATE OR REPLACE FUNCTION public.increment_usage_count(source_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.verified_sources
  SET usage_count = usage_count + 1
  WHERE id = source_id;
$$;