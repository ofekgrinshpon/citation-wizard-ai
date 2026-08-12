
CREATE OR REPLACE FUNCTION public.prevent_profile_sensitive_updates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

CREATE OR REPLACE FUNCTION public.consume_credits(_amount integer, _reason text, _request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  prof public.profiles;
  prior public.credit_ledger;
  use_included int := 0;
  use_topup int := 0;
  is_admin boolean;
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
      'ok', true,
      'replayed', true,
      'request_id', _request_id,
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
      'ok', true,
      'admin', is_admin,
      'request_id', _request_id,
      'remaining_included', prof.included_credits_remaining,
      'remaining_topup', prof.topup_credits_remaining
    );
  END IF;

  IF prof.included_credits_remaining + prof.topup_credits_remaining < _amount THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'INSUFFICIENT_CREDITS',
      'required', _amount,
      'remaining_included', prof.included_credits_remaining,
      'remaining_topup', prof.topup_credits_remaining
    );
  END IF;

  use_included := LEAST(prof.included_credits_remaining, _amount);
  use_topup := _amount - use_included;

  PERFORM set_config('app.credit_txn', '1', true);

  UPDATE public.profiles
     SET included_credits_remaining = included_credits_remaining - use_included,
         topup_credits_remaining = topup_credits_remaining - use_topup
   WHERE id = uid
   RETURNING * INTO prof;

  PERFORM set_config('app.credit_txn', '0', true);

  INSERT INTO public.credit_ledger
    (user_id, request_id, event_type, amount, included_delta, topup_delta,
     balance_after_included, balance_after_topup, reason)
  VALUES
    (uid, _request_id, 'consume', -_amount, -use_included, -use_topup,
     prof.included_credits_remaining, prof.topup_credits_remaining, _reason);

  RETURN jsonb_build_object(
    'ok', true,
    'request_id', _request_id,
    'remaining_included', prof.included_credits_remaining,
    'remaining_topup', prof.topup_credits_remaining
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.refund_credits(_request_id text, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  consume_row public.credit_ledger;
  prior public.credit_ledger;
  prof public.profiles;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;
  IF _request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_REQUEST_ID');
  END IF;

  SELECT * INTO prior FROM public.credit_ledger
   WHERE user_id = uid AND request_id = _request_id AND event_type = 'refund'
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true, 'replayed', true,
      'remaining_included', prior.balance_after_included,
      'remaining_topup', prior.balance_after_topup
    );
  END IF;

  SELECT * INTO consume_row FROM public.credit_ledger
   WHERE user_id = uid AND request_id = _request_id AND event_type = 'consume'
   LIMIT 1;
  IF NOT FOUND THEN
    SELECT * INTO prof FROM public.profiles WHERE id = uid;
    RETURN jsonb_build_object(
      'ok', true, 'noop', true,
      'remaining_included', COALESCE(prof.included_credits_remaining, 0),
      'remaining_topup', COALESCE(prof.topup_credits_remaining, 0)
    );
  END IF;

  PERFORM set_config('app.credit_txn', '1', true);

  UPDATE public.profiles
     SET included_credits_remaining = included_credits_remaining + (-consume_row.included_delta),
         topup_credits_remaining = topup_credits_remaining + (-consume_row.topup_delta)
   WHERE id = uid
   RETURNING * INTO prof;

  PERFORM set_config('app.credit_txn', '0', true);

  INSERT INTO public.credit_ledger
    (user_id, request_id, event_type, amount, included_delta, topup_delta,
     balance_after_included, balance_after_topup, reason)
  VALUES
    (uid, _request_id, 'refund', -consume_row.amount,
     -consume_row.included_delta, -consume_row.topup_delta,
     prof.included_credits_remaining, prof.topup_credits_remaining, _reason);

  RETURN jsonb_build_object(
    'ok', true,
    'remaining_included', prof.included_credits_remaining,
    'remaining_topup', prof.topup_credits_remaining
  );
END;
$function$;
