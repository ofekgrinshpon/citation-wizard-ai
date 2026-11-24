-- Apply after five-source-trial/runtime/setup.sql in a disposable database.
ALTER TABLE public.profiles ADD COLUMN created_at timestamptz DEFAULT now(),
  ADD COLUMN referral_bonus_granted boolean DEFAULT false, ADD COLUMN referred_by_user_id uuid;
CREATE TABLE public.citation_trial_config(singleton boolean PRIMARY KEY,enabled boolean NOT NULL);
INSERT INTO public.citation_trial_config VALUES(true,true);
CREATE TABLE public.citation_referral_config(singleton boolean PRIMARY KEY,enabled boolean NOT NULL,activated_at timestamptz);
INSERT INTO public.citation_referral_config VALUES(true,false,NULL);
CREATE TABLE public.citation_referral_awards(referee_id uuid PRIMARY KEY,referrer_id uuid);
CREATE TABLE public.citation_trial_sources(user_id uuid,request_id text,fingerprint text,route text,state text,PRIMARY KEY(user_id,request_id));
CREATE FUNCTION public._citation_source_bonus(uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
