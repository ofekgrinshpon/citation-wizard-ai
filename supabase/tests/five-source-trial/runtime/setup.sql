\set ON_ERROR_STOP on
-- New isolated lab schema; synthetic identities only. No original fixture loaded.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE TYPE public.app_role AS ENUM('admin','user');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('lab.uid',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('lab.role',true),'') $$;
CREATE FUNCTION private.has_role(uuid,public.app_role) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public._plan_is_paid(text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT $1 IN ('month','week','semester','pro_annual') $$;
CREATE FUNCTION public._plan_window_limit(text) RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 1000 $$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY, plan text NOT NULL DEFAULT 'trial', included_credits_remaining int DEFAULT 100,topup_credits_remaining int DEFAULT 0,legacy_bonus_remaining int DEFAULT 0,window_started_at timestamptz,window_units_used int DEFAULT 0,billing_period_started_at timestamptz DEFAULT now(),billing_period_ends_at timestamptz);
CREATE TABLE public.credit_ledger(id uuid DEFAULT gen_random_uuid(),user_id uuid,request_id text,event_type text,amount int,included_delta int,topup_delta int,legacy_delta int,balance_after_included int,balance_after_topup int,reason text,metadata jsonb,created_at timestamptz DEFAULT now());
CREATE TABLE public.citation_usage_requests(user_id uuid,request_id text,fingerprint text,batch_id text,retry_of_request_id text,batch_anchor_request_id text,charged_units int,state text,attempt_token uuid,created_at timestamptz DEFAULT now(),finished_at timestamptz,result_fingerprint text,terminal_reason text,PRIMARY KEY(user_id,request_id),UNIQUE(user_id,retry_of_request_id));
CREATE TABLE public.citation_recovery_payloads(user_id uuid,request_id text,input jsonb,result jsonb,expires_at timestamptz,PRIMARY KEY(user_id,request_id));
CREATE TABLE public.usage_terminal_failures(user_id uuid,request_id text,source text,reason text,PRIMARY KEY(user_id,request_id));
CREATE FUNCTION public._require_usage_service() RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service identity required'; END IF; END $$;
-- Validators deliberately stubbed: this lab verifies accounting, not input parser.
CREATE FUNCTION public._citation_recovery_valid(jsonb,text) RETURNS boolean LANGUAGE sql AS $$ SELECT jsonb_typeof($1)='object' $$;
CREATE FUNCTION public._citation_execution_fingerprint(jsonb) RETURNS text LANGUAGE sql AS $$ SELECT $1->>'fingerprint' $$;
CREATE FUNCTION public._citation_canonical_json(jsonb) RETURNS text LANGUAGE sql AS $$ SELECT $1::text $$;
CREATE FUNCTION public.refund_credits_for_user(uuid,text,text) RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Legacy paid refund outside this synthetic lab'; END $$;
CREATE FUNCTION public.lab_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'assertion failed: %',label; END IF; END $$;
GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role,anon;
GRANT EXECUTE ON FUNCTION auth.uid(),auth.role() TO authenticated,service_role,anon;
