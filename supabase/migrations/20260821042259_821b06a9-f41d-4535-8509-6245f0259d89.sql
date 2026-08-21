CREATE OR REPLACE FUNCTION public._backfill_plans_beta()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.credit_txn', '1', true);
  UPDATE public.profiles
     SET included_credits_total = 10,
         included_credits_remaining = LEAST(included_credits_remaining, 10)
   WHERE plan = 'basic';
  UPDATE public.profiles
     SET included_credits_total = 900,
         included_credits_remaining = LEAST(included_credits_remaining, 900)
   WHERE plan = 'pro_semester';
  UPDATE public.profiles
     SET included_credits_total = 3000,
         included_credits_remaining = LEAST(included_credits_remaining, 3000)
   WHERE plan = 'pro_annual';
END;
$$;

SELECT public._backfill_plans_beta();

DROP FUNCTION public._backfill_plans_beta();