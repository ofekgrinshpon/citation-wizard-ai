-- Referral source rewards. Dormant until explicit coordinated activation.
-- Existing registrations/credits are never backfilled or converted.
BEGIN;
DO $prerequisites$
DECLARE r record; actual text;
BEGIN
 FOR r IN SELECT * FROM (VALUES
 ('public.begin_citation_request(uuid,text,text,text,text,jsonb)','0e594103c00c0c0aca8d8d1d14d7c04d'),
 ('public.consume_local_citation_trial(text,text,uuid)','4741c3d2e077c9f7a2a9cf55423e7a72'),
 ('public.get_citation_trial_status()','fe04c657f157fe48e73c1c6bb0d45271'),
 ('public.grant_referral_bonus_if_eligible(uuid)','808f28301adc6341ade6d8f5e101ac0b')
 ) AS expected(signature,fingerprint) LOOP
  SELECT md5(replace(trim(prosrc), E'\r','')) INTO actual FROM pg_proc WHERE oid=to_regprocedure(r.signature);
  IF actual IS DISTINCT FROM r.fingerprint THEN RAISE EXCEPTION 'Referral prerequisite changed: %',r.signature; END IF;
 END LOOP;
END;
$prerequisites$;
CREATE TABLE public.citation_referral_config (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 enabled boolean NOT NULL DEFAULT false,
 activated_at timestamptz,
 CHECK(NOT enabled OR activated_at IS NOT NULL)
);
INSERT INTO public.citation_referral_config(singleton,enabled) VALUES(true,false);
CREATE TABLE public.citation_referral_awards (
 referee_id uuid PRIMARY KEY,
 referrer_id uuid NOT NULL,
 request_id text NOT NULL CHECK(length(request_id) BETWEEN 4 AND 200),
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{64}$'),
 route text NOT NULL CHECK(route IN ('local','provider')),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(referee_id<>referrer_id)
);
CREATE INDEX citation_referral_awards_referrer ON public.citation_referral_awards(referrer_id);
CREATE TABLE public.citation_source_grants (
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 referral_id uuid NOT NULL REFERENCES public.citation_referral_awards(referee_id) ON DELETE CASCADE,
 sources integer NOT NULL CHECK(sources=10),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,referral_id)
);
ALTER TABLE public.citation_referral_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.citation_referral_awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.citation_source_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.citation_referral_config,public.citation_referral_awards,public.citation_source_grants FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE ON public.citation_referral_config TO service_role;
GRANT SELECT ON public.citation_referral_awards,public.citation_source_grants TO service_role;

