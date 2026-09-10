
-- ── 1. Profile columns for the usage model ────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS window_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS window_units_used int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS legacy_bonus_remaining int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trial_granted boolean NOT NULL DEFAULT false;

ALTER TABLE public.credit_ledger
  ADD COLUMN IF NOT EXISTS legacy_delta int NOT NULL DEFAULT 0;

-- ── 2. Plan configuration helpers ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._plan_credits(_plan text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _plan
    WHEN 'trial' THEN 15
    WHEN 'week' THEN 45
    WHEN 'month' THEN 140
    WHEN 'semester' THEN 360
    -- legacy plans preserved
    WHEN 'basic' THEN 10
    WHEN 'pro_monthly' THEN 250
    WHEN 'pro_semester' THEN 900
    WHEN 'pro_annual' THEN 3000
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public._plan_window_limit(_plan text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _plan
    WHEN 'trial' THEN 15
    WHEN 'week' THEN 20
    WHEN 'month' THEN 25
    WHEN 'semester' THEN 30
    WHEN 'basic' THEN 15
    WHEN 'pro_monthly' THEN 25
    WHEN 'pro_semester' THEN 30
    WHEN 'pro_annual' THEN 30
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public._plan_period_length(_plan text)
RETURNS interval LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _plan
    WHEN 'trial' THEN interval '100 years'
    WHEN 'week' THEN interval '7 days'
    WHEN 'month' THEN interval '30 days'
    WHEN 'semester' THEN interval '90 days'
    WHEN 'basic' THEN interval '1 month'
    WHEN 'pro_monthly' THEN interval '1 month'
    WHEN 'pro_semester' THEN interval '3 months'
    WHEN 'pro_annual' THEN interval '12 months'
    ELSE interval '1 month'
  END;
$$;

CREATE OR REPLACE FUNCTION public._plan_reset_mode(_plan text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _plan
    WHEN 'trial' THEN 'none'
    WHEN 'week' THEN 'fixed_term'
    WHEN 'month' THEN 'fixed_term'
    WHEN 'semester' THEN 'fixed_term'
    WHEN 'basic' THEN 'calendar_month'
    WHEN 'pro_monthly' THEN 'billing_period'
    WHEN 'pro_semester' THEN 'period_bucket'
    WHEN 'pro_annual' THEN 'period_bucket'
    ELSE 'none'
  END;
$$;

CREATE OR REPLACE FUNCTION public._plan_is_paid(_plan text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT _plan IN ('week','month','semester','pro_monthly','pro_semester','pro_annual');
$$;

-- ── 3. Guard new sensitive columns ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.prevent_profile_sensitive_updates()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  is_privileged boolean;
BEGIN
  is_privileged := (current_setting('role', true) IN ('service_role','postgres'))
                   OR (auth.role() = 'service_role')
                   OR (current_setting('app.credit_txn', true) = '1')
                   OR private.has_role(auth.uid(), 'admin'::app_role);

  IF is_privileged THEN
    RETURN NEW;
  END IF;

  IF NEW.plan IS DISTINCT FROM OLD.plan
     OR NEW.is_subscribed IS DISTINCT FROM OLD.is_subscribed
     OR NEW.included_credits_total IS DISTINCT FROM OLD.included_credits_total
     OR NEW.included_credits_remaining IS DISTINCT FROM OLD.included_credits_remaining
     OR NEW.topup_credits_remaining IS DISTINCT FROM OLD.topup_credits_remaining
     OR NEW.legacy_bonus_remaining IS DISTINCT FROM OLD.legacy_bonus_remaining
     OR NEW.window_started_at IS DISTINCT FROM OLD.window_started_at
     OR NEW.window_units_used IS DISTINCT FROM OLD.window_units_used
     OR NEW.trial_granted IS DISTINCT FROM OLD.trial_granted
     OR NEW.credits_reset_mode IS DISTINCT FROM OLD.credits_reset_mode
     OR NEW.billing_period_started_at IS DISTINCT FROM OLD.billing_period_started_at
     OR NEW.billing_period_ends_at IS DISTINCT FROM OLD.billing_period_ends_at
     OR NEW.referral_code IS DISTINCT FROM OLD.referral_code
     OR NEW.referred_by_user_id IS DISTINCT FROM OLD.referred_by_user_id
     OR NEW.referral_bonus_granted IS DISTINCT FROM OLD.referral_bonus_granted
     OR NEW.citation_count IS DISTINCT FROM OLD.citation_count
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Updating billing, plan, credits, referral, or identity fields is not allowed' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

-- ── 4. Atomic usage consumption with window + period + buckets ────────────
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
    RETURN jsonb_build_object(
      'ok', true, 'replayed', true, 'request_id', _request_id,
      'remaining_included', prior.balance_after_included,
      'remaining_topup', prior.balance_after_topup
    );
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
    RETURN jsonb_build_object(
      'ok', true, 'admin', is_admin, 'request_id', _request_id,
      'remaining_included', prof.included_credits_remaining,
      'remaining_topup', prof.topup_credits_remaining
    );
  END IF;

  -- Server-authoritative 5-hour window rollover.
  win_start := prof.window_started_at;
  win_used := prof.window_units_used;
  IF win_start IS NULL OR now_ts >= win_start + interval '5 hours' THEN
    win_start := now_ts;
    win_used := 0;
  END IF;
  reset_at := win_start + interval '5 hours';

  win_limit := public._plan_window_limit(prof.plan);
  win_avail := GREATEST(0, win_limit - win_used);
  period_avail := GREATEST(0, prof.included_credits_remaining);
  paid := public._plan_is_paid(prof.plan);

  IF win_avail >= _amount AND period_avail >= _amount THEN
    use_included := _amount;
  ELSIF paid AND (prof.topup_credits_remaining + prof.legacy_bonus_remaining) >= _amount THEN
    use_topup := LEAST(prof.topup_credits_remaining, _amount);
    use_legacy := _amount - use_topup;
  ELSE
    IF period_avail < _amount THEN
      block := 'plan_allowance';
    ELSE
      block := 'short_window';
    END IF;
    IF prof.plan = 'trial' AND period_avail < _amount THEN
      block := 'trial_exhausted';
    END IF;
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'INSUFFICIENT_CREDITS',
      'block_reason', block,
      'required', _amount,
      'window_reset_at', reset_at,
      'plan_ends_at', prof.billing_period_ends_at,
      'can_use_topup', false,
      'can_purchase_topup', paid,
      'remaining_included', prof.included_credits_remaining,
      'remaining_topup', prof.topup_credits_remaining
    );
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
       'window_units_used_after', prof.window_units_used
     ));

  RETURN jsonb_build_object(
    'ok', true, 'request_id', _request_id,
    'bucket', CASE WHEN use_included > 0 THEN 'included'
                   WHEN use_topup > 0 THEN 'topup' ELSE 'legacy_bonus' END,
    'window_reset_at', reset_at,
    'plan_ends_at', prof.billing_period_ends_at,
    'remaining_included', prof.included_credits_remaining,
    'remaining_topup', prof.topup_credits_remaining,
    'remaining_legacy', prof.legacy_bonus_remaining
  );
END;
$function$;

-- ── 5. Bucket-faithful refunds ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refund_credits(_request_id text, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;
  RETURN public.refund_credits_for_user(uid, _request_id, _reason);
END;
$function$;

CREATE OR REPLACE FUNCTION public.refund_credits_for_user(_user_id uuid, _request_id text, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  consume_row public.credit_ledger;
  prior public.credit_ledger;
  prof public.profiles;
BEGIN
  IF _user_id IS NULL OR _request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_REQUEST_ID');
  END IF;

  SELECT * INTO prior FROM public.credit_ledger
   WHERE user_id = _user_id AND request_id = _request_id AND event_type = 'refund'
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'replayed', true,
      'remaining_included', prior.balance_after_included,
      'remaining_topup', prior.balance_after_topup);
  END IF;

  SELECT * INTO consume_row FROM public.credit_ledger
   WHERE user_id = _user_id AND request_id = _request_id AND event_type = 'consume'
   LIMIT 1;
  IF NOT FOUND THEN
    SELECT * INTO prof FROM public.profiles WHERE id = _user_id;
    RETURN jsonb_build_object('ok', true, 'noop', true,
      'remaining_included', COALESCE(prof.included_credits_remaining, 0),
      'remaining_topup', COALESCE(prof.topup_credits_remaining, 0));
  END IF;

  PERFORM set_config('app.credit_txn', '1', true);

  UPDATE public.profiles
     SET included_credits_remaining = included_credits_remaining + (-consume_row.included_delta),
         topup_credits_remaining = topup_credits_remaining + (-consume_row.topup_delta),
         legacy_bonus_remaining = legacy_bonus_remaining + (-COALESCE(consume_row.legacy_delta, 0)),
         window_units_used = GREATEST(0, window_units_used + consume_row.included_delta)
   WHERE id = _user_id
   RETURNING * INTO prof;

  PERFORM set_config('app.credit_txn', '0', true);

  INSERT INTO public.credit_ledger
    (user_id, request_id, event_type, amount, included_delta, topup_delta, legacy_delta,
     balance_after_included, balance_after_topup, reason)
  VALUES
    (_user_id, _request_id, 'refund', -consume_row.amount,
     -consume_row.included_delta, -consume_row.topup_delta, -COALESCE(consume_row.legacy_delta, 0),
     prof.included_credits_remaining, prof.topup_credits_remaining, _reason);

  RETURN jsonb_build_object('ok', true,
    'remaining_included', prof.included_credits_remaining,
    'remaining_topup', prof.topup_credits_remaining,
    'remaining_legacy', prof.legacy_bonus_remaining);
END;
$function$;

-- ── 6. Batch-priced utility usage (1 unit per N items) ────────────────────
CREATE OR REPLACE FUNCTION public.consume_usage_batch(
  _batch_id text, _group_size int, _reason text, _request_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  uid uuid := auth.uid();
  processed int;
  charge int;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;
  IF _batch_id IS NULL OR length(_batch_id) < 4 OR _group_size IS NULL OR _group_size < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_BATCH');
  END IF;

  SELECT count(*) INTO processed FROM public.credit_ledger
   WHERE user_id = uid
     AND event_type = 'consume'
     AND metadata->>'batch_id' = _batch_id
     AND request_id <> _request_id;

  charge := CASE WHEN processed % _group_size = 0 THEN 1 ELSE 0 END;

  RETURN public.consume_credits(charge, _reason, _request_id)
         || jsonb_build_object('batch_id', _batch_id, 'batch_index', processed, 'charged', charge);
END;
$function$;

-- ── 7. Semantic usage status for the UI (no raw numbers required) ─────────
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
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;
  SELECT * INTO prof FROM public.profiles WHERE id = uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PROFILE_NOT_FOUND');
  END IF;

  is_admin := (prof.plan = 'admin') OR private.has_role(uid, 'admin'::app_role);

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
    'is_paid', public._plan_is_paid(prof.plan),
    'reset_mode', public._plan_reset_mode(prof.plan),
    'window_reset_at', CASE WHEN win_start IS NULL THEN NULL ELSE win_start + interval '5 hours' END,
    'window_used_ratio', round((win_used::numeric / win_limit), 4),
    'period_used_ratio', round((period_used::numeric / period_total), 4),
    'plan_started_at', prof.billing_period_started_at,
    'plan_ends_at', prof.billing_period_ends_at,
    'has_extra_usage', (prof.topup_credits_remaining + prof.legacy_bonus_remaining) > 0,
    'can_purchase_topup', public._plan_is_paid(prof.plan)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_usage_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_usage_batch(text, int, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public._plan_window_limit(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._plan_is_paid(text) TO authenticated, service_role;

-- ── 8. New-account trial defaults ─────────────────────────────────────────
ALTER TABLE public.profiles
  ALTER COLUMN plan SET DEFAULT 'trial',
  ALTER COLUMN included_credits_remaining SET DEFAULT 15,
  ALTER COLUMN included_credits_total SET DEFAULT 15,
  ALTER COLUMN credits_reset_mode SET DEFAULT 'none';
