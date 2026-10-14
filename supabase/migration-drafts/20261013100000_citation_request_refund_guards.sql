-- LOCAL REVIEW DRAFT ONLY. This file is deliberately outside supabase/migrations.
-- DO NOT APPLY to an existing/local/shared/live database or promote automatically.
-- Review the accompanying rollout notes and migrate all legacy refund callers first.
-- DO NOT EXECUTE, including synthetic fixtures. SQL tests are authored for later approval only.

BEGIN;

CREATE TABLE public.citation_usage_requests (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  request_id text NOT NULL CHECK (length(request_id) BETWEEN 4 AND 200),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  batch_id text CHECK (batch_id IS NULL OR length(batch_id) BETWEEN 4 AND 200),
  batch_anchor_request_id text,
  retry_of_request_id text,
  charged_units integer NOT NULL CHECK (charged_units IN (0, 1)),
  state text NOT NULL CHECK (state IN ('in_progress', 'succeeded', 'failed', 'unknown')),
  attempt_token uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  terminal_reason text,
  result_fingerprint text CHECK (result_fingerprint IS NULL OR result_fingerprint ~ '^[0-9a-f]{64}$'),
  CHECK ((state = 'succeeded') = (result_fingerprint IS NOT NULL)),
  PRIMARY KEY (user_id, request_id),
  UNIQUE (user_id, retry_of_request_id),
  FOREIGN KEY (user_id, retry_of_request_id)
    REFERENCES public.citation_usage_requests(user_id, request_id),
  CHECK (retry_of_request_id IS NULL OR retry_of_request_id <> request_id),
  FOREIGN KEY (user_id, batch_anchor_request_id)
    REFERENCES public.citation_usage_requests(user_id, request_id),
  CHECK ((state = 'in_progress') = (finished_at IS NULL)),
  CHECK (batch_id IS NOT NULL OR batch_anchor_request_id IS NULL)
);
CREATE INDEX citation_usage_requests_batch_idx
  ON public.citation_usage_requests(user_id, batch_id, created_at DESC);


-- Only this side table contains 24-hour recovery content. Claims, accounting and
-- separately saved history are never removed by recovery cleanup.
CREATE TABLE public.citation_recovery_payloads (
  user_id uuid NOT NULL,
  request_id text NOT NULL,
  input jsonb NOT NULL,
  result jsonb,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, request_id),
  FOREIGN KEY (user_id, request_id)
    REFERENCES public.citation_usage_requests(user_id, request_id) ON DELETE CASCADE
);
CREATE INDEX citation_recovery_payloads_expiry_idx ON public.citation_recovery_payloads(expires_at);
CREATE INDEX citation_usage_requests_recovery_list_idx ON public.citation_usage_requests(user_id, created_at DESC, request_id DESC);
ALTER TABLE public.citation_recovery_payloads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.citation_recovery_payloads FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.citation_recovery_payloads TO service_role;
-- No owner policies, no owner direct SELECT, no change to existing history RLS.

-- This is a service attestation, never an owner-supplied reason or job status.
CREATE TABLE public.usage_terminal_failures (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  request_id text NOT NULL,
  source text NOT NULL CHECK (source IN ('citation', 'legacy_service')),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, request_id)
);

ALTER TABLE public.citation_usage_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_terminal_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.citation_usage_requests, public.usage_terminal_failures FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.citation_usage_requests, public.usage_terminal_failures TO service_role;
-- No owner policies: request status, fingerprints, tokens, and attestations are service-only.