CREATE FUNCTION public._citation_source_bonus(_user_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT CASE WHEN COALESCE((SELECT enabled FROM public.citation_referral_config WHERE singleton),false)
 THEN COALESCE((SELECT sum(sources) FROM public.citation_source_grants WHERE user_id=_user_id),0)::integer ELSE 0 END;
$$;
REVOKE ALL ON FUNCTION public._citation_source_bonus(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._citation_source_bonus(uuid) TO service_role;

-- Only trusted edge validation may attest a complete result. A public local
-- debit or a generic succeeded state alone is NOT referral evidence.
CREATE FUNCTION public.confirm_citation_referral_success(_user_id uuid,_request_id text,_fingerprint text,_route text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p public.profiles; cfg public.citation_referral_config; new_award uuid;
BEGIN
 PERFORM public._require_usage_service();
 IF _user_id IS NULL OR _request_id IS NULL OR length(_request_id) NOT BETWEEN 4 AND 200
 OR _fingerprint IS NULL OR _fingerprint !~ '^[0-9a-f]{64}$' OR _route IS NULL OR _route NOT IN ('local','provider') THEN
  RETURN jsonb_build_object('ok',false,'error','INVALID_REQUEST');
 END IF;
 -- Keep activation stable through the award transaction.
 SELECT * INTO cfg FROM public.citation_referral_config WHERE singleton FOR SHARE;
 IF NOT cfg.enabled THEN RETURN jsonb_build_object('ok',true,'granted',false,'reason','disabled'); END IF;
 -- Owner non-key lock serializes awards and excludes concurrent consumption.
 -- Grant FKs take KEY SHARE on the other account, compatible with this lock;
 -- never use FOR UPDATE here or mutual referrals can deadlock.
 SELECT * INTO p FROM public.profiles WHERE id=_user_id FOR NO KEY UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','PROFILE_NOT_FOUND'); END IF;
 IF p.created_at < cfg.activated_at OR p.created_at IS NULL OR p.referral_bonus_granted
 OR p.referred_by_user_id IS NULL OR p.referred_by_user_id=p.id
 OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p.referred_by_user_id)
 OR EXISTS(SELECT 1 FROM public.credit_ledger WHERE user_id=p.id AND event_type='referral_bonus') THEN
  RETURN jsonb_build_object('ok',true,'granted',false,'reason','ineligible');
 END IF;
 IF _route='provider' THEN
  IF NOT EXISTS(SELECT 1 FROM public.citation_usage_requests WHERE user_id=p.id AND request_id=_request_id
    AND fingerprint=_fingerprint AND state='succeeded' AND finished_at>=cfg.activated_at) THEN
   RETURN jsonb_build_object('ok',false,'error','SUCCESS_NOT_CONFIRMED');
  END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM public.citation_trial_sources WHERE user_id=p.id AND request_id=_request_id
    AND (fingerprint<>_fingerprint OR route<>'local' OR state<>'succeeded')) THEN
   RETURN jsonb_build_object('ok',false,'error','REQUEST_FINGERPRINT_MISMATCH');
  END IF;
  IF public._citation_trial_limited(p) AND NOT EXISTS(SELECT 1 FROM public.citation_trial_sources
    WHERE user_id=p.id AND request_id=_request_id AND fingerprint=_fingerprint AND route='local'
      AND state='succeeded' AND created_at>=cfg.activated_at) THEN
   RETURN jsonb_build_object('ok',false,'error','LOCAL_DEBIT_NOT_CONFIRMED');
  END IF;
  IF EXISTS(SELECT 1 FROM public.citation_usage_requests WHERE user_id=p.id AND request_id=_request_id)
   OR EXISTS(SELECT 1 FROM public.credit_ledger WHERE user_id=p.id AND request_id=_request_id)
   OR EXISTS(SELECT 1 FROM public.usage_terminal_failures WHERE user_id=p.id AND request_id=_request_id) THEN
   RETURN jsonb_build_object('ok',false,'error','REQUEST_ID_ALREADY_USED');
  END IF;
 END IF;
 INSERT INTO public.citation_referral_awards(referee_id,referrer_id,request_id,fingerprint,route)
 VALUES(p.id,p.referred_by_user_id,_request_id,_fingerprint,_route)
 ON CONFLICT(referee_id) DO NOTHING RETURNING referee_id INTO new_award;
 IF new_award IS NULL THEN RETURN jsonb_build_object('ok',true,'granted',false,'replayed',true); END IF;
 INSERT INTO public.citation_source_grants(user_id,referral_id,sources)
 VALUES(p.id,p.id,10),(p.referred_by_user_id,p.id,10);
 -- Deliberately preserve all legacy credit balances and paid plan fields.
 UPDATE public.profiles SET referral_bonus_granted=true,referral_first_action_at=now() WHERE id=p.id;
 RETURN jsonb_build_object('ok',true,'granted',true,'sources_each',10);
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_citation_referral_success(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_citation_referral_success(uuid,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.grant_referral_bonus_if_eligible(_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  referee public.profiles;
  referrer public.profiles;
  bonus int := 10;
  ref_req_referee text;
  ref_req_referrer text;
BEGIN
  -- Source-mode replaces legacy referral rewards; dormant rollout/rollback
  -- retains the original logic and recognizes the shared awarded marker.
  IF COALESCE((SELECT enabled FROM public.citation_referral_config WHERE singleton),false)
     OR EXISTS(SELECT 1 FROM public.citation_referral_awards WHERE referee_id=_user_id) THEN
    RETURN jsonb_build_object('ok',true,'noop',true);
  END IF;
  SELECT * INTO referee FROM public.profiles WHERE id = _user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  END IF;
  IF referee.referral_bonus_granted OR referee.referred_by_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'noop', true);
  END IF;

  SELECT * INTO referrer FROM public.profiles WHERE id = referee.referred_by_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'noop', true);
  END IF;

  ref_req_referee := 'referral:' || _user_id::text || ':referee';
  ref_req_referrer := 'referral:' || _user_id::text || ':referrer';

  -- Mark first
  UPDATE public.profiles
     SET referral_bonus_granted = true,
         referral_first_action_at = now(),
         topup_credits_remaining = topup_credits_remaining + bonus
   WHERE id = referee.id
   RETURNING * INTO referee;

  INSERT INTO public.credit_ledger
    (user_id, request_id, event_type, amount, included_delta, topup_delta,
     balance_after_included, balance_after_topup, reason, metadata)
  VALUES
    (referee.id, ref_req_referee, 'referral_bonus', bonus, 0, bonus,
     referee.included_credits_remaining, referee.topup_credits_remaining,
     'bonus for joining via referral',
     jsonb_build_object('referrer_id', referrer.id))
  ON CONFLICT (user_id, request_id, event_type) DO NOTHING;

  UPDATE public.profiles
     SET topup_credits_remaining = topup_credits_remaining + bonus
   WHERE id = referrer.id
   RETURNING * INTO referrer;

  INSERT INTO public.credit_ledger
    (user_id, request_id, event_type, amount, included_delta, topup_delta,
     balance_after_included, balance_after_topup, reason, metadata)
  VALUES
    (referrer.id, ref_req_referrer, 'referral_bonus', bonus, 0, bonus,
     referrer.included_credits_remaining, referrer.topup_credits_remaining,
     'bonus for referring a new user',
     jsonb_build_object('referee_id', referee.id))
  ON CONFLICT (user_id, request_id, event_type) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'granted', true);
END;
$function$;


CREATE OR REPLACE FUNCTION public.get_citation_trial_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE p public.profiles; n integer; bonus integer;
BEGIN
 IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'error','NOT_AUTHENTICATED'); END IF;
 SELECT * INTO p FROM public.profiles WHERE id=auth.uid();
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','PROFILE_NOT_FOUND'); END IF;
 SELECT count(*)::integer INTO n FROM public.citation_trial_sources WHERE user_id=p.id AND state <> 'failed';
 bonus := public._citation_source_bonus(p.id);
 RETURN jsonb_build_object('ok',true,'enabled',COALESCE((SELECT enabled FROM public.citation_trial_config WHERE singleton),false),'limited',public._citation_trial_limited(p),'limit',5+bonus,'used',n,'remaining',greatest(0,5+bonus-n),'bonus_sources',bonus,'referral_sources_enabled',(SELECT enabled FROM public.citation_referral_config WHERE singleton),'referrals_granted',(SELECT count(*) FROM public.citation_referral_awards WHERE referrer_id=p.id),'referral_pending',COALESCE((SELECT enabled AND p.created_at>=activated_at AND NOT COALESCE(p.referral_bonus_granted,false) AND p.referred_by_user_id IS NOT NULL AND p.referred_by_user_id<>p.id FROM public.citation_referral_config WHERE singleton),false) AND EXISTS(SELECT 1 FROM public.profiles WHERE id=p.referred_by_user_id) AND NOT EXISTS(SELECT 1 FROM public.citation_referral_awards WHERE referee_id=p.id) AND NOT EXISTS(SELECT 1 FROM public.credit_ledger WHERE user_id=p.id AND event_type='referral_bonus'));
