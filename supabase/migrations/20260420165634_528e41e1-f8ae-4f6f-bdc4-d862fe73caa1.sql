-- =========================================================
-- 1. PROFILES — new credit + referral columns
-- =========================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'basic',
  ADD COLUMN IF NOT EXISTS included_credits_remaining int NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS included_credits_total int NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS topup_credits_remaining int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS billing_period_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS billing_period_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS credits_reset_mode text NOT NULL DEFAULT 'calendar_month',
  ADD COLUMN IF NOT EXISTS referral_code text,
  ADD COLUMN IF NOT EXISTS referred_by_user_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS referral_bonus_granted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS referral_first_action_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_plan_check'
  ) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_plan_check
      CHECK (plan IN ('basic','pro_monthly','pro_semester','pro_annual','admin'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_credits_reset_mode_check'
  ) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_credits_reset_mode_check
      CHECK (credits_reset_mode IN ('calendar_month','billing_period','period_bucket','none'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_referral_code_unique
  ON public.profiles (referral_code) WHERE referral_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS profiles_referred_by_idx
  ON public.profiles (referred_by_user_id);

-- =========================================================
-- 2. CREDIT LEDGER
-- =========================================================

CREATE TABLE IF NOT EXISTS public.credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN
    ('consume','refund','topup','renewal','admin_adjustment','referral_bonus','signup_bonus')),
  amount int NOT NULL,
  included_delta int NOT NULL DEFAULT 0,
  topup_delta int NOT NULL DEFAULT 0,
  balance_after_included int NOT NULL,
  balance_after_topup int NOT NULL,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_user_request_event_uniq
  ON public.credit_ledger (user_id, request_id, event_type);

CREATE INDEX IF NOT EXISTS credit_ledger_user_created_idx
  ON public.credit_ledger (user_id, created_at DESC);

ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own ledger" ON public.credit_ledger;
CREATE POLICY "Users read own ledger" ON public.credit_ledger
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins read all ledger" ON public.credit_ledger;
CREATE POLICY "Admins read all ledger" ON public.credit_ledger
  FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role));

-- No INSERT/UPDATE/DELETE policies → only security-definer RPCs may write.

-- =========================================================
-- 3. PLAN HELPERS
-- =========================================================

