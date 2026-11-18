-- Additive five-source lifetime trial. Requires the guarded citation usage/recovery
-- schema and signatures from 20261013100000 and later recovery validators.
-- No production execution authorized by this file. Review deployed definitions
-- before applying: begin preserves the observed deployed legacy paid logic;
-- finish/refund bodies matched the guarded checked-in baseline at observation.
BEGIN;

-- Fail the entire transaction before creating anything if another release has
-- changed one of the function bodies being replaced. SQL trim removes spaces,
-- not newlines; this matches the read-only observed fingerprint calculation.
DO $prerequisites$
DECLARE required record; actual text;
BEGIN
 FOR required IN SELECT * FROM (VALUES
  ('public.begin_citation_request(uuid,text,text,text,text,jsonb)', '3509df563026d9ca419c5a47642e7ecd'),
  ('public.finish_citation_request(uuid,text,uuid,text,text,jsonb)', '36b2b460653c41854668a782aa53b5ff'),
  ('public._citation_refund_receipt(uuid,text)', '9ca4bc9c68f557702a8112d540d35407')
 ) AS expected(signature, fingerprint)
 LOOP
  SELECT md5(replace(trim(p.prosrc), E'\r', '')) INTO actual
    FROM pg_catalog.pg_proc p WHERE p.oid=to_regprocedure(required.signature);
  IF actual IS DISTINCT FROM required.fingerprint THEN
   RAISE EXCEPTION 'Citation trial prerequisite changed: %; inspect and rebase before applying', required.signature;
  END IF;
 END LOOP;
END;
$prerequisites$;

CREATE TABLE public.citation_trial_config (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 enabled boolean NOT NULL DEFAULT false
);
INSERT INTO public.citation_trial_config(singleton,enabled) VALUES(true,false);
ALTER TABLE public.citation_trial_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.citation_trial_config FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON public.citation_trial_config TO service_role;
CREATE TABLE public.citation_trial_sources (
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 request_id text NOT NULL CHECK(length(request_id) BETWEEN 4 AND 200),
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{64}$'),
 route text NOT NULL CHECK(route IN ('local','provider')),
 state text NOT NULL CHECK(state IN ('in_progress','succeeded','failed','unknown')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,request_id),
 CHECK(route <> 'local' OR state = 'succeeded')
);
ALTER TABLE public.citation_trial_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.citation_trial_sources FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.citation_trial_sources TO service_role;

-- A paid profile remains on its existing accounting path, including depleted
-- paid accounts. An expired paid profile returns to its unchanged trial remainder.
CREATE FUNCTION public._citation_trial_limited(_prof public.profiles)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT COALESCE((SELECT enabled FROM public.citation_trial_config WHERE singleton),false)
   AND NOT (COALESCE((_prof).plan = 'admin',false) OR private.has_role((_prof).id,'admin'::public.app_role))
   AND (COALESCE((_prof).plan = 'trial',false)
     OR (public._plan_is_paid((_prof).plan) AND (_prof).billing_period_ends_at IS NOT NULL
         AND (_prof).billing_period_ends_at <= now()));
$$;
REVOKE ALL ON FUNCTION public._citation_trial_limited(public.profiles) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._citation_trial_limited(public.profiles) TO service_role;

CREATE FUNCTION public.get_citation_trial_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE p public.profiles; n integer;
BEGIN
 IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'error','NOT_AUTHENTICATED'); END IF;
 SELECT * INTO p FROM public.profiles WHERE id=auth.uid();
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','PROFILE_NOT_FOUND'); END IF;
 SELECT count(*)::integer INTO n FROM public.citation_trial_sources WHERE user_id=p.id AND state <> 'failed';
 RETURN jsonb_build_object('ok',true,'enabled',COALESCE((SELECT enabled FROM public.citation_trial_config WHERE singleton),false),'limited',public._citation_trial_limited(p),'limit',5,'used',n,'remaining',greatest(0,5-n));
END;
$$;
REVOKE ALL ON FUNCTION public.get_citation_trial_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_citation_trial_status() TO authenticated;