END;
$function$;


CREATE OR REPLACE FUNCTION public.consume_local_citation_trial(_request_id text, _fingerprint text, _expected_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE p public.profiles; prior public.citation_trial_sources; n integer; allowance integer;
BEGIN
 IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'error','NOT_AUTHENTICATED'); END IF;
 IF _expected_user IS DISTINCT FROM auth.uid() THEN RETURN jsonb_build_object('ok',false,'error','CITATION_RETRY_STALE'); END IF;
 IF _request_id IS NULL OR length(_request_id) NOT BETWEEN 4 AND 200 OR _fingerprint IS NULL OR _fingerprint !~ '^[0-9a-f]{64}$' THEN
 RETURN jsonb_build_object('ok',false,'error','INVALID_REQUEST'); END IF;
 SELECT * INTO p FROM public.profiles WHERE id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','PROFILE_NOT_FOUND'); END IF;
 allowance := 5 + public._citation_source_bonus(p.id);
 SELECT count(*)::integer INTO n FROM public.citation_trial_sources WHERE user_id=p.id AND state <> 'failed';
 SELECT * INTO prior FROM public.citation_trial_sources WHERE user_id=p.id AND request_id=_request_id;
 IF FOUND THEN
   IF prior.route <> 'local' OR prior.fingerprint <> _fingerprint THEN RETURN jsonb_build_object('ok',false,'error','REQUEST_FINGERPRINT_MISMATCH'); END IF;
   RETURN jsonb_build_object('ok',true,'limited',public._citation_trial_limited(p),'replayed',true,'remaining',greatest(0,allowance-n),'limit',allowance);
 END IF;
 IF EXISTS(SELECT 1 FROM public.citation_usage_requests WHERE user_id=p.id AND request_id=_request_id)
 OR EXISTS(SELECT 1 FROM public.credit_ledger WHERE user_id=p.id AND request_id=_request_id)
 OR EXISTS(SELECT 1 FROM public.usage_terminal_failures WHERE user_id=p.id AND request_id=_request_id) THEN
 RETURN jsonb_build_object('ok',false,'error','REQUEST_ID_ALREADY_USED'); END IF;
 IF NOT public._citation_trial_limited(p) THEN RETURN jsonb_build_object('ok',true,'limited',false); END IF;
 IF n >= allowance THEN RETURN jsonb_build_object('ok',false,'limited',true,'error','TRIAL_EXHAUSTED','remaining',0); END IF;
 INSERT INTO public.citation_trial_sources(user_id,request_id,fingerprint,route,state) VALUES(p.id,_request_id,_fingerprint,'local','succeeded');
 RETURN jsonb_build_object('ok',true,'limited',true,'replayed',false,'remaining',allowance-1-n,'limit',allowance);
