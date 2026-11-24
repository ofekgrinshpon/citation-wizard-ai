-- DRAFT ONLY: requires exact live fingerprints, receipt draft, and wholesale
-- integration verification before moving into migrations. Do not deploy alone.
BEGIN;
DO $preflight$
DECLARE item record; actual text;
BEGIN
 FOR item IN SELECT * FROM (VALUES
 ('public.begin_citation_request(uuid,text,text,text,text,jsonb)','f643c622a84385eed2b62f2ff8ba9b86'),
 ('public.finish_citation_request(uuid,text,uuid,text,text,jsonb)','932ccd5d97ca82e00323ef8672b59485'),
 ('public.consume_local_citation_trial(text,text,uuid)','54803f097f11fa18f875356ab46452a7'),
 ('public.get_citation_trial_status()','775aae89eb9e95aaaa9e648a12f26a01'),
 ('public._citation_refund_receipt(uuid,text)','531e62cb17b8eac8f2f6072d8f59e36a')
 ) f(signature,fingerprint) LOOP
  SELECT md5(replace(trim(prosrc), E'\r','')) INTO actual FROM pg_proc WHERE oid=to_regprocedure(item.signature);
  IF actual IS DISTINCT FROM item.fingerprint THEN RAISE EXCEPTION 'Paid meter prerequisite drift: %',item.signature; END IF;
 END LOOP;
END;
$preflight$;

CREATE TABLE private.takbull_pilot_source_usage (
 user_id uuid NOT NULL,
 request_id text NOT NULL CHECK(length(request_id) BETWEEN 4 AND 200),
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{64}$'),
 route text NOT NULL CHECK(route IN ('local','provider')),
 payment_order_id uuid NOT NULL REFERENCES private.takbull_pilot_receipts(order_id),
 state text NOT NULL CHECK(state IN ('in_progress','succeeded','failed','unknown')),
 released_while_active boolean NOT NULL DEFAULT false CHECK(NOT released_while_active OR state='failed'),
 PRIMARY KEY(user_id,request_id),
 FOREIGN KEY(payment_order_id,user_id) REFERENCES private.takbull_pilot_orders(id,user_id),
 CHECK (route<>'local' OR state='succeeded')
);
CREATE INDEX takbull_pilot_source_bill_count ON private.takbull_pilot_source_usage(payment_order_id) WHERE state<>'failed';
ALTER TABLE private.takbull_pilot_source_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.takbull_pilot_source_usage FROM PUBLIC,anon,authenticated,service_role;

-- Existing grants remain serviceable if intake is disabled. Refunded base
-- passes stop authorization, and refunded add-ons do not contribute quota.
CREATE FUNCTION private.takbull_pilot_usable_buckets(_owner uuid,_pass uuid,_now timestamptz)
RETURNS TABLE(order_id uuid,capacity integer,used integer,ends_at timestamptz,is_base boolean)
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT o.id,o.sources,(
   SELECT count(*)::integer FROM private.takbull_pilot_source_usage u
   WHERE u.payment_order_id=o.id AND u.state<>'failed'
 ),r.ends_at,o.id=_pass
 FROM private.takbull_pilot_orders o JOIN private.takbull_pilot_receipts r ON r.order_id=o.id
 WHERE o.user_id=_owner AND (o.id=_pass OR o.parent_pass=_pass)
  AND r.starts_at<=_now AND r.ends_at>_now
  AND NOT EXISTS(SELECT 1 FROM private.takbull_pilot_refunds ref WHERE ref.order_id=o.id)
  AND NOT EXISTS(SELECT 1 FROM private.takbull_pilot_refunds ref WHERE ref.order_id=_pass);
