CREATE OR REPLACE FUNCTION public._plan_credits(_plan text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _plan
    WHEN 'basic' THEN 10
    WHEN 'pro_monthly' THEN 250
    WHEN 'pro_semester' THEN 900
    WHEN 'pro_annual' THEN 3000
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public._plan_period_length(_plan text)
RETURNS interval LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _plan
    WHEN 'basic' THEN interval '1 month'
    WHEN 'pro_monthly' THEN interval '1 month'
    WHEN 'pro_semester' THEN interval '3 months'
    WHEN 'pro_annual' THEN interval '12 months'
    ELSE interval '1 month'
  END;
$$;

ALTER TABLE public.profiles
  ALTER COLUMN included_credits_remaining SET DEFAULT 10,
  ALTER COLUMN included_credits_total SET DEFAULT 10;