-- Google sign-up referral attribution only; keep dormant until coordinated release.
-- Rules and privileges for earning/issuing citation bonuses are unchanged.
BEGIN;

CREATE TABLE public.google_referral_config (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 enabled boolean NOT NULL DEFAULT false,
 activated_at timestamptz,
 CHECK(NOT enabled OR activated_at IS NOT NULL)
);
INSERT INTO public.google_referral_config(singleton) VALUES(true);

CREATE TABLE private.google_referral_signing_key (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 signing_key bytea NOT NULL CHECK(octet_length(signing_key)=32)
);
INSERT INTO private.google_referral_signing_key(signing_key) VALUES(extensions.gen_random_bytes(32));

-- Anonymous intent creation is stateless. Only successful new sign-ups can create
-- a receipt. Preserve uniqueness even in case an auth account is later removed.
CREATE TABLE private.google_referral_claims (
 nonce text PRIMARY KEY CHECK(nonce ~ '^[0-9a-f]{32}$'),
 referee_id uuid UNIQUE NOT NULL,
 claimed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.google_referral_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.google_referral_signing_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.google_referral_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.google_referral_config FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE private.google_referral_signing_key,private.google_referral_claims FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,UPDATE ON TABLE public.google_referral_config TO service_role;

CREATE FUNCTION public.get_google_referral_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(
   SELECT 1 FROM public.google_referral_config g JOIN public.citation_referral_config c USING(singleton)
   WHERE g.singleton AND g.enabled AND c.enabled AND g.activated_at IS NOT NULL AND c.activated_at IS NOT NULL
 );
$$;
REVOKE ALL ON FUNCTION public.get_google_referral_enabled() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_google_referral_enabled() TO anon,authenticated,service_role;

CREATE FUNCTION public.begin_google_referral_intent(_referral_code text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE code text; key_bytes bytea; payload text;
BEGIN
 IF _referral_code IS NULL OR octet_length(_referral_code)>16 OR NOT public.get_google_referral_enabled() THEN
   RETURN jsonb_build_object('ok',false);
 END IF;
 code:=upper(btrim(_referral_code) COLLATE "C");
 IF code !~ '^[A-HJ-NP-Z2-9]{8}$' THEN RETURN jsonb_build_object('ok',false); END IF;

 SELECT signing_key INTO STRICT key_bytes FROM private.google_referral_signing_key WHERE singleton;
 -- Issue time represented as integer microseconds. Token includes only the
 -- public referral code, time, random nonce and signature. No raw ids/emails.
 -- We sign syntactically valid codes without looking them up, so this is not
 -- an anonymous oracle for valid users/codes.
 payload:='v1.'||code||'.'||floor(extract(epoch FROM clock_timestamp())*1000000)::bigint::text||'.'
          ||encode(extensions.gen_random_bytes(16),'hex');
 RETURN jsonb_build_object('ok',true,'token',payload||'.'||encode(
   extensions.hmac(convert_to('relex-google-referral:'||payload,'UTF8'),key_bytes,'sha256'),'hex'
 ));
END;
$$;
REVOKE ALL ON FUNCTION public.begin_google_referral_intent(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.begin_google_referral_intent(text) TO anon,authenticated;

CREATE FUNCTION public.claim_google_referral_intent(_token text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE deny CONSTANT jsonb:=jsonb_build_object('ok',false,'claimed',false);
  acct uuid:=auth.uid();
  session_text text:=auth.jwt()->>'session_id';
  cur_session uuid; key_bytes bytea; expected bytea; supplied bytea;
  code text; token_nonce text; payload text; issued_at timestamptz; checked_at timestamptz;
  citation_enabled boolean; citation_activated timestamptz;
  google_enabled boolean; google_activated timestamptz; referrer uuid;
  p public.profiles%ROWTYPE; updated_count integer; prior_txn text;
BEGIN
 IF acct IS NULL OR _token IS NULL OR octet_length(_token)<>126 OR
    _token COLLATE "C" !~ '^v1\.[A-HJ-NP-Z2-9]{8}\.[0-9]{16}\.[0-9a-f]{32}\.[0-9a-f]{64}$' OR
    session_text IS NULL OR session_text COLLATE "C" !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
   RETURN deny;
 END IF;
 cur_session:=session_text::uuid;
 payload:=left(_token,length(_token)-65);
 supplied:=decode(split_part(_token,'.',5),'hex');
 SELECT signing_key INTO STRICT key_bytes FROM private.google_referral_signing_key WHERE singleton;
 expected:=extensions.hmac(convert_to('relex-google-referral:'||payload,'UTF8'),key_bytes,'sha256');
 -- Compare digests of supplied/expected MAC to avoid timing leaks from bytea equality.
 IF extensions.hmac(supplied,key_bytes,'sha256')<>extensions.hmac(expected,key_bytes,'sha256') THEN
   RETURN deny;
 END IF;
 issued_at:=to_timestamp(split_part(_token,'.',3)::bigint::double precision/1000000);
 code:=split_part(_token,'.',2);
 token_nonce:=split_part(_token,'.',4);
 checked_at:=clock_timestamp();
 IF issued_at>checked_at OR issued_at<=checked_at-interval '15 minutes' THEN RETURN deny; END IF;

 -- Same shared config/owner lock order as the award path; keep disable and
 -- activation serialized against a claim. No cross-profile update or row lock.
 SELECT enabled,activated_at INTO citation_enabled,citation_activated
 FROM public.citation_referral_config WHERE singleton FOR SHARE;
 SELECT enabled,activated_at INTO google_enabled,google_activated
 FROM public.google_referral_config WHERE singleton FOR SHARE;
 IF citation_enabled IS DISTINCT FROM true OR google_enabled IS DISTINCT FROM true OR
    citation_activated IS NULL OR google_activated IS NULL OR
    issued_at<greatest(citation_activated,google_activated) THEN RETURN deny; END IF;

 -- Provider and verification evidence are trusted auth rows, never
 -- raw_user_meta_data. A Google identity linked onto a password account,
 -- an existing Google re-login, or non-OAuth session does not qualify.
 IF NOT EXISTS (
   SELECT 1 FROM auth.users a
   JOIN auth.identities i ON i.user_id=a.id AND i.provider='google'
   JOIN auth.sessions s ON s.user_id=a.id AND s.id=cur_session
   WHERE a.id=acct AND a.deleted_at IS NULL AND NOT a.is_anonymous AND NOT a.is_sso_user
     AND a.created_at>=issued_at AND a.created_at<=checked_at
     AND a.email_confirmed_at IS NOT NULL AND a.email_confirmed_at>=issued_at
     AND a.raw_app_meta_data->>'provider'='google'
     AND a.raw_app_meta_data->'providers'='["google"]'::jsonb
     AND i.created_at>=issued_at AND i.created_at<=checked_at
     AND abs(extract(epoch FROM i.created_at-a.created_at))<=5
     AND lower(i.email)=lower(a.email) AND i.identity_data->'email_verified'='true'::jsonb
     AND s.created_at>=issued_at AND s.created_at<=checked_at
     AND abs(extract(epoch FROM s.created_at-a.created_at))<=120
     AND (s.not_after IS NULL OR s.not_after>checked_at)
     AND EXISTS(SELECT 1 FROM auth.mfa_amr_claims m WHERE m.session_id=s.id AND m.authentication_method='oauth')
     AND NOT EXISTS(SELECT 1 FROM auth.identities x WHERE x.user_id=a.id AND x.provider<>'google')
 ) THEN RETURN deny; END IF;

 SELECT * INTO p FROM public.profiles WHERE id=acct FOR NO KEY UPDATE;
 IF NOT FOUND OR p.created_at IS NULL OR p.created_at<issued_at OR p.created_at>checked_at THEN RETURN deny; END IF;
 -- Check expiry again after waiting for account lock. Idempotent callback
 -- repeat can tell the same account it was claimed without exposing who sent it.
 IF issued_at<=clock_timestamp()-interval '15 minutes' THEN RETURN deny; END IF;
 IF EXISTS (SELECT 1 FROM private.google_referral_claims WHERE nonce=token_nonce AND referee_id=acct) THEN
   RETURN jsonb_build_object('ok',true,'claimed',true,'replayed',true);
 END IF;
 IF p.referred_by_user_id IS NOT NULL OR p.referral_bonus_granted OR p.referral_first_action_at IS NOT NULL OR
    EXISTS(SELECT 1 FROM public.citation_trial_sources WHERE user_id=acct) OR
    EXISTS(SELECT 1 FROM public.citation_usage_requests WHERE user_id=acct) OR
    EXISTS(SELECT 1 FROM public.citation_referral_awards WHERE referee_id=acct) OR
    EXISTS(SELECT 1 FROM public.credit_ledger WHERE user_id=acct AND event_type='referral_bonus') THEN RETURN deny; END IF;

 SELECT id INTO referrer FROM public.profiles WHERE referral_code=code AND id<>acct AND created_at<=issued_at LIMIT 1;
 IF referrer IS NULL THEN RETURN deny; END IF;
 INSERT INTO private.google_referral_claims(nonce,referee_id) VALUES(token_nonce,acct) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN deny; END IF;

 -- Reuse the existing scoped trusted-writer mechanism; static single-column
 -- owner write only. Restore the prior transaction setting even on exception;
 -- the subtransaction rolls the setting and update back if it errors.
 prior_txn:=current_setting('app.credit_txn',true);
 BEGIN
   PERFORM set_config('app.credit_txn','1',true);
   UPDATE public.profiles SET referred_by_user_id=referrer WHERE id=acct AND referred_by_user_id IS NULL;
   GET DIAGNOSTICS updated_count=ROW_COUNT;
   PERFORM set_config('app.credit_txn',COALESCE(prior_txn,''),true);
 EXCEPTION WHEN OTHERS THEN
   RAISE;
 END;
 IF updated_count<>1 THEN
   RAISE EXCEPTION 'Referral attribution was not completed' USING ERRCODE='40001';
 END IF;
 RETURN jsonb_build_object('ok',true,'claimed',true);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_google_referral_intent(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_google_referral_intent(text) TO authenticated;

COMMIT;
