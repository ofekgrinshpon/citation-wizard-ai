
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_plan_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_plan_check
  CHECK (plan IN ('trial','week','month','semester','basic','pro_monthly','pro_semester','pro_annual','admin'));

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_credits_reset_mode_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_credits_reset_mode_check
  CHECK (credits_reset_mode IN ('none','fixed_term','calendar_month','billing_period','period_bucket'));
