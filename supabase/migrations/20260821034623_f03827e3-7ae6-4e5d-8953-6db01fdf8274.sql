-- Consent record columns on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS terms_accepted_at   timestamptz,
  ADD COLUMN IF NOT EXISTS terms_version       text,
  ADD COLUMN IF NOT EXISTS privacy_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS privacy_version     text;

-- Populate consent columns at signup from auth user metadata
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
  legal_ver text;
  legal_at timestamptz;
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

  legal_ver := NULLIF(trim(NEW.raw_user_meta_data->>'legal_version'), '');
  IF legal_ver IS NOT NULL THEN
    BEGIN
      legal_at := COALESCE((NEW.raw_user_meta_data->>'legal_accepted_at')::timestamptz, now());
    EXCEPTION WHEN others THEN
      legal_at := now();
    END;
  END IF;

  INSERT INTO public.profiles (
    id, email, full_name, referral_code, referred_by_user_id,
    terms_accepted_at, terms_version, privacy_accepted_at, privacy_version
  )
  VALUES (
    NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name', new_code, resolved_referrer,
    legal_at, legal_ver, legal_at, legal_ver
  );

  RETURN NEW;
END;
$$;

-- Idempotent, tamper-resistant stamp used by the OAuth signup path.
-- Only ever fills NULL consent fields for the calling user; never overwrites.
CREATE OR REPLACE FUNCTION public.record_legal_acceptance(_version text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  already boolean;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(trim(_version), '') IS NULL THEN
    RAISE EXCEPTION 'version required' USING ERRCODE = '22023';
  END IF;

  SELECT terms_accepted_at IS NOT NULL INTO already
    FROM public.profiles WHERE id = uid;

  IF already IS NULL THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'no_profile');
  END IF;

  IF already THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'already_accepted');
  END IF;

  UPDATE public.profiles
     SET terms_accepted_at   = now(),
         terms_version       = trim(_version),
         privacy_accepted_at = now(),
         privacy_version     = trim(_version)
   WHERE id = uid;

  RETURN jsonb_build_object('recorded', true);
END;
$$;

REVOKE ALL ON FUNCTION public.record_legal_acceptance(text) FROM public;
GRANT EXECUTE ON FUNCTION public.record_legal_acceptance(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_legal_acceptance(text) TO service_role;