-- An authenticated owner may only debit their own already-local operation.
-- This cannot authorize provider execution, refund, or mint a paid entitlement.
CREATE FUNCTION public.consume_local_citation_trial(_request_id text,_fingerprint text,_expected_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE p public.profiles; prior public.citation_trial_sources; n integer;
BEGIN
 IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'error','NOT_AUTHENTICATED'); END IF;
 IF _expected_user IS DISTINCT FROM auth.uid() THEN RETURN jsonb_build_object('ok',false,'error','CITATION_RETRY_STALE'); END IF;
 IF _request_id IS NULL OR length(_request_id) NOT BETWEEN 4 AND 200 OR _fingerprint IS NULL OR _fingerprint !~ '^[0-9a-f]{64}$' THEN
 RETURN jsonb_build_object('ok',false,'error','INVALID_REQUEST'); END IF;
 SELECT * INTO p FROM public.profiles WHERE id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','PROFILE_NOT_FOUND'); END IF;
 SELECT count(*)::integer INTO n FROM public.citation_trial_sources WHERE user_id=p.id AND state <> 'failed';
 SELECT * INTO prior FROM public.citation_trial_sources WHERE user_id=p.id AND request_id=_request_id;
 IF FOUND THEN
   IF prior.route <> 'local' OR prior.fingerprint <> _fingerprint THEN RETURN jsonb_build_object('ok',false,'error','REQUEST_FINGERPRINT_MISMATCH'); END IF;
   RETURN jsonb_build_object('ok',true,'limited',public._citation_trial_limited(p),'replayed',true,'remaining',greatest(0,5-n));
 END IF;
 IF EXISTS(SELECT 1 FROM public.citation_usage_requests WHERE user_id=p.id AND request_id=_request_id)
 OR EXISTS(SELECT 1 FROM public.credit_ledger WHERE user_id=p.id AND request_id=_request_id)
 OR EXISTS(SELECT 1 FROM public.usage_terminal_failures WHERE user_id=p.id AND request_id=_request_id) THEN
 RETURN jsonb_build_object('ok',false,'error','REQUEST_ID_ALREADY_USED'); END IF;
 IF NOT public._citation_trial_limited(p) THEN RETURN jsonb_build_object('ok',true,'limited',false); END IF;
 IF n >= 5 THEN RETURN jsonb_build_object('ok',false,'limited',true,'error','TRIAL_EXHAUSTED','remaining',0); END IF;
 INSERT INTO public.citation_trial_sources(user_id,request_id,fingerprint,route,state) VALUES(p.id,_request_id,_fingerprint,'local','succeeded');
 RETURN jsonb_build_object('ok',true,'limited',true,'replayed',false,'remaining',4-n);
