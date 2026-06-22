
-- 1. Realtime: drop unused verified_sources from publication (no app subscribers found)
ALTER PUBLICATION supabase_realtime DROP TABLE public.verified_sources;

-- 2. email_unsubscribe_tokens: scheduled cleanup of used/expired tokens
CREATE OR REPLACE FUNCTION public.cleanup_email_unsubscribe_tokens()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  WITH deleted AS (
    DELETE FROM public.email_unsubscribe_tokens
    WHERE used_at IS NOT NULL
       OR created_at < (now() - interval '30 days')
    RETURNING 1
  )
  SELECT count(*) INTO deleted_count FROM deleted;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_email_unsubscribe_tokens() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_email_unsubscribe_tokens() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('cleanup-email-unsubscribe-tokens')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-email-unsubscribe-tokens');
    PERFORM cron.schedule(
      'cleanup-email-unsubscribe-tokens',
      '17 3 * * *',
      $cron$ SELECT public.cleanup_email_unsubscribe_tokens(); $cron$
    );
  END IF;
END
$$;

-- 3. suppressed_emails: allow users to read their own suppression row
DROP POLICY IF EXISTS "Users can view their own suppression status" ON public.suppressed_emails;
CREATE POLICY "Users can view their own suppression status"
ON public.suppressed_emails
FOR SELECT
TO authenticated
USING (lower(email) = lower((auth.jwt() ->> 'email')));

GRANT SELECT ON public.suppressed_emails TO authenticated;