CREATE OR REPLACE FUNCTION public._require_usage_service()
RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  -- current_user is a SECURITY DEFINER owner and is NOT caller authentication.
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND COALESCE(current_setting('role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service identity required' USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._require_usage_service() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._require_usage_service() TO service_role;

-- A read-only accounting receipt is derived from the charged request/group,
-- never inferred from execution failure. Profile locking keeps its ledger and
-- sibling-state snapshot consistent with all draft mutations.
CREATE OR REPLACE FUNCTION public._citation_refund_receipt(_user_id uuid, _request_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  prof public.profiles;
  request public.citation_usage_requests;
  anchor public.citation_usage_requests;
  consumed public.credit_ledger;
  refunded_row public.credit_ledger;
  billing_id text;
  status text := 'unconfirmed';
BEGIN
  PERFORM public._require_usage_service();
  SELECT * INTO prof FROM public.profiles WHERE id = _user_id FOR UPDATE;
  SELECT * INTO request FROM public.citation_usage_requests
    WHERE user_id = _user_id AND request_id = _request_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'unconfirmed', 'refunded', false,
      'units_refunded', 0, 'request_id', _request_id);
  END IF;
  billing_id := COALESCE(request.batch_anchor_request_id, request.request_id);
  IF request.state <> 'failed' THEN
    RETURN jsonb_build_object('status', 'not_applicable', 'refunded', false,
      'units_refunded', 0, 'request_id', billing_id);
  END IF;
  SELECT * INTO anchor FROM public.citation_usage_requests
    WHERE user_id = _user_id AND request_id = billing_id;
  SELECT * INTO consumed FROM public.credit_ledger
    WHERE user_id = _user_id AND request_id = billing_id AND event_type = 'consume';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'unconfirmed', 'refunded', false,
      'units_refunded', 0, 'request_id', billing_id);
  END IF;
  SELECT * INTO refunded_row FROM public.credit_ledger
    WHERE user_id = _user_id AND request_id = billing_id AND event_type = 'refund' AND amount > 0;
  IF FOUND THEN
    RETURN jsonb_build_object('status', 'refunded', 'refunded', true,
      'units_refunded', refunded_row.amount, 'request_id', billing_id);
  END IF;
  IF consumed.included_delta = 0 AND consumed.topup_delta = 0 AND consumed.legacy_delta = 0 THEN
    status := 'not_charged';
  ELSIF anchor.state IN ('succeeded', 'unknown') THEN
    status := 'retained';
  ELSIF anchor.state = 'in_progress' THEN
    status := 'deferred';
  ELSIF consumed.included_delta < 0 AND (
       consumed.metadata->>'plan' IS DISTINCT FROM prof.plan
       OR CASE WHEN consumed.metadata ? 'billing_period_started_at' THEN
         (consumed.metadata->>'billing_period_started_at')::timestamptz IS DISTINCT FROM prof.billing_period_started_at
       ELSE prof.billing_period_started_at IS NULL OR consumed.created_at < prof.billing_period_started_at END
     ) THEN
    status := 'review_required';
  ELSIF EXISTS (SELECT 1 FROM public.citation_usage_requests sibling
    WHERE sibling.user_id = _user_id AND sibling.batch_anchor_request_id = billing_id
      AND sibling.state IN ('succeeded', 'unknown')) THEN
    status := 'retained';
  ELSIF EXISTS (SELECT 1 FROM public.citation_usage_requests sibling
    WHERE sibling.user_id = _user_id AND sibling.batch_anchor_request_id = billing_id
      AND sibling.state = 'in_progress') THEN
    status := 'deferred';
  END IF;
  RETURN jsonb_build_object('status', status, 'refunded', false,
    'units_refunded', 0, 'request_id', billing_id);
END;
$$;
REVOKE ALL ON FUNCTION public._citation_refund_receipt(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._citation_refund_receipt(uuid, text) TO service_role;


-- Deterministic encoding matches citationFingerprint for this allowlisted
-- string/boolean/integer-only execution contract. Object keys are ASCII.
CREATE OR REPLACE FUNCTION public._citation_canonical_json(_value jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE encoded text;
BEGIN
  CASE jsonb_typeof(_value)
  WHEN 'object' THEN
    SELECT '{' || COALESCE(string_agg(to_jsonb(e.key)::text || ':' || public._citation_canonical_json(e.value), ',' ORDER BY e.key COLLATE "C"), '') || '}'
      INTO encoded FROM jsonb_each(_value) e;
  WHEN 'array' THEN
    SELECT '[' || COALESCE(string_agg(public._citation_canonical_json(e.value), ',' ORDER BY e.ordinality), '') || ']'
      INTO encoded FROM jsonb_array_elements(_value) WITH ORDINALITY e(value, ordinality);
  ELSE encoded := _value::text;
  END CASE;
  RETURN encoded;
END;
$$;

-- Small schema validator with closed objects: no additional keys are retained.
-- It is intentionally not a general JSON Schema implementation.
CREATE OR REPLACE FUNCTION public._citation_json_shape(_value jsonb, _schema jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE kind text := jsonb_typeof(_value); item record; required_key text;
BEGIN
  IF _value IS NULL THEN RETURN false; END IF;
  IF _schema ? 'enum' THEN RETURN _schema->'enum' @> jsonb_build_array(_value); END IF;
  IF jsonb_typeof(_schema->'type') = 'array' THEN
    IF NOT (_schema->'type' @> jsonb_build_array(kind)) THEN RETURN false; END IF;
  ELSIF _schema->>'type' IS DISTINCT FROM kind THEN RETURN false;
  END IF;
  IF kind = 'object' THEN
    FOR required_key IN SELECT jsonb_array_elements_text(COALESCE(_schema->'required', '[]'::jsonb)) LOOP
      IF NOT (_value ? required_key) THEN RETURN false; END IF;
    END LOOP;
    FOR item IN SELECT * FROM jsonb_each(_value) LOOP
      IF NOT (_schema->'properties' ? item.key) OR NOT public._citation_json_shape(item.value, _schema->'properties'->item.key) THEN RETURN false; END IF;
    END LOOP;
  ELSIF kind = 'array' THEN
    IF jsonb_array_length(_value) < COALESCE((_schema->>'minItems')::integer, 0)
       OR jsonb_array_length(_value) > COALESCE((_schema->>'maxItems')::integer, 2147483647) THEN RETURN false; END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(_value) LOOP
      IF NOT public._citation_json_shape(item.value, _schema->'items') THEN RETURN false; END IF;
    END LOOP;
  ELSIF kind = 'string' THEN
    IF length(_value #>> '{}') < COALESCE((_schema->>'minLength')::integer, 0)
       OR length(_value #>> '{}') > COALESCE((_schema->>'maxLength')::integer, 2147483647) THEN RETURN false; END IF;
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public._citation_recovery_valid(_value jsonb, _kind text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE shape jsonb; max_bytes integer;
BEGIN
  IF _kind = 'input' THEN
    max_bytes := 131072;
    shape := $schema${"type":"object","properties":{"messages":{"type":"array","items":{"type":"object","properties":{"role":{"enum":["system","user","assistant"]},"content":{"type":"string"}},"required":["role","content"]},"minItems":1,"maxItems":100},"rawInput":{"type":["string","null"]},"foreignLookup":{"type":["object","null"],"properties":{"enabled":{"type":"boolean"},"kind":{"enum":["case","journal_article","book","book_chapter"]},"jurisdiction":{"enum":["US","UK","OTHER","UNKNOWN"]},"rawInput":{"type":"string"},"parsedFields":{"type":"object","properties":{"caseName":{"type":"string"},"volume":{"type":"string"},"reporter":{"type":"string"},"firstPage":{"type":"string"},"pinpoint":{"type":"string"},"paragraph":{"type":"string"},"court":{"type":"string"},"year":{"type":"string"},"docket":{"type":"string"},"databaseIdentifier":{"type":"string"},"starPinpoint":{"type":"string"},"decisionDate":{"type":"string"},"reporterVolume":{"type":"string"},"neutral":{"type":"string"},"ukVolume":{"type":"string"},"ukSeries":{"type":"string"},"authors":{"type":"string"},"author":{"type":"string"},"articleTitle":{"type":"string"},"journal":{"type":"string"},"bookTitle":{"type":"string"},"edition":{"type":"string"},"editors":{"type":"string"},"translators":{"type":"string"},"chapterTitle":{"type":"string"},"doi":{"type":"string"},"sourceUrl":{"type":"string"},"title":{"type":"string"},"jurisdiction":{"type":"string"},"division":{"type":"string"},"number":{"type":"string"},"section":{"type":"string"},"clause":{"type":"string"},"statuteName":{"type":"string"},"titleNumber":{"type":"string"},"code":{"type":"string"},"subsection":{"type":"string"},"chapter":{"type":"string"},"regnalYear":{"type":"string"},"monarch":{"type":"string"},"site":{"type":"string"},"date":{"type":"string"},"url":{"type":"string"}},"required":[]},"articleResponseVersion":{"enum":[1]}},"required":["enabled"]},"batchId":{"type":["string","null"],"minLength":8,"maxLength":200}},"required":["messages","rawInput","foreignLookup","batchId"]}$schema$::jsonb;
  ELSIF _kind = 'result' THEN
    max_bytes := 262144;
    shape := $schema${"type":"object","properties":{"content":{"type":"string"},"foreignLookup":{"type":"object","properties":{"kind":{"enum":["case","journal_article","book","book_chapter"]},"jurisdiction":{"enum":["US","UK","OTHER","UNKNOWN"]},"fields":{"type":"object","properties":{"caseName":{"type":"string"},"volume":{"type":"string"},"reporter":{"type":"string"},"firstPage":{"type":"string"},"pinpoint":{"type":"string"},"paragraph":{"type":"string"},"court":{"type":"string"},"year":{"type":"string"},"docket":{"type":"string"},"databaseIdentifier":{"type":"string"},"starPinpoint":{"type":"string"},"decisionDate":{"type":"string"},"reporterVolume":{"type":"string"},"neutral":{"type":"string"},"ukVolume":{"type":"string"},"ukSeries":{"type":"string"},"authors":{"type":"string"},"author":{"type":"string"},"articleTitle":{"type":"string"},"journal":{"type":"string"},"bookTitle":{"type":"string"},"edition":{"type":"string"},"editors":{"type":"string"},"translators":{"type":"string"},"chapterTitle":{"type":"string"},"doi":{"type":"string"},"sourceUrl":{"type":"string"},"title":{"type":"string"},"jurisdiction":{"type":"string"},"division":{"type":"string"},"number":{"type":"string"},"section":{"type":"string"},"clause":{"type":"string"},"statuteName":{"type":"string"},"titleNumber":{"type":"string"},"code":{"type":"string"},"subsection":{"type":"string"},"chapter":{"type":"string"},"regnalYear":{"type":"string"},"monarch":{"type":"string"},"site":{"type":"string"},"date":{"type":"string"},"url":{"type":"string"}},"required":[]},"grounded":{"type":"object","properties":{"caseName":{"type":"boolean"},"volume":{"type":"boolean"},"reporter":{"type":"boolean"},"firstPage":{"type":"boolean"},"pinpoint":{"type":"boolean"},"paragraph":{"type":"boolean"},"court":{"type":"boolean"},"year":{"type":"boolean"},"docket":{"type":"boolean"},"databaseIdentifier":{"type":"boolean"},"starPinpoint":{"type":"boolean"},"decisionDate":{"type":"boolean"},"reporterVolume":{"type":"boolean"},"neutral":{"type":"boolean"},"ukVolume":{"type":"boolean"},"ukSeries":{"type":"boolean"},"authors":{"type":"boolean"},"author":{"type":"boolean"},"articleTitle":{"type":"boolean"},"journal":{"type":"boolean"},"bookTitle":{"type":"boolean"},"edition":{"type":"boolean"},"editors":{"type":"boolean"},"translators":{"type":"boolean"},"chapterTitle":{"type":"boolean"},"doi":{"type":"boolean"},"sourceUrl":{"type":"boolean"},"title":{"type":"boolean"},"jurisdiction":{"type":"boolean"},"division":{"type":"boolean"},"number":{"type":"boolean"},"section":{"type":"boolean"},"clause":{"type":"boolean"},"statuteName":{"type":"boolean"},"titleNumber":{"type":"boolean"},"code":{"type":"boolean"},"subsection":{"type":"boolean"},"chapter":{"type":"boolean"},"regnalYear":{"type":"boolean"},"monarch":{"type":"boolean"},"site":{"type":"boolean"},"date":{"type":"boolean"},"url":{"type":"boolean"}},"required":[]},"provenance":{"type":"object","properties":{"caseName":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"volume":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"reporter":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"firstPage":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"pinpoint":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"paragraph":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"court":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"year":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"docket":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"databaseIdentifier":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"starPinpoint":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"decisionDate":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"reporterVolume":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"neutral":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"ukVolume":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"ukSeries":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"authors":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"author":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"articleTitle":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"journal":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"bookTitle":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"edition":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"editors":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"translators":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"chapterTitle":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"doi":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"sourceUrl":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"title":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"jurisdiction":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"division":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"number":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"section":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"clause":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"statuteName":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"titleNumber":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"code":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"subsection":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"chapter":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"regnalYear":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"monarch":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"site":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"date":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]},"url":{"type":"object","properties":{"value":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"basis":{"enum":["official_record","structured_metadata","publisher_metadata","repository_metadata","search_result_explicit","document_inspection"]}},"required":["value","basis"]}},"required":[]},"sources":{"type":"array","items":{"type":"object","properties":{"url":{"type":"string"},"title":{"type":"string"},"tier":{"enum":["tier1","tier2"]}},"required":["url","tier"]}},"identity":{"type":"object","properties":{"matched":{"type":"boolean"},"anchors":{"type":"array","items":{"type":"string"}},"conflicts":{"type":"array","items":{"type":"string"}},"jurisdiction":{"enum":["US","UK"]},"jurisdictionDiscovered":{"type":"boolean"},"court":{"type":"string"},"year":{"type":"string"}},"required":["matched","anchors","conflicts"]},"disambiguation":{"type":"array","items":{"type":"object","properties":{"jurisdiction":{"enum":["US","UK"]},"label":{"type":"string"},"url":{"type":"string"}},"required":["jurisdiction","label","url"]}},"diagnostics":{"type":"object","properties":{"tier1Queried":{"type":"boolean"},"tier2Fired":{"type":"boolean"},"jurisdictionResolvedBy":{"type":"string"}},"required":["tier1Queried","tier2Fired"]},"error":{"type":"string"},"articleResolution":{"enum":["resolved","incomplete","conflict"]}},"required":["kind","jurisdiction","fields","grounded","provenance","sources","identity","diagnostics"]}},"required":[]}$schema$::jsonb;
    IF NOT (COALESCE(length(btrim(_value->>'content')), 0) > 0 OR COALESCE(jsonb_typeof(_value->'foreignLookup') = 'object', false)) THEN RETURN false; END IF;
  ELSE RETURN false;
  END IF;
  IF _value IS NULL OR octet_length(public._citation_canonical_json(_value)) > max_bytes THEN RETURN false; END IF;
  RETURN public._citation_json_shape(_value, shape);
END;
$$;
CREATE OR REPLACE FUNCTION public._citation_execution_fingerprint(_input jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT encode(sha256(convert_to(public._citation_canonical_json(jsonb_build_object('version', 1) || _input), 'UTF8')), 'hex');
$$;
REVOKE ALL ON FUNCTION public._citation_canonical_json(jsonb), public._citation_json_shape(jsonb,jsonb),
  public._citation_recovery_valid(jsonb,text), public._citation_execution_fingerprint(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._citation_canonical_json(jsonb), public._citation_json_shape(jsonb,jsonb),
  public._citation_recovery_valid(jsonb,text), public._citation_execution_fingerprint(jsonb) TO service_role;
-- Defense in depth for privileged writes: payload rows cannot hold another
-- envelope, raw provider response, auth token field, or oversized content.
ALTER TABLE public.citation_recovery_payloads ADD CONSTRAINT citation_recovery_input_shape
  CHECK (public._citation_recovery_valid(input, 'input'));
ALTER TABLE public.citation_recovery_payloads ADD CONSTRAINT citation_recovery_result_shape
  CHECK (result IS NULL OR public._citation_recovery_valid(result, 'result'));

CREATE OR REPLACE FUNCTION public.begin_citation_request(
  _user_id uuid, _request_id text, _fingerprint text, _batch_id text DEFAULT NULL,
  _retry_of_request_id text DEFAULT NULL, _recovery_input jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  prof public.profiles;
  prior public.citation_usage_requests;
  parent_request public.citation_usage_requests;
  parent_receipt jsonb;
  receipt jsonb;
  anchor public.citation_usage_requests;
  token uuid := gen_random_uuid();
  amount integer := 1;
  use_included integer := 0;
  use_topup integer := 0;
  use_legacy integer := 0;
  is_admin boolean;
  paid boolean;
  expired boolean;
  now_ts timestamptz := now();
  win_start timestamptz;
  win_used integer;
  win_avail integer;
  period_avail integer;
  block text;
BEGIN
  PERFORM public._require_usage_service();
  IF _user_id IS NULL OR _request_id IS NULL OR length(_request_id) NOT BETWEEN 4 AND 200 THEN
    RETURN jsonb_build_object('ok', false, 'execute', false, 'error', 'INVALID_REQUEST_ID');
  END IF;
  IF _fingerprint IS NULL OR _fingerprint !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'execute', false, 'error', 'INVALID_FINGERPRINT');
  END IF;
  IF _batch_id IS NOT NULL AND length(_batch_id) NOT BETWEEN 4 AND 200 THEN
    RETURN jsonb_build_object('ok', false, 'execute', false, 'error', 'INVALID_BATCH');
  END IF;

  IF _retry_of_request_id IS NOT NULL AND (
       length(_retry_of_request_id) NOT BETWEEN 4 AND 200 OR _retry_of_request_id = _request_id
     ) THEN
    RETURN jsonb_build_object('ok', false, 'execute', false, 'error', 'INVALID_RETRY_REQUEST');
  END IF;

  IF NOT public._citation_recovery_valid(_recovery_input, 'input')
     OR (_recovery_input->>'batchId') IS DISTINCT FROM _batch_id
     OR public._citation_execution_fingerprint(_recovery_input) IS DISTINCT FROM _fingerprint THEN
    RETURN jsonb_build_object('ok', false, 'execute', false, 'error', 'INVALID_RECOVERY_INPUT');
  END IF;

  -- Global lock order for every RPC in this draft: profile, then request.
  -- This serializes claim+consume, different requests, batch slots and refunds.
  SELECT * INTO prof FROM public.profiles WHERE id = _user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'execute', false, 'error', 'PROFILE_NOT_FOUND');
  END IF;
  -- Validate lineage BEFORE either an existing requested-ID replay or canonical
  -- child lookup. Existing identities cannot bypass parent/ancestry validation.
  IF _retry_of_request_id IS NOT NULL THEN
    SELECT * INTO parent_request FROM public.citation_usage_requests
      WHERE user_id = _user_id AND request_id = _retry_of_request_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'execute', false, 'error', 'RETRY_PARENT_NOT_FOUND');
    END IF;
    IF parent_request.state <> 'failed' THEN
      RETURN jsonb_build_object('ok', false, 'execute', false, 'error', 'RETRY_PARENT_NOT_FAILED');
    END IF;
    IF parent_request.fingerprint <> _fingerprint OR parent_request.batch_id IS DISTINCT FROM _batch_id THEN
      RETURN jsonb_build_object('ok', false, 'execute', false, 'error', 'RETRY_FINGERPRINT_MISMATCH');
    END IF;
    parent_receipt := public._citation_refund_receipt(_user_id, _retry_of_request_id);
  END IF;

  SELECT * INTO prior FROM public.citation_usage_requests
    WHERE user_id = _user_id AND request_id = _request_id FOR UPDATE;
  IF FOUND THEN
    IF prior.retry_of_request_id IS DISTINCT FROM _retry_of_request_id THEN
      RETURN jsonb_build_object('ok', false, 'execute', false, 'error', 'REQUEST_ANCESTRY_MISMATCH');
    END IF;
    IF prior.fingerprint <> _fingerprint OR prior.batch_id IS DISTINCT FROM _batch_id THEN
      RETURN jsonb_build_object('ok', false, 'execute', false, 'error', 'REQUEST_FINGERPRINT_MISMATCH');
    END IF;
    -- No lease, age-based restart, new token, or second provider execution.
    receipt := public._citation_refund_receipt(_user_id, prior.request_id);
    RETURN jsonb_build_object('ok', true, 'execute', false, 'replayed', true,
      'status', prior.state, 'request_id', prior.request_id,
      'retry_of_request_id', prior.retry_of_request_id,
      'refunded', (receipt->>'refunded')::boolean, 'refund_receipt', receipt,
      'retry_parent_refund_receipt', parent_receipt);
  END IF;

  IF _retry_of_request_id IS NOT NULL THEN
    SELECT * INTO prior FROM public.citation_usage_requests
      WHERE user_id = _user_id AND retry_of_request_id = _retry_of_request_id FOR UPDATE;
    IF FOUND THEN
      -- Two tabs can propose different child IDs, but only one child is canonical.
      -- A stale parent click returns that exact child even if it is now failed;
      -- it never walks the chain or authorizes a grandchild.
      IF prior.fingerprint <> _fingerprint OR prior.batch_id IS DISTINCT FROM _batch_id THEN
        RETURN jsonb_build_object('ok', false, 'execute', false, 'error', 'REQUEST_FINGERPRINT_MISMATCH');
      END IF;
      receipt := public._citation_refund_receipt(_user_id, prior.request_id);
      RETURN jsonb_build_object('ok', true, 'execute', false, 'replayed', true,
        'status', prior.state, 'request_id', prior.request_id,
        'retry_of_request_id', prior.retry_of_request_id,
        'refunded', (receipt->>'refunded')::boolean, 'refund_receipt', receipt,
        'retry_parent_refund_receipt', parent_receipt);
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.credit_ledger WHERE user_id = _user_id AND request_id = _request_id)
     OR EXISTS (SELECT 1 FROM public.usage_terminal_failures WHERE user_id = _user_id AND request_id = _request_id) THEN
    -- Never interpret an old consume/replay as permission to execute providers.
    RETURN jsonb_build_object('ok', false, 'execute', false, 'error', 'REQUEST_ID_ALREADY_USED');
  END IF;

  is_admin := (prof.plan = 'admin') OR private.has_role(_user_id, 'admin'::public.app_role);
  paid := public._plan_is_paid(prof.plan);
  expired := paid AND prof.billing_period_ends_at IS NOT NULL AND prof.billing_period_ends_at <= now_ts;
  win_start := prof.window_started_at;
  win_used := COALESCE(prof.window_units_used, 0);
  IF win_start IS NULL OR now_ts >= win_start + interval '5 hours' THEN
    win_start := now_ts;
    win_used := 0;
  END IF;
  win_avail := GREATEST(0, public._plan_window_limit(prof.plan) - win_used);
  period_avail := GREATEST(0, prof.included_credits_remaining);

  -- Batch size is server-owned. A failed/refunded anchor cannot fund new work.
  -- Old owner-created ledger metadata is deliberately not trusted for free slots.
  IF _batch_id IS NOT NULL THEN
    SELECT a.* INTO anchor FROM public.citation_usage_requests a
     WHERE a.user_id = _user_id AND a.batch_id = _batch_id
       AND a.charged_units = 1 AND a.batch_anchor_request_id = a.request_id
       AND a.state <> 'failed'
       AND (is_admin OR EXISTS (SELECT 1 FROM public.credit_ledger paid_anchor
         WHERE paid_anchor.user_id = a.user_id AND paid_anchor.request_id = a.request_id
           AND paid_anchor.event_type = 'consume' AND paid_anchor.amount < 0))
       AND NOT EXISTS (SELECT 1 FROM public.credit_ledger l
         WHERE l.user_id = a.user_id AND l.request_id = a.request_id AND l.event_type = 'refund')
       AND (SELECT count(*) FROM public.citation_usage_requests member
         WHERE member.user_id = a.user_id AND member.batch_anchor_request_id = a.request_id) < 5
     ORDER BY a.created_at DESC, a.request_id DESC LIMIT 1;
    IF FOUND THEN amount := 0; END IF;
  END IF;

  -- Expiry applies to zero-charge followers too. Valid prepaid batch slots do not
  -- consume an additional unit or require another unit of remaining allowance.
  IF NOT is_admin AND expired THEN
    block := 'plan_expired';
  ELSIF is_admin OR amount = 0 THEN
    NULL;
  ELSIF win_avail >= amount AND period_avail >= amount THEN
    use_included := amount;
  ELSIF paid AND (GREATEST(0, prof.topup_credits_remaining) + GREATEST(0, prof.legacy_bonus_remaining)) >= amount THEN
    use_topup := LEAST(GREATEST(0, prof.topup_credits_remaining), amount);
    use_legacy := amount - use_topup;
  ELSE
    block := CASE WHEN prof.plan = 'trial' AND period_avail < amount THEN 'trial_exhausted'
                  WHEN period_avail < amount THEN 'plan_allowance' ELSE 'short_window' END;
  END IF;
  IF block IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'execute', false, 'error', 'INSUFFICIENT_CREDITS',
      'block_reason', block, 'required', amount, 'window_reset_at', win_start + interval '5 hours',
      'plan_ends_at', prof.billing_period_ends_at, 'can_use_topup', false,
      'can_purchase_topup', paid AND NOT expired,
      'remaining_included', prof.included_credits_remaining, 'remaining_topup', prof.topup_credits_remaining);
  END IF;

  INSERT INTO public.citation_usage_requests
    (user_id, request_id, fingerprint, batch_id, retry_of_request_id, batch_anchor_request_id, charged_units, state, attempt_token)
  VALUES (_user_id, _request_id, _fingerprint, _batch_id, _retry_of_request_id,
    CASE WHEN _batch_id IS NULL THEN NULL WHEN amount = 1 THEN _request_id ELSE anchor.request_id END,
    amount, 'in_progress', token);
  INSERT INTO public.citation_recovery_payloads(user_id, request_id, input, expires_at)
    SELECT user_id, request_id, _recovery_input, created_at + interval '24 hours'
      FROM public.citation_usage_requests WHERE user_id = _user_id AND request_id = _request_id;
  -- No exception swallowing: a payload insert failure rolls back claim + debit.


  UPDATE public.profiles SET
    included_credits_remaining = included_credits_remaining - use_included,
    topup_credits_remaining = topup_credits_remaining - use_topup,
    legacy_bonus_remaining = legacy_bonus_remaining - use_legacy,
    window_started_at = win_start,
    window_units_used = win_used + use_included
  WHERE id = _user_id RETURNING * INTO prof;

  INSERT INTO public.credit_ledger
    (user_id, request_id, event_type, amount, included_delta, topup_delta, legacy_delta,
     balance_after_included, balance_after_topup, reason, metadata)
  VALUES (_user_id, _request_id, 'consume', -(use_included + use_topup + use_legacy),
    -use_included, -use_topup, -use_legacy,
    prof.included_credits_remaining, prof.topup_credits_remaining, 'citation-chat',
    jsonb_build_object('operation_type', 'citation-chat', 'plan', prof.plan,
      'bucket', CASE WHEN use_included > 0 THEN 'included' WHEN use_topup > 0 THEN 'topup'
                    WHEN use_legacy > 0 THEN 'legacy_bonus' ELSE 'none' END,
      'batch_id', _batch_id, 'group_size', CASE WHEN _batch_id IS NULL THEN NULL ELSE 5 END,
      'batch_anchor_request_id', CASE WHEN _batch_id IS NULL THEN NULL WHEN amount = 1 THEN _request_id ELSE anchor.request_id END,
      'window_started_at', win_start, 'window_units_used_after', prof.window_units_used,
      'billing_period_started_at', prof.billing_period_started_at));

  RETURN jsonb_build_object('ok', true, 'execute', true, 'status', 'in_progress',
    'request_id', _request_id, 'attempt_token', token, 'charged', amount, 'admin', is_admin,
    'retry_of_request_id', _retry_of_request_id, 'retry_parent_refund_receipt', parent_receipt,
    'remaining_included', prof.included_credits_remaining,
    'remaining_topup', prof.topup_credits_remaining, 'remaining_legacy', prof.legacy_bonus_remaining);
END;
$$;

-- Owner calls can observe only an already-completed refund. They cannot authorize
-- or create a refund, even with their own request ID and a convincing reason.
CREATE OR REPLACE FUNCTION public.refund_credits(_request_id text, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  uid uuid := auth.uid();
  prior public.credit_ledger;
BEGIN
  IF uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  SELECT * INTO prior FROM public.credit_ledger
    WHERE user_id = uid AND request_id = _request_id AND event_type = 'refund';
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'replayed', true,
      'remaining_included', prior.balance_after_included, 'remaining_topup', prior.balance_after_topup);
  END IF;
  RETURN jsonb_build_object('ok', false, 'error', 'TRUSTED_FAILURE_REQUIRED');
END;
$$;

CREATE OR REPLACE FUNCTION public.refund_credits_for_user(_user_id uuid, _request_id text, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  prof public.profiles;
  consumed public.credit_ledger;
  prior public.credit_ledger;
  request public.citation_usage_requests;
  failure public.usage_terminal_failures;
  job record;
BEGIN
  PERFORM public._require_usage_service();
  SELECT * INTO prof FROM public.profiles WHERE id = _user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'PROFILE_NOT_FOUND'); END IF;
  SELECT * INTO request FROM public.citation_usage_requests
    WHERE user_id = _user_id AND request_id = _request_id FOR UPDATE;
  IF FOUND AND request.state <> 'failed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TRUSTED_FAILURE_REQUIRED');
  END IF;
  SELECT * INTO failure FROM public.usage_terminal_failures
    WHERE user_id = _user_id AND request_id = _request_id;
  IF NOT FOUND OR (request.request_id IS NOT NULL AND failure.source <> 'citation') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TRUSTED_FAILURE_REQUIRED');
  END IF;
  IF failure.source = 'legacy_service' THEN
    -- Recheck state even for direct/replayed service refund calls. An attestation
    -- can never override a subsequently observed success or unknown outcome.
    FOR job IN SELECT * FROM public.legal_research_jobs
      WHERE user_id = _user_id AND credit_request_id = _request_id FOR UPDATE
    LOOP
      IF job.result->>'execution_outcome_unknown' IS DISTINCT FROM 'false'
         OR (job.status = 'error' OR (job.status = 'done' AND job.result->>'delivery_failed' = 'true')) IS NOT TRUE THEN
        RETURN jsonb_build_object('ok', false, 'error', 'TRUSTED_FAILURE_REQUIRED');
      END IF;
    END LOOP;
  END IF;
  SELECT * INTO prior FROM public.credit_ledger
    WHERE user_id = _user_id AND request_id = _request_id AND event_type = 'refund';
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'refunded', prior.amount > 0,
      'remaining_included', prior.balance_after_included, 'remaining_topup', prior.balance_after_topup);
  END IF;
  SELECT * INTO consumed FROM public.credit_ledger
    WHERE user_id = _user_id AND request_id = _request_id AND event_type = 'consume';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'CONSUME_NOT_FOUND'); END IF;
  IF consumed.included_delta > 0 OR consumed.topup_delta > 0 OR consumed.legacy_delta > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_CONSUME');
  END IF;

  -- Never credit an expired/replaced included allowance into a new plan/period.
  -- New citation consumes bind the precise period. Older ledgers can prove this
  -- only with a matching plan and consume time inside the current known period.
  -- Missing historical evidence requires review, never optimistic restoration.
  IF consumed.included_delta < 0 AND (
       consumed.metadata->>'plan' IS DISTINCT FROM prof.plan
       OR CASE WHEN consumed.metadata ? 'billing_period_started_at' THEN
         (consumed.metadata->>'billing_period_started_at')::timestamptz IS DISTINCT FROM prof.billing_period_started_at
       ELSE prof.billing_period_started_at IS NULL OR consumed.created_at < prof.billing_period_started_at END
     ) THEN
    RETURN jsonb_build_object('ok', true, 'refunded', false, 'review_required', true,
      'review_reason', 'ORIGINAL_ALLOWANCE_UNAVAILABLE');
  END IF;

  -- One unit funds the whole batch group. Refunding a failed anchor while a
  -- sibling delivered/continues/might have delivered would make that work free.
  -- The failed anchor closes immediately, but its unit stays reserved until ALL
  -- members are definitively failed. There is no age-based automatic release.
  IF request.request_id IS NOT NULL AND request.batch_anchor_request_id = request.request_id
     AND EXISTS (SELECT 1 FROM public.citation_usage_requests sibling
       WHERE sibling.user_id = _user_id AND sibling.batch_anchor_request_id = _request_id
         AND sibling.state <> 'failed') THEN
    RETURN jsonb_build_object('ok', true, 'refunded', false, 'deferred', true);
  END IF;

  IF consumed.included_delta = 0 AND consumed.topup_delta = 0 AND consumed.legacy_delta = 0 THEN
    RETURN jsonb_build_object('ok', true, 'refunded', false, 'noop', true);
  END IF;

  UPDATE public.profiles SET
    included_credits_remaining = included_credits_remaining - consumed.included_delta,
    topup_credits_remaining = topup_credits_remaining - consumed.topup_delta,
    legacy_bonus_remaining = legacy_bonus_remaining - consumed.legacy_delta,
    -- A refund from an old window must not erase usage in the current window.
    window_units_used = CASE
      WHEN prof.window_started_at = (consumed.metadata->>'window_started_at')::timestamptz
      THEN GREATEST(0, window_units_used + consumed.included_delta)
      ELSE window_units_used END
  WHERE id = _user_id RETURNING * INTO prof;

  INSERT INTO public.credit_ledger
    (user_id, request_id, event_type, amount, included_delta, topup_delta, legacy_delta,
     balance_after_included, balance_after_topup, reason, metadata)
  VALUES (_user_id, _request_id, 'refund',
    -(consumed.included_delta + consumed.topup_delta + consumed.legacy_delta),
    -consumed.included_delta, -consumed.topup_delta, -consumed.legacy_delta,
    prof.included_credits_remaining, prof.topup_credits_remaining, _reason,
    jsonb_build_object('trusted_failure', true, 'consume_id', consumed.id));
  RETURN jsonb_build_object('ok', true, 'refunded', true, 'remaining_included', prof.included_credits_remaining,
    'remaining_topup', prof.topup_credits_remaining, 'remaining_legacy', prof.legacy_bonus_remaining);
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_citation_request(
  _user_id uuid, _request_id text, _attempt_token uuid, _outcome text, _reason text DEFAULT NULL, _result jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  request public.citation_usage_requests;
  refund_result jsonb;
  anchor_refund jsonb;
  receipt jsonb;
  result_hash text;
  recovery public.citation_recovery_payloads;
BEGIN
  PERFORM public._require_usage_service();
  IF _outcome IS NULL OR _outcome NOT IN ('succeeded', 'failed', 'unknown') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_OUTCOME');
  END IF;
  IF (_outcome = 'succeeded' AND NOT public._citation_recovery_valid(_result, 'result'))
     OR (_outcome <> 'succeeded' AND _result IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_RECOVERY_RESULT');
  END IF;
  IF _outcome = 'succeeded' THEN
    result_hash := encode(sha256(convert_to(public._citation_canonical_json(_result), 'UTF8')), 'hex');
  END IF;
  PERFORM 1 FROM public.profiles WHERE id = _user_id FOR UPDATE;
  SELECT * INTO request FROM public.citation_usage_requests
    WHERE user_id = _user_id AND request_id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'REQUEST_NOT_FOUND'); END IF;
  IF _attempt_token IS NULL OR request.attempt_token <> _attempt_token THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ATTEMPT_TOKEN_MISMATCH');
  END IF;
  SELECT * INTO recovery FROM public.citation_recovery_payloads
    WHERE user_id = _user_id AND request_id = _request_id FOR UPDATE;
  IF request.state <> 'in_progress' THEN
    IF request.state = 'succeeded' AND _outcome = 'succeeded' AND request.result_fingerprint IS DISTINCT FROM result_hash THEN
      RETURN jsonb_build_object('ok', false, 'error', 'RESULT_CONFLICT', 'status', request.state);
    END IF;
    receipt := public._citation_refund_receipt(_user_id, _request_id);
    RETURN jsonb_build_object('ok', request.state = _outcome, 'replayed', true,
      'status', request.state, 'result_stored', request.state = 'succeeded' AND recovery.result IS NOT NULL AND recovery.expires_at > clock_timestamp(),
      'refunded', (receipt->>'refunded')::boolean, 'refund_receipt', receipt,
      'review_required', receipt->>'status' = 'review_required',
      'error', CASE WHEN request.state <> _outcome THEN 'TERMINAL_STATE_CONFLICT' END);
  END IF;
  IF _outcome = 'succeeded' THEN
    IF recovery.request_id IS NULL OR recovery.expires_at <= clock_timestamp() THEN
      RETURN jsonb_build_object('ok', false, 'error', 'RECOVERY_EXPIRED_OR_UNAVAILABLE');
    END IF;
    IF recovery.result IS NOT NULL AND recovery.result IS DISTINCT FROM _result THEN
      RETURN jsonb_build_object('ok', false, 'error', 'RESULT_CONFLICT');
    END IF;
    UPDATE public.citation_recovery_payloads SET result = _result
      WHERE user_id = _user_id AND request_id = _request_id AND result IS NULL;
  END IF;
  -- The result write and success transition share the same transaction and
  -- profile/request/payload lock. No result overwrite, compensating retry or refund.
  UPDATE public.citation_usage_requests SET state = _outcome, finished_at = now(), result_fingerprint = result_hash,
    terminal_reason = left(COALESCE(_reason, _outcome), 300)
    WHERE user_id = _user_id AND request_id = _request_id;
  IF _outcome = 'failed' THEN
    INSERT INTO public.usage_terminal_failures(user_id, request_id, source, reason)
      VALUES (_user_id, _request_id, 'citation', left(COALESCE(_reason, 'provider_rejected'), 300));
    refund_result := public.refund_credits_for_user(_user_id, _request_id, _reason);
    IF COALESCE((refund_result->>'ok')::boolean, false) IS NOT TRUE THEN
      -- Bookkeeping failure rolls back finalization. An intentional deferred
      -- group refund is ok=true and does not enter this exception branch.
      RAISE EXCEPTION 'Could not finalize usage refund' USING ERRCODE = 'P0001';
    END IF;
    -- A final failed follower can make its previously failed anchor refundable.
    -- The same profile lock covers member transition, group check and refund.
    IF request.batch_anchor_request_id IS NOT NULL
       AND request.batch_anchor_request_id <> request.request_id
       AND EXISTS (SELECT 1 FROM public.citation_usage_requests a
         WHERE a.user_id = _user_id AND a.request_id = request.batch_anchor_request_id AND a.state = 'failed') THEN
      anchor_refund := public.refund_credits_for_user(_user_id, request.batch_anchor_request_id, 'all batch members failed');
      IF COALESCE((anchor_refund->>'ok')::boolean, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'Could not finalize batch usage refund' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;
  receipt := public._citation_refund_receipt(_user_id, _request_id);
  RETURN jsonb_build_object('ok', true, 'status', _outcome, 'result_stored', _outcome = 'succeeded',
    'refunded', (receipt->>'refunded')::boolean, 'refund_receipt', receipt,
    'review_required', COALESCE((refund_result->>'review_required')::boolean, false)
      OR COALESCE((anchor_refund->>'review_required')::boolean, false));
END;
$$;

-- Read-only recovery surface. Authenticated owners never call this service RPC
-- directly: citation-recovery derives _user_id from its freshly verified JWT.
CREATE OR REPLACE FUNCTION public.read_citation_recovery(
  _user_id uuid, _request_id text DEFAULT NULL, _parent_request_id text DEFAULT NULL,
  _cursor text DEFAULT NULL, _limit integer DEFAULT 20
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  entry record;
  cursor_row public.citation_usage_requests;
  records jsonb := '[]'::jsonb;
  item jsonb;
  input_body jsonb;
  result_body jsonb;
  availability text;
  receipt jsonb;
  next_cursor text := NULL;
  last_id text;
  count_rows integer := 0;
  expires timestamptz;
  current_ts timestamptz;
BEGIN
  PERFORM public._require_usage_service();
  IF _user_id IS NULL OR _limit IS NULL OR _limit NOT BETWEEN 1 AND 50
     OR (_request_id IS NOT NULL AND length(_request_id) NOT BETWEEN 8 AND 200)
     OR (_parent_request_id IS NOT NULL AND length(_parent_request_id) NOT BETWEEN 8 AND 200)
     OR (_request_id IS NOT NULL AND _parent_request_id IS NOT NULL)
     OR (_cursor IS NOT NULL AND (length(_cursor) NOT BETWEEN 8 AND 200 OR _request_id IS NOT NULL OR _parent_request_id IS NOT NULL)) THEN
    RETURN jsonb_build_object('error', 'INVALID_RECOVERY_QUERY');
  END IF;
  -- Same owner lock order as mutation/receipt, but no state is changed here.
  PERFORM 1 FROM public.profiles WHERE id = _user_id FOR UPDATE;
  IF _cursor IS NOT NULL THEN
    SELECT * INTO cursor_row FROM public.citation_usage_requests
      WHERE user_id = _user_id AND request_id = _cursor;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_RECOVERY_CURSOR'); END IF;
  END IF;
  FOR entry IN
    SELECT c.*, p.input AS recovery_input, p.result AS recovery_result, p.expires_at AS payload_expires_at
      FROM public.citation_usage_requests c
      LEFT JOIN public.citation_recovery_payloads p ON p.user_id = c.user_id AND p.request_id = c.request_id
      WHERE c.user_id = _user_id
        AND (_request_id IS NULL OR c.request_id = _request_id)
        AND (_parent_request_id IS NULL OR c.retry_of_request_id = _parent_request_id)
        AND (_cursor IS NULL OR (c.created_at, c.request_id) < (cursor_row.created_at, cursor_row.request_id))
      ORDER BY c.created_at DESC, c.request_id DESC LIMIT _limit + 1
  LOOP
    IF count_rows >= _limit THEN next_cursor := last_id; EXIT; END IF;
    current_ts := clock_timestamp();
    expires := entry.created_at + interval '24 hours';
    input_body := NULL;
    result_body := NULL;
    IF expires <= current_ts THEN
      availability := 'expired';
    ELSIF entry.payload_expires_at IS DISTINCT FROM expires
       OR NOT COALESCE(public._citation_recovery_valid(entry.recovery_input, 'input'), false)
       OR public._citation_execution_fingerprint(entry.recovery_input) IS DISTINCT FROM entry.fingerprint THEN
      availability := 'unavailable';
    ELSE
      input_body := entry.recovery_input;
      IF entry.state = 'succeeded' AND public._citation_recovery_valid(entry.recovery_result, 'result')
         AND encode(sha256(convert_to(public._citation_canonical_json(entry.recovery_result), 'UTF8')), 'hex') = entry.result_fingerprint THEN
        result_body := entry.recovery_result;
      END IF;
      availability := CASE WHEN entry.state = 'in_progress' THEN 'pending'
        WHEN entry.state = 'succeeded' AND result_body IS NULL THEN 'unavailable' ELSE 'available' END;
    END IF;
    IF availability = 'unavailable' THEN input_body := NULL; result_body := NULL; END IF;
    -- Recompute the CURRENT authoritative receipt; failure alone is not refund.
    receipt := public._citation_refund_receipt(_user_id, entry.request_id);
    item := jsonb_build_object('requestId', entry.request_id, 'retryOfRequestId', entry.retry_of_request_id,
      'status', entry.state, 'createdAt', entry.created_at, 'expiresAt', expires,
      'availability', availability, 'input', input_body, 'result', result_body, 'refundReceipt', receipt);
    -- Bound pages as well as individual content. A short page can have a cursor.
    IF count_rows > 0 AND octet_length(records::text) + octet_length(item::text) > 1572864 THEN
      next_cursor := last_id; EXIT;
    END IF;
    records := records || jsonb_build_array(item);
    count_rows := count_rows + 1;
    last_id := entry.request_id;
  END LOOP;
  RETURN jsonb_build_object('requests', records, 'nextCursor', next_cursor);
END;
$$;
REVOKE ALL ON FUNCTION public.read_citation_recovery(uuid,text,text,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_citation_recovery(uuid,text,text,text,integer) TO service_role;

-- Physical cleanup is separate from the strict read cutoff. This draft defines
-- cleanup only; scheduling is NOT installed or verified. Never delete claims,
-- usage ledgers, terminal attestations, or the user's separately saved history.
CREATE OR REPLACE FUNCTION public.cleanup_citation_recovery(_limit integer DEFAULT 1000)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE removed integer;
BEGIN
  PERFORM public._require_usage_service();
  IF _limit IS NULL OR _limit NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Invalid cleanup limit'; END IF;
  WITH expired AS (
    SELECT user_id, request_id FROM public.citation_recovery_payloads
      WHERE expires_at <= clock_timestamp() ORDER BY expires_at LIMIT _limit FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.citation_recovery_payloads p USING expired e
    WHERE p.user_id = e.user_id AND p.request_id = e.request_id;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;
REVOKE ALL ON FUNCTION public.cleanup_citation_recovery(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_citation_recovery(integer) TO service_role;


-- Legacy endpoints must invoke this ONLY for newly consumed work with a known
-- terminal failure. Network errors, unparsed responses, worker timeouts and
-- missing persistence acknowledgements are unknown, not refundable failures.
CREATE OR REPLACE FUNCTION public.attest_usage_failure(
  _user_id uuid, _request_id text, _reason text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  consumed public.credit_ledger;
  job record;
  refund_result jsonb;
BEGIN
  PERFORM public._require_usage_service();
  IF _request_id IS NULL OR length(_request_id) NOT BETWEEN 4 AND 200
     OR _reason IS NULL OR length(_reason) NOT BETWEEN 1 AND 300 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_FAILURE');
  END IF;
  PERFORM 1 FROM public.profiles WHERE id = _user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'PROFILE_NOT_FOUND'); END IF;
  IF EXISTS (SELECT 1 FROM public.citation_usage_requests
    WHERE user_id = _user_id AND request_id = _request_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CITATION_ATTEMPT_REQUIRED');
  END IF;
  SELECT * INTO consumed FROM public.credit_ledger
    WHERE user_id = _user_id AND request_id = _request_id AND event_type = 'consume';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'CONSUME_NOT_FOUND'); END IF;
  IF consumed.reason = 'citation-chat' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CITATION_ATTEMPT_REQUIRED');
  END IF;
  FOR job IN SELECT * FROM public.legal_research_jobs
    WHERE user_id = _user_id AND credit_request_id = _request_id FOR UPDATE
  LOOP
    IF job.result->>'execution_outcome_unknown' IS DISTINCT FROM 'false'
       OR (job.status = 'error' OR (job.status = 'done' AND job.result->>'delivery_failed' = 'true')) IS NOT TRUE THEN
      RETURN jsonb_build_object('ok', false, 'error', 'TRUSTED_FAILURE_REQUIRED');
    END IF;
  END LOOP;
  INSERT INTO public.usage_terminal_failures(user_id, request_id, source, reason)
    VALUES (_user_id, _request_id, 'legacy_service', _reason)
    ON CONFLICT (user_id, request_id) DO NOTHING;
  refund_result := public.refund_credits_for_user(_user_id, _request_id, _reason);
  IF COALESCE((refund_result->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Could not attest usage refund' USING ERRCODE = 'P0001';
  END IF;
  RETURN refund_result;
END;
$$;
REVOKE ALL ON FUNCTION public.attest_usage_failure(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attest_usage_failure(uuid, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.begin_citation_request(uuid, text, text, text, text, jsonb),
  public.finish_citation_request(uuid, text, uuid, text, text, jsonb),
  public.refund_credits_for_user(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_citation_request(uuid, text, text, text, text, jsonb),
  public.finish_citation_request(uuid, text, uuid, text, text, jsonb),
  public.refund_credits_for_user(uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.refund_credits(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refund_credits(text, text) TO authenticated;

-- Stale async jobs are terminal for presentation but remain financially unknown.
-- PostgreSQL cannot remove existing argument defaults with CREATE OR REPLACE.
-- Deliberately no CASCADE: any real dependencies must be reviewed before rollout.
DROP FUNCTION IF EXISTS public.reap_stale_research_jobs(interval, interval);
CREATE OR REPLACE FUNCTION public.reap_stale_research_jobs(
  _max_age interval,
  _absolute_max_age interval
)
RETURNS TABLE(reaped_id uuid, prior_stage text, stale_seconds double precision)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  j record;
  v_run_id text;
  v_answer text := 'המחקר הופסק בגלל תקלה תשתיתית ולא הושלמה תשובה משפטית מבוססת. לא מוצגת תשובת ביניים. אפשר להריץ שוב, לצמצם את השאלה, או לצרף את המסמך הרלוונטי.';
  v_updated int;
BEGIN
  FOR j IN
    SELECT * FROM public.legal_research_jobs
     WHERE status IN ('running','queued')
       AND created_at < now() - LEAST(_max_age, interval '2 minutes')
       AND (
         (COALESCE(last_progress_at, updated_at) < now() - _max_age
          AND updated_at < now() - _max_age)
         OR COALESCE(resumed_at, created_at) < now() - _absolute_max_age
       )
     FOR UPDATE SKIP LOCKED
  LOOP
    v_run_id := NULLIF(j.result->>'run_id', '');

    -- Timeout is an unknown provider outcome; never attest failure or refund.

    UPDATE public.legal_research_jobs
       SET status = 'timed_out',
           error = 'stale_worker_timeout',
           updated_at = now(),
           completed_at = now(),
           current_stage = NULL,
           progress_label_he = NULL,
           result = jsonb_build_object(
             'answer', '',
             'footnotes', '[]'::jsonb,
             'used_sources', '[]'::jsonb,
             'branch', 'infrastructure_timeout',
             'infrastructure_failure', true,
             'timed_out', true,
             'credits_refunded', false,
             'execution_outcome_unknown', true,
             'notice_he', v_answer,
             'run_id', v_run_id,
             'reaper_terminal_limitation_written', true,
             'prior_stage', j.current_stage,
             'retrieval_checkpoints', COALESCE(j.result->'retrieval_checkpoints', '[]'::jsonb)
           )
     WHERE id = j.id
       AND status IN ('running','queued');

    IF v_run_id IS NOT NULL THEN
      UPDATE public.qa_logs q
         SET answer = v_answer,
             metadata = COALESCE(q.metadata, '{}'::jsonb) || jsonb_build_object(
               'trace_status', 'terminal',
               'branch', 'infrastructure_timeout',
               'infrastructure_failure', true,
               'terminal_result_written', true,
               'reaper_terminal_limitation_written', true,
               'reaped_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
               'prior_stage', j.current_stage
             )
       WHERE q.metadata->>'run_id' = v_run_id
         AND COALESCE(q.metadata->>'trace_status', '') <> 'terminal';
      GET DIAGNOSTICS v_updated = ROW_COUNT;

      IF v_updated = 0 THEN
        INSERT INTO public.qa_logs (
          user_id, project_id, question, answer, task_mode,
          footnotes, local_footnotes_count, perplexity_footnotes_count, total_footnotes,
          metadata
        ) VALUES (
          j.user_id, j.project_id, j.question, v_answer, 'legal_research_v1',
          '[]'::jsonb, 0, 0, 0,
          jsonb_build_object(
            'pipeline', 'legal-research-v1',
            'run_id', v_run_id,
            'trace_status', 'terminal',
            'branch', 'infrastructure_timeout',
            'infrastructure_failure', true,
            'terminal_result_written', true,
            'reaper_terminal_limitation_written', true,
            'prior_stage', j.current_stage
          )
        );
      END IF;
    END IF;

    reaped_id := j.id;
    prior_stage := j.current_stage;
    stale_seconds := EXTRACT(EPOCH FROM (now() - COALESCE(j.last_progress_at, j.updated_at)))::double precision;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Reintroduce a one-argument scheduled entry point, with one unambiguous
-- zero-argument default. Both overloads treat timeout as unknown, never failure.
CREATE OR REPLACE FUNCTION public.reap_stale_research_jobs(_max_age interval DEFAULT '12 minutes'::interval)
RETURNS TABLE(reaped_id uuid, prior_stage text, stale_seconds double precision)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT * FROM public.reap_stale_research_jobs(_max_age, interval '45 minutes');
$$;
REVOKE ALL ON FUNCTION public.reap_stale_research_jobs(interval),
  public.reap_stale_research_jobs(interval, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_stale_research_jobs(interval),
  public.reap_stale_research_jobs(interval, interval) TO service_role, postgres;

COMMIT;
