
CREATE OR REPLACE FUNCTION public.prevent_profile_sensitive_updates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_privileged boolean;
BEGIN
  -- Allow service_role / postgres / admin role to update any column
  is_privileged := (current_setting('role', true) IN ('service_role','postgres'))
                   OR (auth.role() = 'service_role')
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
$$;

DROP TRIGGER IF EXISTS trg_prevent_profile_sensitive_updates ON public.profiles;
CREATE TRIGGER trg_prevent_profile_sensitive_updates
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_sensitive_updates();