CREATE OR REPLACE FUNCTION public._plan_credits(_plan text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _plan
    WHEN 'basic' THEN 20
    WHEN 'pro_monthly' THEN 250
    WHEN 'pro_semester' THEN 1100
    WHEN 'pro_annual' THEN 3600
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public._plan_reset_mode(_plan text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _plan
    WHEN 'basic' THEN 'calendar_month'
    WHEN 'pro_monthly' THEN 'billing_period'
    WHEN 'pro_semester' THEN 'period_bucket'
    WHEN 'pro_annual' THEN 'period_bucket'
    WHEN 'admin' THEN 'none'
    ELSE 'calendar_month'
  END;
$$;

CREATE OR REPLACE FUNCTION public._plan_period_length(_plan text)
RETURNS interval LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _plan
    WHEN 'basic' THEN interval '1 month'
    WHEN 'pro_monthly' THEN interval '1 month'
    WHEN 'pro_semester' THEN interval '4 months'
    WHEN 'pro_annual' THEN interval '12 months'
    ELSE interval '1 month'
  END;
$$;

-- =========================================================
-- 4. REFERRAL CODE GENERATOR
-- =========================================================

CREATE OR REPLACE FUNCTION public._generate_referral_code()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/1/I/O
  code text;
  i int;
  exists_already boolean;
BEGIN
  LOOP
    code := '';
    FOR i IN 1..8 LOOP
      code := code || substr(alphabet, 1 + (floor(random() * length(alphabet)))::int, 1);
    END LOOP;
    SELECT EXISTS(SELECT 1 FROM public.profiles WHERE referral_code = code) INTO exists_already;
    IF NOT exists_already THEN
      RETURN code;
    END IF;
  END LOOP;
END;
$$;

-- =========================================================
-- 5. consume_credits / refund_credits
-- =========================================================

CREATE OR REPLACE FUNCTION public.consume_credits(_amount int, _reason text, _request_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Idempotency: replay prior consume result
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

  -- Lock profile row
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

  UPDATE public.profiles
     SET included_credits_remaining = included_credits_remaining - use_included,
         topup_credits_remaining = topup_credits_remaining - use_topup
   WHERE id = uid
   RETURNING * INTO prof;

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
$$;

CREATE OR REPLACE FUNCTION public.refund_credits(_request_id text, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Idempotent: prior refund?
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
    -- No matching consume; defensive ok no-op
    SELECT * INTO prof FROM public.profiles WHERE id = uid;
    RETURN jsonb_build_object(
      'ok', true, 'noop', true,
      'remaining_included', COALESCE(prof.included_credits_remaining, 0),
      'remaining_topup', COALESCE(prof.topup_credits_remaining, 0)
    );
  END IF;

  -- consume row stores negative deltas; refund restores positive
  UPDATE public.profiles
     SET included_credits_remaining = included_credits_remaining + (-consume_row.included_delta),
         topup_credits_remaining = topup_credits_remaining + (-consume_row.topup_delta)
   WHERE id = uid
   RETURNING * INTO prof;

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
$$;

-- =========================================================
-- 6. add_topup_credits / set_user_plan / reset_or_renew_credits
-- =========================================================

CREATE OR REPLACE FUNCTION public.add_topup_credits(_user_id uuid, _amount int, _reason text DEFAULT 'admin top-up')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  UPDATE public.profiles
     SET topup_credits_remaining = topup_credits_remaining + _amount
   WHERE id = _user_id
   RETURNING * INTO prof;

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

  RETURN jsonb_build_object(
    'ok', true,
    'remaining_included', prof.included_credits_remaining,
    'remaining_topup', prof.topup_credits_remaining
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_user_plan(_user_id uuid, _new_plan text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  IF _new_plan NOT IN ('basic','pro_monthly','pro_semester','pro_annual','admin') THEN
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
         billing_period_started_at = CASE WHEN _new_plan = 'admin' THEN NULL ELSE now() END,
         billing_period_ends_at = CASE WHEN _new_plan = 'admin' THEN NULL ELSE now() + period END,
         is_subscribed = (_new_plan <> 'basic')
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

  RETURN jsonb_build_object('ok', true, 'plan', _new_plan,
    'remaining_included', prof.included_credits_remaining,
    'remaining_topup', prof.topup_credits_remaining);
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_or_renew_credits()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  allowance int;
  period interval;
  affected int := 0;
  req_id text;
  prof public.profiles;
BEGIN
  FOR rec IN
    SELECT * FROM public.profiles
     WHERE plan <> 'admin'
       AND (
         (credits_reset_mode = 'calendar_month'
            AND (billing_period_ends_at IS NULL OR billing_period_ends_at <= now()))
         OR (credits_reset_mode IN ('billing_period','period_bucket')
            AND billing_period_ends_at IS NOT NULL
            AND billing_period_ends_at <= now())
       )
  LOOP
    allowance := public._plan_credits(rec.plan);
    period := public._plan_period_length(rec.plan);
    req_id := 'renew:' || rec.id::text || ':' || extract(epoch from now())::bigint::text;

    UPDATE public.profiles
       SET included_credits_remaining = allowance,
           included_credits_total = allowance,
           billing_period_started_at = now(),
           billing_period_ends_at = now() + period
     WHERE id = rec.id
     RETURNING * INTO prof;

    INSERT INTO public.credit_ledger
      (user_id, request_id, event_type, amount, included_delta, topup_delta,
       balance_after_included, balance_after_topup, reason)
    VALUES
      (rec.id, req_id, 'renewal', allowance, allowance, 0,
       prof.included_credits_remaining, prof.topup_credits_remaining,
       'period renewal for ' || rec.plan)
    ON CONFLICT (user_id, request_id, event_type) DO NOTHING;

    affected := affected + 1;
  END LOOP;

  RETURN affected;
END;
$$;

-- =========================================================
-- 7. REFERRAL BONUS
-- =========================================================

CREATE OR REPLACE FUNCTION public.grant_referral_bonus_if_eligible(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  referee public.profiles;
  referrer public.profiles;
  bonus int := 10;
  ref_req_referee text;
  ref_req_referrer text;
BEGIN
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
$$;

-- Trigger on credit_ledger to grant referral bonus after first real consumption
CREATE OR REPLACE FUNCTION public._trg_grant_referral_on_first_consume()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.event_type = 'consume' AND NEW.amount < 0 THEN
    PERFORM public.grant_referral_bonus_if_eligible(NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_grant_referral_on_first_consume ON public.credit_ledger;
CREATE TRIGGER trg_grant_referral_on_first_consume
AFTER INSERT ON public.credit_ledger
FOR EACH ROW EXECUTE FUNCTION public._trg_grant_referral_on_first_consume();

-- =========================================================
-- 8. handle_new_user — add referral code + referrer link
-- =========================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ref_code_input text;
  resolved_referrer uuid;
  new_code text;
BEGIN
  new_code := public._generate_referral_code();
  ref_code_input := NULLIF(trim(NEW.raw_user_meta_data->>'referral_code'), '');

  IF ref_code_input IS NOT NULL THEN
    SELECT id INTO resolved_referrer
      FROM public.profiles
     WHERE referral_code = upper(ref_code_input)
     LIMIT 1;
    -- prevent self-referral
    IF resolved_referrer = NEW.id THEN
      resolved_referrer := NULL;
    END IF;
  END IF;

  INSERT INTO public.profiles (id, email, full_name, referral_code, referred_by_user_id)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name', new_code, resolved_referrer);

  RETURN NEW;
END;
$$;

-- =========================================================
-- 9. BACKFILL EXISTING USERS
-- =========================================================

-- Generate referral codes for existing profiles
DO $$
DECLARE
  r record;
  c text;
BEGIN
  FOR r IN SELECT id FROM public.profiles WHERE referral_code IS NULL LOOP
    c := public._generate_referral_code();
    UPDATE public.profiles SET referral_code = c WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE public.profiles
  ALTER COLUMN referral_code SET NOT NULL;

-- Plan backfill
UPDATE public.profiles p
   SET plan = 'admin',
       credits_reset_mode = 'none',
       included_credits_total = 0,
       included_credits_remaining = 0,
       billing_period_started_at = NULL,
       billing_period_ends_at = NULL
 WHERE EXISTS (SELECT 1 FROM public.user_roles ur
                 WHERE ur.user_id = p.id AND ur.role = 'admin');

UPDATE public.profiles p
   SET plan = 'pro_monthly',
       credits_reset_mode = 'billing_period',
       included_credits_total = 250,
       included_credits_remaining = 250,
       billing_period_started_at = now(),
       billing_period_ends_at = now() + interval '1 month'
 WHERE p.is_subscribed = true
   AND p.plan = 'basic'
   AND NOT EXISTS (SELECT 1 FROM public.user_roles ur
                     WHERE ur.user_id = p.id AND ur.role = 'admin');

UPDATE public.profiles p
   SET credits_reset_mode = 'calendar_month',
       included_credits_total = 20,
       included_credits_remaining = 20,
       billing_period_started_at = date_trunc('month', now()),
       billing_period_ends_at = date_trunc('month', now()) + interval '1 month'
 WHERE p.plan = 'basic'
   AND p.billing_period_ends_at IS NULL;

-- =========================================================
-- 10. CRON — daily renewal job
-- =========================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Drop prior job if it exists, then re-schedule
DO $$
DECLARE
  jid int;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'reset_or_renew_credits_daily';
  IF jid IS NOT NULL THEN
    PERFORM cron.unschedule(jid);
  END IF;
END $$;

SELECT cron.schedule(
  'reset_or_renew_credits_daily',
  '0 3 * * *',
  $$ SELECT public.reset_or_renew_credits(); $$
);