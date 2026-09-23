-- lovable-cron-fallback-reviewed: unattended recovery of abandoned V2 run checkpoints requires detecting a dead worker (no row change occurs when a worker dies, so triggers/webhooks cannot fire); 1/min keeps user-visible recovery under ~4 minutes and the tick exits immediately when nothing is stalled.
-- ReLex V2 — unattended checkpoint recovery (automatic_resume_v1).
-- A chunked V2 run persists everything a new worker needs; the only observed
-- failure mode was a lost hand-off (valid checkpoint, no executor). These
-- columns add a liveness signal, an atomic claim and a hard bound. The sweep
-- decision itself lives in TypeScript (beta/resumePolicy.ts) and is tested.

alter table public.v2_eval_runs
  add column if not exists last_beat_at timestamptz,
  add column if not exists auto_resume_count integer not null default 0,
  add column if not exists auto_resume_reason text,
  add column if not exists watchdog_claimed_at timestamptz;

create index if not exists v2_eval_runs_watchdog_idx
  on public.v2_eval_runs (status, last_beat_at)
  where status in ('running', 'paused');

-- Single-use, short-lived tick tokens. The scheduler proves it is the
-- scheduler by presenting an unguessable nonce that only the database could
-- have created, so no credential is stored or transmitted.
create table if not exists public.v2_watchdog_ticks (
  nonce uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  used_at timestamptz
);

grant all on public.v2_watchdog_ticks to service_role;
alter table public.v2_watchdog_ticks enable row level security;
-- No policies: internal execution table, never reachable from the client.

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

select cron.unschedule('v2-resume-watchdog')
where exists (select 1 from cron.job where jobname = 'v2-resume-watchdog');

select cron.schedule(
  'v2-resume-watchdog',
  '* * * * *',
  $$select public.v2_resume_watchdog_tick();$$
);