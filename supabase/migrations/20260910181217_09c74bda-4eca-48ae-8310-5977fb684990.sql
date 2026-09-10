
-- ── Plan assignment accepts the new plan set ──────────────────────────────
CREATE OR REPLACE FUNCTION public.set_user_plan(_user_id uuid, _new_plan text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  caller uuid := auth.uid();
  allowance int;
  reset_mode text;
  period interval;
  prof public.profiles;
  req_id text;
BEGIN
  IF caller IS NULL OR NOT private.has_role(caller, 'admin'::app_role) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;
  IF _new_plan NOT IN ('trial','week','month','semester','pro_annual','admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PLAN');
  END IF;

  allowance := public._plan_credits(_new_plan);
  reset_mode := public._plan_reset_mode(_new_plan);
  period := public._plan_period_length(_new_plan);
  req_id := 'planset:' || _user_id::text || ':' || extract(epoch from now())::bigint::text;

  UPDATE public.profiles
     SET plan = _new_plan,
         credits_reset_mode = reset_mode,
         included_credits_total = allowance,
         included_credits_remaining = allowance,
         window_started_at = NULL,
         window_units_used = 0,
         trial_granted = true,
         billing_period_started_at = CASE WHEN _new_plan = 'admin' THEN NULL ELSE now() END,
         billing_period_ends_at = CASE
             WHEN _new_plan IN ('admin','trial') THEN NULL ELSE now() + period END,
         is_subscribed = public._plan_is_paid(_new_plan)
   WHERE id = _user_id
   RETURNING * INTO prof;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  END IF;

  INSERT INTO public.credit_ledger
    (user_id, request_id, event_type, amount, included_delta, topup_delta,
     balance_after_included, balance_after_topup, reason, metadata)
  VALUES
    (_user_id, req_id, 'admin_adjustment', allowance, allowance, 0,
     prof.included_credits_remaining, prof.topup_credits_remaining,
     'plan changed to ' || _new_plan,
     jsonb_build_object('granted_by', caller, 'new_plan', _new_plan));

  RETURN jsonb_build_object('ok', true, 'plan', _new_plan);
END;
$function$;

-- ── Expiry-aware consumption ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.consume_credits(_amount integer, _reason text, _request_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  uid uuid := auth.uid();
  prof public.profiles;
  prior public.credit_ledger;
  use_included int := 0;
  use_topup int := 0;
  use_legacy int := 0;
  is_admin boolean;
  now_ts timestamptz := now();
  win_start timestamptz;
  win_used int;
  win_limit int;
  win_avail int;
  period_avail int;
  reset_at timestamptz;
  block text;
  paid boolean;
  expired boolean;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;
  IF _amount IS NULL OR _amount < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_AMOUNT');
  END IF;
  IF _request_id IS NULL OR length(_request_id) < 4 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_REQUEST_ID');
  END IF;

  SELECT * INTO prior FROM public.credit_ledger
   WHERE user_id = uid AND request_id = _request_id AND event_type = 'consume'
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'request_id', _request_id,
      'remaining_included', prior.balance_after_included,
      'remaining_topup', prior.balance_after_topup);
  END IF;

  SELECT * INTO prof FROM public.profiles WHERE id = uid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PROFILE_NOT_FOUND');
  END IF;

  is_admin := (prof.plan = 'admin') OR private.has_role(uid, 'admin'::app_role);

  IF is_admin OR _amount = 0 THEN
    INSERT INTO public.credit_ledger
      (user_id, request_id, event_type, amount, included_delta, topup_delta,
       balance_after_included, balance_after_topup, reason)
    VALUES
      (uid, _request_id, 'consume', _amount, 0, 0,
       prof.included_credits_remaining, prof.topup_credits_remaining, _reason);
    RETURN jsonb_build_object('ok', true, 'admin', is_admin, 'request_id', _request_id,
      'remaining_included', prof.included_credits_remaining,
      'remaining_topup', prof.topup_credits_remaining);
  END IF;

  paid := public._plan_is_paid(prof.plan);
  expired := paid AND prof.billing_period_ends_at IS NOT NULL
             AND prof.billing_period_ends_at <= now_ts;

  win_start := prof.window_started_at;
  win_used := COALESCE(prof.window_units_used, 0);
  IF win_start IS NULL OR now_ts >= win_start + interval '5 hours' THEN
    win_start := now_ts;
    win_used := 0;
  END IF;
  reset_at := win_start + interval '5 hours';

  win_limit := public._plan_window_limit(prof.plan);
  win_avail := GREATEST(0, win_limit - win_used);
  period_avail := CASE WHEN expired THEN 0 ELSE GREATEST(0, prof.included_credits_remaining) END;

  IF win_avail >= _amount AND period_avail >= _amount THEN
    use_included := _amount;
  ELSIF paid AND NOT expired
        AND (prof.topup_credits_remaining + prof.legacy_bonus_remaining) >= _amount THEN
    use_topup := LEAST(prof.topup_credits_remaining, _amount);
    use_legacy := _amount - use_topup;
  ELSE
    IF expired THEN
      block := 'plan_expired';
    ELSIF prof.plan = 'trial' AND period_avail < _amount THEN
      block := 'trial_exhausted';
    ELSIF period_avail < _amount THEN
      block := 'plan_allowance';
    ELSE
      block := 'short_window';
    END IF;
    RETURN jsonb_build_object(
      'ok', false, 'error', 'INSUFFICIENT_CREDITS', 'block_reason', block,
      'required', _amount, 'window_reset_at', reset_at,
      'plan_ends_at', prof.billing_period_ends_at,
      'can_use_topup', false, 'can_purchase_topup', paid AND NOT expired,
      'remaining_included', prof.included_credits_remaining,
      'remaining_topup', prof.topup_credits_remaining);
  END IF;

  PERFORM set_config('app.credit_txn', '1', true);

  UPDATE public.profiles
     SET included_credits_remaining = included_credits_remaining - use_included,
         topup_credits_remaining = topup_credits_remaining - use_topup,
         legacy_bonus_remaining = legacy_bonus_remaining - use_legacy,
         window_started_at = win_start,
         window_units_used = win_used + use_included
   WHERE id = uid
   RETURNING * INTO prof;

  PERFORM set_config('app.credit_txn', '0', true);

  INSERT INTO public.credit_ledger
    (user_id, request_id, event_type, amount, included_delta, topup_delta, legacy_delta,
     balance_after_included, balance_after_topup, reason, metadata)
  VALUES
    (uid, _request_id, 'consume', -_amount, -use_included, -use_topup, -use_legacy,
     prof.included_credits_remaining, prof.topup_credits_remaining, _reason,
     jsonb_build_object(
       'bucket', CASE WHEN use_included > 0 THEN 'included'
                      WHEN use_topup > 0 THEN 'topup' ELSE 'legacy_bonus' END,
       'plan', prof.plan,
       'window_started_at', win_start,
       'window_units_used_after', prof.window_units_used));

  RETURN jsonb_build_object('ok', true, 'request_id', _request_id,
    'bucket', CASE WHEN use_included > 0 THEN 'included'
                   WHEN use_topup > 0 THEN 'topup' ELSE 'legacy_bonus' END,
    'window_reset_at', reset_at,
    'plan_ends_at', prof.billing_period_ends_at,
    'remaining_included', prof.included_credits_remaining,
    'remaining_topup', prof.topup_credits_remaining,
    'remaining_legacy', prof.legacy_bonus_remaining);
END;
$function$;

-- ── Expiry-aware status ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_usage_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  uid uuid := auth.uid();
  prof public.profiles;
  now_ts timestamptz := now();
  win_start timestamptz;
  win_used int;
  win_limit int;
  period_total int;
  period_used int;
  is_admin boolean;
  paid boolean;
  expired boolean;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;
  SELECT * INTO prof FROM public.profiles WHERE id = uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PROFILE_NOT_FOUND');
  END IF;

  is_admin := (prof.plan = 'admin') OR private.has_role(uid, 'admin'::app_role);
  paid := public._plan_is_paid(prof.plan);
  expired := paid AND prof.billing_period_ends_at IS NOT NULL
             AND prof.billing_period_ends_at <= now_ts;

  win_start := prof.window_started_at;
  win_used := COALESCE(prof.window_units_used, 0);
  IF win_start IS NULL OR now_ts >= win_start + interval '5 hours' THEN
    win_start := NULL;
    win_used := 0;
  END IF;

  win_limit := GREATEST(1, public._plan_window_limit(prof.plan));
  period_total := GREATEST(1, prof.included_credits_total);
  period_used := GREATEST(0, prof.included_credits_total - prof.included_credits_remaining);

  RETURN jsonb_build_object(
    'ok', true,
    'server_now', now_ts,
    'plan', prof.plan,
    'is_admin', is_admin,
    'is_paid', paid,
    'is_expired', expired,
    'reset_mode', public._plan_reset_mode(prof.plan),
    'window_reset_at', CASE WHEN win_start IS NULL THEN NULL ELSE win_start + interval '5 hours' END,
    'window_used_ratio', round((win_used::numeric / win_limit), 4),
    'period_used_ratio', CASE WHEN expired THEN 1 ELSE round((period_used::numeric / period_total), 4) END,
    'plan_started_at', prof.billing_period_started_at,
    'plan_ends_at', prof.billing_period_ends_at,
    'has_extra_usage', (prof.topup_credits_remaining + prof.legacy_bonus_remaining) > 0,
    'can_purchase_topup', paid AND NOT expired);
END;
$function$;

-- ── Admin: grant purchased extra usage (top-up) ───────────────────────────
CREATE OR REPLACE FUNCTION public.add_topup_credits(_user_id uuid, _amount integer, _reason text DEFAULT 'manual')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  caller uuid := auth.uid();
  prof public.profiles;
  req_id text;
BEGIN
  IF caller IS NULL OR NOT private.has_role(caller, 'admin'::app_role) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_AMOUNT');
  END IF;

  req_id := 'topup:' || gen_random_uuid()::text;

  PERFORM set_config('app.credit_txn', '1', true);
  UPDATE public.profiles
     SET topup_credits_remaining = topup_credits_remaining + _amount
   WHERE id = _user_id
   RETURNING * INTO prof;
  PERFORM set_config('app.credit_txn', '0', true);

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  END IF;

  INSERT INTO public.credit_ledger
    (user_id, request_id, event_type, amount, included_delta, topup_delta,
     balance_after_included, balance_after_topup, reason, metadata)
  VALUES
    (_user_id, req_id, 'topup', _amount, 0, _amount,
     prof.included_credits_remaining, prof.topup_credits_remaining, _reason,
     jsonb_build_object('granted_by', caller));

  RETURN jsonb_build_object('ok', true,
    'remaining_topup', prof.topup_credits_remaining);
END;
$function$;

-- ── Admin economics view ──────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.admin_usage_economics
WITH (security_invoker = true) AS
SELECT
  date_trunc('day', l.created_at)::date            AS day,
  COALESCE(l.metadata->>'plan', p.plan)            AS plan,
  COALESCE(l.metadata->>'operation_type', l.reason) AS operation_type,
  COALESCE(l.metadata->>'bucket', 'n/a')           AS bucket,
  count(*) FILTER (WHERE l.event_type = 'consume') AS operations,
  count(DISTINCT l.user_id)                        AS active_users,
  COALESCE(sum(-l.amount) FILTER (WHERE l.event_type = 'consume'), 0) AS units_consumed,
  COALESCE(sum(l.amount) FILTER (WHERE l.event_type = 'refund'), 0)   AS units_refunded,
  COALESCE(sum((l.metadata->>'estimated_cost_usd')::numeric), 0)      AS estimated_cost_usd,
  bool_or((l.metadata->>'cost_is_estimate')::boolean)                 AS cost_is_estimate
FROM public.credit_ledger l
JOIN public.profiles p ON p.id = l.user_id
GROUP BY 1, 2, 3, 4;

REVOKE ALL ON public.admin_usage_economics FROM anon, authenticated;
GRANT SELECT ON public.admin_usage_economics TO service_role;
