-- AUTHORED ONLY, NEVER EXECUTED. Separate SQL execution approval required.
-- Run only after fixture.sql in a new disposable cluster. No production data.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'relex_usage_fixture_%' THEN RAISE EXCEPTION 'Refusing non-fixture database'; END IF;
END $$;
BEGIN;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
-- Cross-runtime hash vector, authored only; verify on PostgreSQL after approval.
SELECT public.fixture_assert(public._citation_execution_fingerprint($payload${"messages":[{"role":"user","content":"Fixture \n\"ציטוט\" Ω"}],"rawInput":null,"foreignLookup":{"enabled":false,"parsedFields":{"title":" A ","authors":"B"}},"batchId":null}$payload$::jsonb)='31b4a0f82b34786efe1dda54143f0ccb066fc2735f097d82f9acd2f133d299b0', 'canonical UTF-8 fingerprint parity');
DO $$
DECLARE
  owner_id uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  other_id uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  body jsonb := public.fixture_execution_input('recovery-body');
  output jsonb := '{"content":"Synthetic delivered citation"}';
  fp text; r jsonb; token uuid; prior_balance integer; prior_ledger integer;
BEGIN
  INSERT INTO public.profiles(id) VALUES (owner_id), (other_id);
  fp := public._citation_execution_fingerprint(body);
  SELECT included_credits_remaining INTO prior_balance FROM public.profiles WHERE id = owner_id;
  r := public.begin_citation_request(owner_id,'recovery-success',repeat('f',64),NULL,NULL,body);
  PERFORM public.fixture_assert(r->>'error'='INVALID_RECOVERY_INPUT','fingerprint must bind exact payload');
  PERFORM public.fixture_assert(NOT EXISTS(SELECT 1 FROM public.citation_usage_requests WHERE user_id=owner_id),'invalid input creates no claim');
  PERFORM public.fixture_assert((SELECT included_credits_remaining=prior_balance FROM public.profiles WHERE id=owner_id),'invalid input performs no debit');
  r := public.begin_citation_request(owner_id,'recovery-success',fp,NULL,NULL,body);
  token := (r->>'attempt_token')::uuid;
  PERFORM public.fixture_assert(r @> '{"execute":true}', 'claim succeeds');
  PERFORM public.fixture_assert((SELECT p.input=body AND p.expires_at=c.created_at+interval '24 hours'
    FROM public.citation_recovery_payloads p JOIN public.citation_usage_requests c USING(user_id,request_id)
    WHERE p.user_id=owner_id AND p.request_id='recovery-success'), 'exact input and fixed TTL persisted with claim');
  r := public.read_citation_recovery(other_id,'recovery-success');
  PERFORM public.fixture_assert(r='{"requests":[],"nextCursor":null}'::jsonb,'cross-account lookup indistinguishable from missing');
  r := public.read_citation_recovery(owner_id,'recovery-success');
  PERFORM public.fixture_assert(r#>>'{requests,0,availability}'='pending','running claim is pending');
  r := public.finish_citation_request(owner_id,'recovery-success',token,'succeeded',NULL,'{}'::jsonb);
  PERFORM public.fixture_assert(r->>'error'='INVALID_RECOVERY_RESULT','empty result cannot authorize success');
  r := public.finish_citation_request(owner_id,'recovery-success',token,'succeeded',NULL,output);
  PERFORM public.fixture_assert(r @> '{"ok":true,"result_stored":true}', 'result and success committed together');
  r := public.finish_citation_request(owner_id,'recovery-success',token,'succeeded',NULL,output);
  PERFORM public.fixture_assert(r @> '{"ok":true,"replayed":true,"result_stored":true}', 'identical terminal result is idempotent');
  r := public.finish_citation_request(owner_id,'recovery-success',token,'succeeded',NULL,'{"content":"Overwrite forbidden"}');
  PERFORM public.fixture_assert(r->>'error'='RESULT_CONFLICT','different terminal content rejected');
  PERFORM public.fixture_assert((SELECT result=output FROM public.citation_recovery_payloads WHERE user_id=owner_id AND request_id='recovery-success'),'first result immutable');
  r := public.refund_credits_for_user(owner_id,'recovery-success','a read must not refund');
  PERFORM public.fixture_assert(r->>'error'='TRUSTED_FAILURE_REQUIRED','successful recovery never grants refund');
  r := public.read_citation_recovery(owner_id,'recovery-success');
  PERFORM public.fixture_assert(r#>'{requests,0,result}'=output,'owner reads stored output');
  PERFORM public.fixture_assert(NOT (r->'requests'->0 ?| ARRAY['attempt_token','fingerprint','user_id','charged_units']),'read hides execution and account internals');
  SELECT count(*) INTO prior_ledger FROM public.credit_ledger WHERE user_id=owner_id;
  -- Authorized synthetic time manipulation only, preserving claim-relative TTL.
  UPDATE public.citation_usage_requests SET created_at=clock_timestamp()-interval '25 hours' WHERE user_id=owner_id AND request_id='recovery-success';
  UPDATE public.citation_recovery_payloads p SET expires_at=c.created_at+interval '24 hours'
    FROM public.citation_usage_requests c WHERE p.user_id=c.user_id AND p.request_id=c.request_id AND p.user_id=owner_id;
  r := public.read_citation_recovery(owner_id,'recovery-success');
  PERFORM public.fixture_assert(r#>>'{requests,0,availability}'='expired' AND r#>'{requests,0,input}'='null'::jsonb AND r#>'{requests,0,result}'='null'::jsonb,'read cutoff before cleanup');
  PERFORM public.cleanup_citation_recovery();
  PERFORM public.fixture_assert(NOT EXISTS(SELECT 1 FROM public.citation_recovery_payloads WHERE user_id=owner_id),'physical cleanup removes only expired content');
  PERFORM public.fixture_assert((SELECT state='succeeded' AND result_fingerprint IS NOT NULL FROM public.citation_usage_requests WHERE user_id=owner_id AND request_id='recovery-success'),'claim/hash survive cleanup');
  PERFORM public.fixture_assert((SELECT count(*)=prior_ledger FROM public.credit_ledger WHERE user_id=owner_id),'accounting survives cleanup');
  r := public.finish_citation_request(owner_id,'recovery-success',token,'succeeded',NULL,'{"content":"Overwrite after cleanup forbidden"}');
  PERFORM public.fixture_assert(r->>'error'='RESULT_CONFLICT','retained result hash prevents changed terminal result after cleanup');
END $$;
ROLLBACK;