$$;
REVOKE ALL ON FUNCTION private.takbull_pilot_usable_buckets(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

-- All mutation callers must already hold the owner profile FOR UPDATE.
-- Same lock as payment receipt/revoke prevents double use and cross-pass spill.
CREATE FUNCTION private.takbull_pilot_reserve_source(_owner uuid,_pass uuid,_request text,
 _fingerprint text,_route text,_now timestamptz) RETURNS boolean
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE bucket uuid;
BEGIN
 SELECT b.order_id INTO bucket FROM private.takbull_pilot_usable_buckets(_owner,_pass,_now) b
 WHERE b.used<b.capacity ORDER BY b.is_base DESC,b.ends_at,b.order_id LIMIT 1;
 IF bucket IS NULL THEN RETURN false; END IF;
 INSERT INTO private.takbull_pilot_source_usage(user_id,request_id,fingerprint,route,payment_order_id,state)
 VALUES(_owner,_request,_fingerprint,_route,bucket,CASE WHEN _route='local' THEN 'succeeded' ELSE 'in_progress' END);
 RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION private.takbull_pilot_reserve_source(uuid,uuid,text,text,text,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

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
  pilot_pass uuid; pilot_now timestamptz;
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
  IF EXISTS(SELECT 1 FROM private.takbull_pilot_source_usage WHERE user_id=_user_id AND request_id=_request_id) THEN
    RETURN jsonb_build_object('ok',false,'execute',false,'error','REQUEST_ID_ALREADY_USED');
  END IF;
  -- One fresh source per reservation, no legacy five-item batch anchoring.
  pilot_now := clock_timestamp();
  IF prof.plan IS DISTINCT FROM 'admin' AND NOT private.has_role(_user_id,'admin'::public.app_role) THEN
    pilot_pass := private.takbull_pilot_active_pass(_user_id,pilot_now);
  END IF;
  IF pilot_pass IS NOT NULL THEN
    IF NOT private.takbull_pilot_reserve_source(_user_id,pilot_pass,_request_id,_fingerprint,'provider',pilot_now) THEN
      RETURN jsonb_build_object('ok',false,'execute',false,'error','INSUFFICIENT_CREDITS','block_reason','plan_allowance','required',1);
    END IF;
    INSERT INTO public.citation_usage_requests
      (user_id,request_id,fingerprint,batch_id,retry_of_request_id,batch_anchor_request_id,charged_units,state,attempt_token)
    VALUES(_user_id,_request_id,_fingerprint,_batch_id,_retry_of_request_id,NULL,1,'in_progress',token);
    INSERT INTO public.citation_recovery_payloads(user_id,request_id,input,expires_at)
    VALUES(_user_id,_request_id,_recovery_input,now()+interval '24 hours');
    RETURN jsonb_build_object('ok',true,'execute',true,'status','in_progress','request_id',_request_id,
      'attempt_token',token,'charged',1,'admin',false,'paid_source_meter',true,
      'retry_of_request_id',_retry_of_request_id,'retry_parent_refund_receipt',parent_receipt);
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

CREATE OR REPLACE FUNCTION public.finish_citation_request(_user_id uuid, _request_id text, _attempt_token uuid, _outcome text, _reason text DEFAULT NULL::text, _result jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  request public.citation_usage_requests;
  refund_result jsonb;
  anchor_refund jsonb;
  receipt jsonb;
  result_hash text;
  recovery public.citation_recovery_payloads;
  is_pilot boolean;
  meter_now timestamptz;
  meter_pass uuid;
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
  is_pilot:=EXISTS(SELECT 1 FROM private.takbull_pilot_source_usage
    WHERE user_id=_user_id AND request_id=_request_id AND route='provider');
  IF is_pilot THEN
    meter_now:=clock_timestamp();
    meter_pass:=private.takbull_pilot_active_pass(_user_id,meter_now);
    UPDATE private.takbull_pilot_source_usage u SET state=_outcome,
      released_while_active=(_outcome='failed' AND EXISTS(
        SELECT 1 FROM private.takbull_pilot_usable_buckets(_user_id,meter_pass,meter_now) b
        WHERE b.order_id=u.payment_order_id
      ))
      WHERE u.user_id=_user_id AND u.request_id=_request_id AND u.route='provider' AND u.state='in_progress';
    IF NOT FOUND THEN RAISE EXCEPTION 'Paid source state inconsistency' USING ERRCODE='P0001'; END IF;
  END IF;
  IF _outcome = 'failed' AND NOT is_pilot AND NOT EXISTS(SELECT 1 FROM public.citation_trial_sources
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
$function$;

CREATE OR REPLACE FUNCTION public._citation_refund_receipt(_user_id uuid, _request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  prof public.profiles;
  request public.citation_usage_requests;
  anchor public.citation_usage_requests;
  consumed public.credit_ledger;
  refunded_row public.credit_ledger;
  billing_id text;
  status text := 'unconfirmed';
  meter_release boolean;
BEGIN
  PERFORM public._require_usage_service();
  SELECT * INTO prof FROM public.profiles WHERE id = _user_id FOR UPDATE;
  SELECT * INTO request FROM public.citation_usage_requests
    WHERE user_id = _user_id AND request_id = _request_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'unconfirmed', 'refunded', false,
      'units_refunded', 0, 'request_id', _request_id);
  END IF;
  SELECT released_while_active INTO meter_release FROM private.takbull_pilot_source_usage
   WHERE user_id=_user_id AND request_id=_request_id AND route='provider';
  IF FOUND THEN
    RETURN jsonb_build_object('status',CASE WHEN meter_release THEN 'refunded' ELSE 'not_applicable' END,
      'refunded',meter_release,'units_refunded',CASE WHEN meter_release THEN 1 ELSE 0 END,'request_id',_request_id);
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
$function$;

CREATE OR REPLACE FUNCTION public.consume_local_citation_trial(_request_id text, _fingerprint text, _expected_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE p public.profiles; prior public.citation_trial_sources; n integer; allowance integer;
 paid_prior private.takbull_pilot_source_usage; pilot_pass uuid; pilot_now timestamptz; pilot_total integer; pilot_used integer;
BEGIN
 IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'error','NOT_AUTHENTICATED'); END IF;
 IF _expected_user IS DISTINCT FROM auth.uid() THEN RETURN jsonb_build_object('ok',false,'error','CITATION_RETRY_STALE'); END IF;
 IF _request_id IS NULL OR length(_request_id) NOT BETWEEN 4 AND 200 OR _fingerprint IS NULL OR _fingerprint !~ '^[0-9a-f]{64}$' THEN
 RETURN jsonb_build_object('ok',false,'error','INVALID_REQUEST'); END IF;
 SELECT * INTO p FROM public.profiles WHERE id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','PROFILE_NOT_FOUND'); END IF;
 pilot_now:=clock_timestamp();
 IF p.plan IS DISTINCT FROM 'admin' AND NOT private.has_role(p.id,'admin'::public.app_role) THEN
   pilot_pass:=private.takbull_pilot_active_pass(p.id,pilot_now);
 END IF;
 SELECT * INTO paid_prior FROM private.takbull_pilot_source_usage WHERE user_id=p.id AND request_id=_request_id;
 IF FOUND THEN
   IF paid_prior.route<>'local' OR paid_prior.fingerprint<>_fingerprint THEN
     RETURN jsonb_build_object('ok',false,'error','REQUEST_FINGERPRINT_MISMATCH');
   END IF;
   IF pilot_pass IS NULL THEN RETURN jsonb_build_object('ok',true,'limited',false,'replayed',true); END IF;
   SELECT COALESCE(sum(capacity),0),COALESCE(sum(used),0) INTO pilot_total,pilot_used
   FROM private.takbull_pilot_usable_buckets(p.id,pilot_pass,pilot_now);
   RETURN jsonb_build_object('ok',true,'limited',true,'replayed',true,'remaining',greatest(0,pilot_total-pilot_used),'limit',pilot_total);
 END IF;
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
 IF pilot_pass IS NOT NULL THEN
   IF NOT private.takbull_pilot_reserve_source(p.id,pilot_pass,_request_id,_fingerprint,'local',pilot_now) THEN
     RETURN jsonb_build_object('ok',false,'limited',true,'error','TRIAL_EXHAUSTED','remaining',0,'paid_source_meter',true);
   END IF;
   SELECT COALESCE(sum(capacity),0),COALESCE(sum(used),0) INTO pilot_total,pilot_used
   FROM private.takbull_pilot_usable_buckets(p.id,pilot_pass,pilot_now);
   RETURN jsonb_build_object('ok',true,'limited',true,'replayed',false,'remaining',greatest(0,pilot_total-pilot_used),'limit',pilot_total,'paid_source_meter',true);
 END IF;
 IF NOT public._citation_trial_limited(p) THEN RETURN jsonb_build_object('ok',true,'limited',false); END IF;
 IF n >= allowance THEN RETURN jsonb_build_object('ok',false,'limited',true,'error','TRIAL_EXHAUSTED','remaining',0); END IF;
 INSERT INTO public.citation_trial_sources(user_id,request_id,fingerprint,route,state) VALUES(p.id,_request_id,_fingerprint,'local','succeeded');
 RETURN jsonb_build_object('ok',true,'limited',true,'replayed',false,'remaining',allowance-1-n,'limit',allowance);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_citation_trial_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE p public.profiles; n integer; bonus integer;
 pilot_pass uuid; pilot_total integer; pilot_used integer; pilot_end timestamptz;
 pilot_now timestamptz:=clock_timestamp(); original jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'error','NOT_AUTHENTICATED'); END IF;
 SELECT * INTO p FROM public.profiles WHERE id=auth.uid();
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','PROFILE_NOT_FOUND'); END IF;
 SELECT count(*)::integer INTO n FROM public.citation_trial_sources WHERE user_id=p.id AND state <> 'failed';
 bonus := public._citation_source_bonus(p.id);
 original := jsonb_build_object('ok',true,'enabled',COALESCE((SELECT enabled FROM public.citation_trial_config WHERE singleton),false),'limited',public._citation_trial_limited(p),'limit',5+bonus,'used',n,'remaining',greatest(0,5+bonus-n),'bonus_sources',bonus,'referral_sources_enabled',(SELECT enabled FROM public.citation_referral_config WHERE singleton),'referrals_granted',(SELECT count(*) FROM public.citation_referral_awards WHERE referrer_id=p.id),'referral_pending',COALESCE((SELECT enabled AND p.created_at>=activated_at AND NOT COALESCE(p.referral_bonus_granted,false) AND p.referred_by_user_id IS NOT NULL AND p.referred_by_user_id<>p.id FROM public.citation_referral_config WHERE singleton),false) AND EXISTS(SELECT 1 FROM public.profiles WHERE id=p.referred_by_user_id) AND NOT EXISTS(SELECT 1 FROM public.citation_referral_awards WHERE referee_id=p.id) AND NOT EXISTS(SELECT 1 FROM public.credit_ledger WHERE user_id=p.id AND event_type='referral_bonus'));
 IF p.plan IS DISTINCT FROM 'admin' AND NOT private.has_role(p.id,'admin'::public.app_role) THEN
   pilot_pass:=private.takbull_pilot_active_pass(p.id,pilot_now);
 END IF;
 IF pilot_pass IS NULL THEN RETURN original; END IF;
 SELECT COALESCE(sum(capacity),0),COALESCE(sum(used),0),max(ends_at) INTO pilot_total,pilot_used,pilot_end
 FROM private.takbull_pilot_usable_buckets(p.id,pilot_pass,pilot_now);
 RETURN original || jsonb_build_object('enabled',true,'limited',true,'limit',pilot_total,'used',pilot_used,
   'remaining',greatest(0,pilot_total-pilot_used),'paid_source_meter',true,'paid_pass_ends_at',pilot_end);
END;
$function$;

COMMIT;