END;
$$;
REVOKE ALL ON FUNCTION public.consume_local_citation_trial(text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_local_citation_trial(text,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public._citation_refund_receipt(_user_id uuid, _request_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  prof public.profiles;
  request public.citation_usage_requests;
  anchor public.citation_usage_requests;
  consumed public.credit_ledger;
  refunded_row public.credit_ledger;
  billing_id text;
  status text := 'unconfirmed';
BEGIN
  PERFORM public._require_usage_service();
  SELECT * INTO prof FROM public.profiles WHERE id = _user_id FOR UPDATE;
  SELECT * INTO request FROM public.citation_usage_requests
    WHERE user_id = _user_id AND request_id = _request_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'unconfirmed', 'refunded', false,
      'units_refunded', 0, 'request_id', _request_id);
  END IF;
  IF EXISTS(SELECT 1 FROM public.citation_trial_sources WHERE user_id=_user_id AND request_id=_request_id AND route='provider') THEN
    RETURN jsonb_build_object('status',CASE WHEN request.state='failed' THEN 'refunded' ELSE 'not_applicable' END,
      'refunded',request.state='failed','units_refunded',CASE WHEN request.state='failed' THEN 1 ELSE 0 END,'request_id',_request_id);
  END IF;
  billing_id := COALESCE(request.batch_anchor_request_id, request.request_id);
  IF request.state <> 'failed' THEN
    RETURN jsonb_build_object('status', 'not_applicable', 'refunded', false,
      'units_refunded', 0, 'request_id', billing_id);
  END IF;
  SELECT * INTO anchor FROM public.citation_usage_requests
    WHERE user_id = _user_id AND request_id = billing_id;
  SELECT * INTO consumed FROM public.credit_ledger
    WHERE user_id = _user_id AND request_id = billing_id AND event_type = 'consume';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'unconfirmed', 'refunded', false,
      'units_refunded', 0, 'request_id', billing_id);
  END IF;
  SELECT * INTO refunded_row FROM public.credit_ledger
    WHERE user_id = _user_id AND request_id = billing_id AND event_type = 'refund' AND amount > 0;
  IF FOUND THEN
    RETURN jsonb_build_object('status', 'refunded', 'refunded', true,
      'units_refunded', refunded_row.amount, 'request_id', billing_id);
  END IF;
  IF consumed.included_delta = 0 AND consumed.topup_delta = 0 AND consumed.legacy_delta = 0 THEN
    status := 'not_charged';
  ELSIF anchor.state IN ('succeeded', 'unknown') THEN
    status := 'retained';
  ELSIF anchor.state = 'in_progress' THEN
    status := 'deferred';
  ELSIF consumed.included_delta < 0 AND (
       consumed.metadata->>'plan' IS DISTINCT FROM prof.plan
       OR CASE WHEN consumed.metadata ? 'billing_period_started_at' THEN
         (consumed.metadata->>'billing_period_started_at')::timestamptz IS DISTINCT FROM prof.billing_period_started_at
       ELSE prof.billing_period_started_at IS NULL OR consumed.created_at < prof.billing_period_started_at END
     ) THEN
    status := 'review_required';
  ELSIF EXISTS (SELECT 1 FROM public.citation_usage_requests sibling
    WHERE sibling.user_id = _user_id AND sibling.batch_anchor_request_id = billing_id
      AND sibling.state IN ('succeeded', 'unknown')) THEN
    status := 'retained';
  ELSIF EXISTS (SELECT 1 FROM public.citation_usage_requests sibling
    WHERE sibling.user_id = _user_id AND sibling.batch_anchor_request_id = billing_id
      AND sibling.state = 'in_progress') THEN
    status := 'deferred';
  END IF;
  RETURN jsonb_build_object('status', status, 'refunded', false,
    'units_refunded', 0, 'request_id', billing_id);
END;
$$;
CREATE OR REPLACE FUNCTION public.begin_citation_request(
  _user_id uuid, _request_id text, _fingerprint text, _batch_id text DEFAULT NULL,
  _retry_of_request_id text DEFAULT NULL, _recovery_input jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
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
  trial_used integer;
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
    SELECT count(*)::integer INTO trial_used FROM public.citation_trial_sources WHERE user_id=_user_id AND state <> 'failed';
    IF trial_used >= 5 THEN
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
      'attempt_token',token,'charged',1,'admin',false,'trial',true,'trial_remaining',4-trial_used,
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
$$;
CREATE OR REPLACE FUNCTION public.finish_citation_request(
  _user_id uuid, _request_id text, _attempt_token uuid, _outcome text, _reason text DEFAULT NULL, _result jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  request public.citation_usage_requests;
  refund_result jsonb;
  anchor_refund jsonb;
  receipt jsonb;
  result_hash text;
  recovery public.citation_recovery_payloads;
BEGIN
  PERFORM public._require_usage_service();
  IF _outcome IS NULL OR _outcome NOT IN ('succeeded', 'failed', 'unknown') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_OUTCOME');
  END IF;
  IF (_outcome = 'succeeded' AND NOT public._citation_recovery_valid(_result, 'result'))
     OR (_outcome <> 'succeeded' AND _result IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_RECOVERY_RESULT');
  END IF;
  IF _outcome = 'succeeded' THEN
    result_hash := encode(sha256(convert_to(public._citation_canonical_json(_result), 'UTF8')), 'hex');
  END IF;
  PERFORM 1 FROM public.profiles WHERE id = _user_id FOR UPDATE;
  SELECT * INTO request FROM public.citation_usage_requests
    WHERE user_id = _user_id AND request_id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'REQUEST_NOT_FOUND'); END IF;
  IF _attempt_token IS NULL OR request.attempt_token <> _attempt_token THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ATTEMPT_TOKEN_MISMATCH');
  END IF;
  SELECT * INTO recovery FROM public.citation_recovery_payloads
    WHERE user_id = _user_id AND request_id = _request_id FOR UPDATE;
  IF request.state <> 'in_progress' THEN
    IF request.state = 'succeeded' AND _outcome = 'succeeded' AND request.result_fingerprint IS DISTINCT FROM result_hash THEN
      RETURN jsonb_build_object('ok', false, 'error', 'RESULT_CONFLICT', 'status', request.state);
    END IF;
    receipt := public._citation_refund_receipt(_user_id, _request_id);
    RETURN jsonb_build_object('ok', request.state = _outcome, 'replayed', true,
      'status', request.state, 'result_stored', request.state = 'succeeded' AND recovery.result IS NOT NULL AND recovery.expires_at > clock_timestamp(),
      'refunded', (receipt->>'refunded')::boolean, 'refund_receipt', receipt,
      'review_required', receipt->>'status' = 'review_required',
      'error', CASE WHEN request.state <> _outcome THEN 'TERMINAL_STATE_CONFLICT' END);
  END IF;
  IF _outcome = 'succeeded' THEN
    IF recovery.request_id IS NULL OR recovery.expires_at <= clock_timestamp() THEN
      RETURN jsonb_build_object('ok', false, 'error', 'RECOVERY_EXPIRED_OR_UNAVAILABLE');
    END IF;
    IF recovery.result IS NOT NULL AND recovery.result IS DISTINCT FROM _result THEN
      RETURN jsonb_build_object('ok', false, 'error', 'RESULT_CONFLICT');
    END IF;
    UPDATE public.citation_recovery_payloads SET result = _result
      WHERE user_id = _user_id AND request_id = _request_id AND result IS NULL;
  END IF;
  -- The result write and success transition share the same transaction and
  -- profile/request/payload lock. No result overwrite, compensating retry or refund.
  UPDATE public.citation_usage_requests SET state = _outcome, finished_at = now(), result_fingerprint = result_hash,
    terminal_reason = left(COALESCE(_reason, _outcome), 300)
    WHERE user_id = _user_id AND request_id = _request_id;
  -- Same transaction/profile lock as recovery publication. Unknown and lost
  -- responses retain their slot; only confirmed service-side failure releases it.
  UPDATE public.citation_trial_sources SET state=_outcome
    WHERE user_id=_user_id AND request_id=_request_id AND route='provider';
  IF _outcome = 'failed' AND NOT EXISTS(SELECT 1 FROM public.citation_trial_sources
    WHERE user_id=_user_id AND request_id=_request_id AND route='provider') THEN
    INSERT INTO public.usage_terminal_failures(user_id, request_id, source, reason)
      VALUES (_user_id, _request_id, 'citation', left(COALESCE(_reason, 'provider_rejected'), 300));
    refund_result := public.refund_credits_for_user(_user_id, _request_id, _reason);
    IF COALESCE((refund_result->>'ok')::boolean, false) IS NOT TRUE THEN
      -- Bookkeeping failure rolls back finalization. An intentional deferred
      -- group refund is ok=true and does not enter this exception branch.
      RAISE EXCEPTION 'Could not finalize usage refund' USING ERRCODE = 'P0001';
    END IF;
    -- A final failed follower can make its previously failed anchor refundable.
    -- The same profile lock covers member transition, group check and refund.
    IF request.batch_anchor_request_id IS NOT NULL
       AND request.batch_anchor_request_id <> request.request_id
       AND EXISTS (SELECT 1 FROM public.citation_usage_requests a
         WHERE a.user_id = _user_id AND a.request_id = request.batch_anchor_request_id AND a.state = 'failed') THEN
      anchor_refund := public.refund_credits_for_user(_user_id, request.batch_anchor_request_id, 'all batch members failed');
      IF COALESCE((anchor_refund->>'ok')::boolean, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'Could not finalize batch usage refund' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;
  receipt := public._citation_refund_receipt(_user_id, _request_id);
  RETURN jsonb_build_object('ok', true, 'status', _outcome, 'result_stored', _outcome = 'succeeded',
    'refunded', (receipt->>'refunded')::boolean, 'refund_receipt', receipt,
    'review_required', COALESCE((refund_result->>'review_required')::boolean, false)
      OR COALESCE((anchor_refund->>'review_required')::boolean, false));
END;
$$;
REVOKE ALL ON FUNCTION public.begin_citation_request(uuid,text,text,text,text,jsonb),public.finish_citation_request(uuid,text,uuid,text,text,jsonb),public._citation_refund_receipt(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_citation_request(uuid,text,text,text,text,jsonb),public.finish_citation_request(uuid,text,uuid,text,text,jsonb),public._citation_refund_receipt(uuid,text) TO service_role;
COMMIT;
