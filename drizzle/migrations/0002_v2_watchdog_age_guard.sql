-- Never revive a long-abandoned run: a stale historical row must not be
-- resurrected by the watchdog. Mirrors RESUME_WATCHDOG.MAX_RUN_AGE_MS.
create or replace function public.v2_resume_watchdog_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pending integer;
  v_nonce uuid;
begin
  select count(*) into v_pending
  from public.v2_eval_runs
  where status in ('running', 'paused')
    and auto_resume_count < 4
    and created_at > now() - interval '45 minutes'
    and coalesce(last_beat_at, created_at) < now() - interval '3 minutes'
    and (watchdog_claimed_at is null or watchdog_claimed_at < now() - interval '3 minutes');

  if v_pending = 0 then
    return;
  end if;

  delete from public.v2_watchdog_ticks where created_at < now() - interval '1 hour';

  insert into public.v2_watchdog_ticks default values returning nonce into v_nonce;

  perform net.http_post(
    url := 'https://ioktiqcffungtlsmlkcv.supabase.co/functions/v1/legal-research-v2',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('action', 'resume_watchdog', 'watchdog_nonce', v_nonce),
    timeout_milliseconds := 20000
  );
end;
$$;

revoke all on function public.v2_resume_watchdog_tick() from public;
revoke all on function public.v2_resume_watchdog_tick() from anon;
revoke all on function public.v2_resume_watchdog_tick() from authenticated;