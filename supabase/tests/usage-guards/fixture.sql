-- AUTHORED ONLY. Do not execute without separate approval, even in a fixture cluster.
\set ON_ERROR_STOP on
-- ONLY for a fresh, disposable PostgreSQL cluster, never an existing app DB.
-- The outer test runner must create a database named relex_usage_fixture_<suffix>.
DO $$ BEGIN
  IF current_database() NOT LIKE 'relex_usage_fixture_%' THEN
    RAISE EXCEPTION 'Refusing non-fixture database';
  END IF;
  IF to_regclass('public.profiles') IS NOT NULL OR to_regclass('auth.users') IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing a database with existing application tables';
  END IF;
END $$;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
-- Supabase normally supplies postgres; use a cluster initialized as postgres.
CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT current_setting('request.jwt.claims', true)::jsonb->>'role';
$$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (current_setting('request.jwt.claims', true)::jsonb->>'sub')::uuid;
$$;
CREATE FUNCTION private.has_role(uuid, public.app_role) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false; $$;
CREATE FUNCTION public._plan_is_paid(text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT $1 IN ('week', 'month', 'semester', 'pro_monthly', 'pro_semester', 'pro_annual');
$$;
CREATE FUNCTION public._plan_window_limit(text) RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE $1 WHEN 'trial' THEN 15 WHEN 'week' THEN 20 WHEN 'month' THEN 25
    WHEN 'semester' THEN 30 WHEN 'basic' THEN 15 WHEN 'pro_monthly' THEN 25
    WHEN 'pro_semester' THEN 30 WHEN 'pro_annual' THEN 30 ELSE 0 END;
$$;
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  plan text NOT NULL DEFAULT 'month',
  included_credits_remaining integer NOT NULL DEFAULT 140,
  topup_credits_remaining integer NOT NULL DEFAULT 0,
  legacy_bonus_remaining integer NOT NULL DEFAULT 0,
  window_started_at timestamptz,
  window_units_used integer NOT NULL DEFAULT 0,
  billing_period_started_at timestamptz DEFAULT now(),
  billing_period_ends_at timestamptz
);
CREATE TABLE public.credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id), request_id text NOT NULL,
  event_type text NOT NULL, amount integer NOT NULL,
  included_delta integer NOT NULL DEFAULT 0, topup_delta integer NOT NULL DEFAULT 0,
  legacy_delta integer NOT NULL DEFAULT 0,
  balance_after_included integer NOT NULL, balance_after_topup integer NOT NULL,
  reason text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, request_id, event_type)
);
CREATE TABLE public.legal_research_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
  credit_request_id text, status text NOT NULL, result jsonb, error text,
  project_id uuid, question text, current_stage text, progress_label_he text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  last_progress_at timestamptz, completed_at timestamptz
);
CREATE TABLE public.qa_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, project_id uuid,
  question text, answer text, task_mode text, footnotes jsonb,
  local_footnotes_count integer, perplexity_footnotes_count integer,
  total_footnotes integer, metadata jsonb
);
GRANT USAGE ON SCHEMA public, auth, private TO anon, authenticated, service_role;
GRANT ALL ON public.profiles, public.credit_ledger, public.legal_research_jobs, public.qa_logs TO service_role;
-- Match baseline owner ledger read and profile guard behavior relevant here.
GRANT SELECT ON public.credit_ledger TO authenticated;
ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_ledger_read ON public.credit_ledger FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE FUNCTION public.fixture_profile_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND current_setting('role', true) NOT IN ('none', 'postgres', 'service_role') THEN
    RAISE EXCEPTION 'Profile accounting mutation denied' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fixture_profile_guard BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fixture_profile_guard();

\ir ../../migration-drafts/20261013100000_citation_request_refund_guards.sql

CREATE FUNCTION public.fixture_assert(condition boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', message; END IF;
END $$;


-- Test-only adapters keep historical accounting/race fixtures focused on their
-- original cases while supplying protocol-3 synthetic bodies and actual hashes.
-- These are never part of application migrations and are NOT executed here.
CREATE FUNCTION public.fixture_execution_input(_marker text, _batch_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('messages', jsonb_build_array(jsonb_build_object('role','user','content','Synthetic citation ' || _marker)),
    'rawInput', NULL, 'foreignLookup', NULL, 'batchId', _batch_id);
$$;
CREATE FUNCTION public.fixture_begin_citation_request(
  _user_id uuid, _request_id text, _marker text, _batch_id text DEFAULT NULL, _parent text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE input_body jsonb := public.fixture_execution_input(_marker, _batch_id);
BEGIN
  -- Preserve the internal service check before calling private encoding helpers.
  PERFORM public._require_usage_service();
  RETURN public.begin_citation_request(_user_id, _request_id,
    public._citation_execution_fingerprint(input_body), _batch_id, _parent, input_body);
END;
$$;
CREATE FUNCTION public.fixture_finish_citation_request(
  _user_id uuid, _request_id text, _token uuid, _outcome text, _reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.finish_citation_request(_user_id, _request_id, _token, _outcome, _reason,
    CASE WHEN _outcome = 'succeeded' THEN jsonb_build_object('content', 'Synthetic delivered citation') ELSE NULL END);
$$;