END;
$function$;


CREATE OR REPLACE FUNCTION public.begin_citation_request(_user_id uuid, _request_id text, _fingerprint text, _batch_id text DEFAULT NULL::text, _retry_of_request_id text DEFAULT NULL::text, _recovery_input jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  prof public.profiles;
  prior public.citation_usage_requests;
  parent_request public.citation_usage_requests;
  parent_receipt jsonb;
  receipt jsonb;
  anchor public.citation_usage_requests;
  token uuid := gen_random_uuid();
  amount integer := 1;
  use_included integer := 0;
  use_topup integer := 0;
  use_legacy integer := 0;
  is_admin boolean;
  paid boolean;
  expired boolean;
  now_ts timestamptz := now();
  win_start timestamptz;
  win_used integer;
  win_avail integer;
  period_avail integer;
  block text;
  trial_used integer; trial_limit integer;
BEGIN
  PERFORM public._require_usage_service();
  IF _user_id IS NULL OR _request_id IS NULL OR length(_request_id) NOT BETWEEN 4 AND 200 THEN
    RETURN jsonb_build_object('ok', false, 'execute', false, 'error', 'INVALID_REQUEST_ID');
  END IF;
  IF _fingerprint IS NULL OR _fingerprint !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'execute', false, 'error', 'INVALID_FINGERPRINT');
  END IF;
  IF _batch_id IS NOT NULL AND length(_batch_id) NOT BETWEEN 4 AND 200 THEN
    RETURN jsonb_build_object('ok', false, 'execute', false, 'error', 'INVALID_BATCH');
  END IF;

  IF _retry_of_request_id IS NOT NULL AND (
       length(_retry_of_request_id) NOT BETWEEN 4 AND 200 OR _retry_of_request_id = _request_id
     ) THEN
    RETURN jsonb_build_object('ok', false, 'execute', false, 'error', 'INVALID_RETRY_REQUEST');
  END IF;

  IF NOT public._citation_recovery_valid(_recovery_input, 'input')
     OR (_recovery_input->>'batchId') IS DISTINCT FROM _batch_id
     OR public._citation_execution_fingerprint(_recovery_input) IS DISTINCT FROM _fingerprint THEN
    RETURN jsonb_build_object('ok', false, 'execute', false, 'error', 'INVALID_RECOVERY_INPUT');
  END IF;

  -- Global lock order for every RPC in this draft: profile, then request.
  -- This serializes claim+consume, different requests, batch slots and refunds.
  SELECT * INTO prof FROM public.profiles WHERE id = _user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'execute', false, 'error', 'PROFILE_NOT_FOUND');
  END IF;
  -- Validate lineage BEFORE either an existing requested-ID replay or canonical
  -- child lookup. Existing identities cannot bypass parent/ancestry validation.
  IF _retry_of_request_id IS NOT NULL THEN
    SELECT * INTO parent_request FROM public.citation_usage_requests
      WHERE user_id = _user_id AND request_id = _retry_of_request_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'execute', false, 'error', 'RETRY_PARENT_NOT_FOUND');
    END IF;
    IF parent_request.state <> 'failed' THEN
      RETURN jsonb_build_object('ok', false, 'execute', false, 'error', 'RETRY_PARENT_NOT_FAILED');
    END IF;
    IF parent_request.fingerprint <> _fingerprint OR parent_request.batch_id IS DISTINCT FROM _batch_id THEN
      RETURN jsonb_build_object('ok', false, 'execute', false, 'error', 'RETRY_FINGERPRINT_MISMATCH');
    END IF;
    parent_receipt := public._citation_refund_receipt(_user_id, _retry_of_request_id);
  END IF;

  SELECT * INTO prior FROM public.citation_usage_requests
    WHERE user_id = _user_id AND request_id = _request_id FOR UPDATE;
  IF FOUND THEN
    IF prior.retry_of_request_id IS DISTINCT FROM _retry_of_request_id THEN
      RETURN jsonb_build_object('ok', false, 'execute', false, 'error', 'REQUEST_ANCESTRY_MISMATCH');
    END IF;
    IF prior.fingerprint <> _fingerprint OR prior.batch_id IS DISTINCT FROM _batch_id THEN
      RETURN jsonb_build_object('ok', false, 'execute', false, 'error', 'REQUEST_FINGERPRINT_MISMATCH');
    END IF;
    -- No lease, age-based restart, new token, or second provider execution.
    receipt := public._citation_refund_receipt(_user_id, prior.request_id);
    RETURN jsonb_build_object('ok', true, 'execute', false, 'replayed', true,
      'status', prior.state, 'request_id', prior.request_id,
      'retry_of_request_id', prior.retry_of_request_id,
      'refunded', (receipt->>'refunded')::boolean, 'refund_receipt', receipt,
      'retry_parent_refund_receipt', parent_receipt);
  END IF;

  IF _retry_of_request_id IS NOT NULL THEN
    SELECT * INTO prior FROM public.citation_usage_requests
      WHERE user_id = _user_id AND retry_of_request_id = _retry_of_request_id FOR UPDATE;
    IF FOUND THEN
      -- Two tabs can propose different child IDs, but only one child is canonical.
      -- A stale parent click returns that exact child even if it is now failed;
      -- it never walks the chain or authorizes a grandchild.
      IF prior.fingerprint <> _fingerprint OR prior.batch_id IS DISTINCT FROM _batch_id THEN
        RETURN jsonb_build_object('ok', false, 'execute', false, 'error', 'REQUEST_FINGERPRINT_MISMATCH');
      END IF;
      receipt := public._citation_refund_receipt(_user_id, prior.request_id);
      RETURN jsonb_build_object('ok', true, 'execute', false, 'replayed', true,
        'status', prior.state, 'request_id', prior.request_id,
        'retry_of_request_id', prior.retry_of_request_id,
        'refunded', (receipt->>'refunded')::boolean, 'refund_receipt', receipt,
        'retry_parent_refund_receipt', parent_receipt);
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.credit_ledger WHERE user_id = _user_id AND request_id = _request_id)
     OR EXISTS (SELECT 1 FROM public.usage_terminal_failures WHERE user_id = _user_id AND request_id = _request_id) THEN
    -- Never interpret an old consume/replay as permission to execute providers.
    RETURN jsonb_build_object('ok', false, 'execute', false, 'error', 'REQUEST_ID_ALREADY_USED');
  END IF;

  -- All prior-request/retry/recovery validation above is unchanged. A local
  -- debit cannot be reused as a provider claim, even with an identical hash.
  IF EXISTS(SELECT 1 FROM public.citation_trial_sources WHERE user_id=_user_id AND request_id=_request_id) THEN
    RETURN jsonb_build_object('ok',false,'execute',false,'error','REQUEST_ID_ALREADY_USED');
  END IF;
  IF public._citation_trial_limited(prof) THEN
    trial_limit := 5 + public._citation_source_bonus(_user_id);
    SELECT count(*)::integer INTO trial_used FROM public.citation_trial_sources WHERE user_id=_user_id AND state <> 'failed';
    IF trial_used >= trial_limit THEN
      RETURN jsonb_build_object('ok',false,'execute',false,'error','INSUFFICIENT_CREDITS','block_reason','trial_exhausted','required',1,'trial_remaining',0);
    END IF;
    INSERT INTO public.citation_usage_requests
      (user_id,request_id,fingerprint,batch_id,retry_of_request_id,batch_anchor_request_id,charged_units,state,attempt_token)
    VALUES(_user_id,_request_id,_fingerprint,_batch_id,_retry_of_request_id,NULL,1,'in_progress',token);
    INSERT INTO public.citation_recovery_payloads(user_id,request_id,input,expires_at)
    VALUES(_user_id,_request_id,_recovery_input,now()+interval '24 hours');
    INSERT INTO public.citation_trial_sources(user_id,request_id,fingerprint,route,state)
    VALUES(_user_id,_request_id,_fingerprint,'provider','in_progress');
    RETURN jsonb_build_object('ok',true,'execute',true,'status','in_progress','request_id',_request_id,
      'attempt_token',token,'charged',1,'admin',false,'trial',true,'trial_remaining',trial_limit-1-trial_used,
      'retry_of_request_id',_retry_of_request_id,'retry_parent_refund_receipt',parent_receipt);
  END IF;

  is_admin := (prof.plan = 'admin') OR private.has_role(_user_id, 'admin'::public.app_role);
  paid := public._plan_is_paid(prof.plan);
  expired := paid AND prof.billing_period_ends_at IS NOT NULL AND prof.billing_period_ends_at <= now_ts;
  win_start := prof.window_started_at;
  win_used := COALESCE(prof.window_units_used, 0);
  IF win_start IS NULL OR now_ts >= win_start + interval '5 hours' THEN
    win_start := now_ts;
    win_used := 0;
  END IF;
  win_avail := GREATEST(0, public._plan_window_limit(prof.plan) - win_used);
  period_avail := GREATEST(0, prof.included_credits_remaining);

  -- Batch size is server-owned. A failed/refunded anchor cannot fund new work.
  -- Old owner-created ledger metadata is deliberately not trusted for free slots.
  IF _batch_id IS NOT NULL THEN
    SELECT a.* INTO anchor FROM public.citation_usage_requests a
     WHERE a.user_id = _user_id AND a.batch_id = _batch_id
       AND a.charged_units = 1 AND a.batch_anchor_request_id = a.request_id
       AND a.state <> 'failed'
       AND (is_admin OR EXISTS (SELECT 1 FROM public.credit_ledger paid_anchor
         WHERE paid_anchor.user_id = a.user_id AND paid_anchor.request_id = a.request_id
           AND paid_anchor.event_type = 'consume' AND paid_anchor.amount < 0))
       AND NOT EXISTS (SELECT 1 FROM public.credit_ledger l
         WHERE l.user_id = a.user_id AND l.request_id = a.request_id AND l.event_type = 'refund')
       AND (SELECT count(*) FROM public.citation_usage_requests member
         WHERE member.user_id = a.user_id AND member.batch_anchor_request_id = a.request_id) < 5
     ORDER BY a.created_at DESC, a.request_id DESC LIMIT 1;
    IF FOUND THEN amount := 0; END IF;
  END IF;

  -- Expiry applies to zero-charge followers too. Valid prepaid batch slots do not
  -- consume an additional unit or require another unit of remaining allowance.
  IF NOT is_admin AND expired THEN
    block := 'plan_expired';
  ELSIF is_admin OR amount = 0 THEN
    NULL;
  ELSIF win_avail >= amount AND period_avail >= amount THEN
    use_included := amount;
  ELSIF paid AND (GREATEST(0, prof.topup_credits_remaining) + GREATEST(0, prof.legacy_bonus_remaining)) >= amount THEN
    use_topup := LEAST(GREATEST(0, prof.topup_credits_remaining), amount);
    use_legacy := amount - use_topup;
  ELSE
    block := CASE WHEN prof.plan = 'trial' AND period_avail < amount THEN 'trial_exhausted'
                  WHEN period_avail < amount THEN 'plan_allowance' ELSE 'short_window' END;
  END IF;
  IF block IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'execute', false, 'error', 'INSUFFICIENT_CREDITS',
      'block_reason', block, 'required', amount, 'window_reset_at', win_start + interval '5 hours',
      'plan_ends_at', prof.billing_period_ends_at, 'can_use_topup', false,
      'can_purchase_topup', paid AND NOT expired,
      'remaining_included', prof.included_credits_remaining, 'remaining_topup', prof.topup_credits_remaining);
  END IF;

  INSERT INTO public.citation_usage_requests
    (user_id, request_id, fingerprint, batch_id, retry_of_request_id, batch_anchor_request_id, charged_units, state, attempt_token)
  VALUES (_user_id, _request_id, _fingerprint, _batch_id, _retry_of_request_id,
    CASE WHEN _batch_id IS NULL THEN NULL WHEN amount = 1 THEN _request_id ELSE anchor.request_id END,
    amount, 'in_progress', token);
  INSERT INTO public.citation_recovery_payloads(user_id, request_id, input, expires_at)
    SELECT user_id, request_id, _recovery_input, created_at + interval '24 hours'
      FROM public.citation_usage_requests WHERE user_id = _user_id AND request_id = _request_id;
  -- No exception swallowing: a payload insert failure rolls back claim + debit.


  UPDATE public.profiles SET
    included_credits_remaining = included_credits_remaining - use_included,
    topup_credits_remaining = topup_credits_remaining - use_topup,
    legacy_bonus_remaining = legacy_bonus_remaining - use_legacy,
    window_started_at = win_start,
    window_units_used = win_used + use_included
  WHERE id = _user_id RETURNING * INTO prof;

  INSERT INTO public.credit_ledger
    (user_id, request_id, event_type, amount, included_delta, topup_delta, legacy_delta,
     balance_after_included, balance_after_topup, reason, metadata)
  VALUES (_user_id, _request_id, 'consume', -(use_included + use_topup + use_legacy),
    -use_included, -use_topup, -use_legacy,
    prof.included_credits_remaining, prof.topup_credits_remaining, 'citation-chat',
    jsonb_build_object('operation_type', 'citation-chat', 'plan', prof.plan,
      'bucket', CASE WHEN use_included > 0 THEN 'included' WHEN use_topup > 0 THEN 'topup'
                    WHEN use_legacy > 0 THEN 'legacy_bonus' ELSE 'none' END,
      'batch_id', _batch_id, 'group_size', CASE WHEN _batch_id IS NULL THEN NULL ELSE 5 END,
      'batch_anchor_request_id', CASE WHEN _batch_id IS NULL THEN NULL WHEN amount = 1 THEN _request_id ELSE anchor.request_id END,
      'window_started_at', win_start, 'window_units_used_after', prof.window_units_used,
      'billing_period_started_at', prof.billing_period_started_at));

  RETURN jsonb_build_object('ok', true, 'execute', true, 'status', 'in_progress',
    'request_id', _request_id, 'attempt_token', token, 'charged', amount, 'admin', is_admin,
    'retry_of_request_id', _retry_of_request_id, 'retry_parent_refund_receipt', parent_receipt,
    'remaining_included', prof.included_credits_remaining,
    'remaining_topup', prof.topup_credits_remaining, 'remaining_legacy', prof.legacy_bonus_remaining);
END;
$function$;


COMMIT;
