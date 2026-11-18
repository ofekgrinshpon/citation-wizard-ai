\set ON_ERROR_STOP on
SET lab.role='service_role';
INSERT INTO public.profiles(id,plan) VALUES('11111111-1111-4111-8111-111111111111','trial'),('22222222-2222-4222-8222-222222222222','month'),('33333333-3333-4333-8333-333333333333','month'),('44444444-4444-4444-8444-444444444444','admin'),('55555555-5555-4555-8555-555555555555','trial');
UPDATE public.profiles SET billing_period_ends_at=now()-interval '1 day' WHERE id='33333333-3333-4333-8333-333333333333';
UPDATE public.citation_trial_config SET enabled=true;
DO $$ DECLARE u uuid:='11111111-1111-4111-8111-111111111111'; f text:=repeat('a',64); r jsonb; token uuid; i int;
BEGIN
 FOR i IN 1..5 LOOP
 r:=public.begin_citation_request(u,'provider-'||i,f,'batch',NULL,jsonb_build_object('fingerprint',f,'batchId','batch'));
 PERFORM public.lab_assert(r @> '{"ok":true,"execute":true,"charged":1}','five independently charged sources');
 IF i=1 THEN token:=(r->>'attempt_token')::uuid; END IF;
 END LOOP;
 r:=public.begin_citation_request(u,'provider-6',f,'batch',NULL,jsonb_build_object('fingerprint',f,'batchId','batch'));
 PERFORM public.lab_assert(r->>'block_reason'='trial_exhausted','sixth denied');
 r:=public.begin_citation_request(u,'provider-1',f,'batch',NULL,jsonb_build_object('fingerprint',f,'batchId','batch'));
 PERFORM public.lab_assert(r @> '{"ok":true,"execute":false}', 'replay no execution');
 PERFORM public.lab_assert((SELECT count(*)=0 FROM public.credit_ledger WHERE user_id=u),'no weighted trial debit');
 r:=public.finish_citation_request(u,'provider-1',token,'failed','known failure',NULL);
 PERFORM public.lab_assert(r @> '{"ok":true,"refunded":true}','known failed release');
 r:=public.begin_citation_request(u,'provider-6',f,'batch',NULL,jsonb_build_object('fingerprint',f,'batchId','batch'));
 PERFORM public.lab_assert(r @> '{"ok":true,"execute":true}','freed slot usable');
 r:=public.finish_citation_request(u,'provider-6',(r->>'attempt_token')::uuid,'unknown','uncertain',NULL);
 PERFORM public.lab_assert(r @> '{"ok":true,"refunded":false}','unknown retained');
 r:=public.begin_citation_request(u,'provider-7',f,'batch',NULL,jsonb_build_object('fingerprint',f,'batchId','batch'));
 PERFORM public.lab_assert(r->>'block_reason'='trial_exhausted','unknown did not free');
END $$;
DO $$ DECLARE u uuid; r jsonb; f text:=repeat('b',64); BEGIN
 FOREACH u IN ARRAY ARRAY['22222222-2222-4222-8222-222222222222'::uuid,'33333333-3333-4333-8333-333333333333'::uuid,'44444444-4444-4444-8444-444444444444'::uuid] LOOP
 r:=public.begin_citation_request(u,'paid-check',f,NULL,NULL,jsonb_build_object('fingerprint',f));
 PERFORM public.lab_assert(r @> '{"ok":true,"execute":true}','paid/expired/admin execute');
 IF u='33333333-3333-4333-8333-333333333333'::uuid THEN
 PERFORM public.lab_assert(r->>'trial'='true','expired returns trial');
 ELSE
 PERFORM public.lab_assert(NOT(r ? 'trial'),'paid/admin stays legacy');
 END IF;
 r:=public.finish_citation_request(u,'paid-check',(r->>'attempt_token')::uuid,'succeeded',NULL,'{"citation":"synthetic"}');
 PERFORM public.lab_assert(r @> '{"ok":true,"result_stored":true}','success committed with recovery');
 END LOOP;
 PERFORM public.lab_assert((SELECT included_credits_remaining=99 FROM public.profiles WHERE id='22222222-2222-4222-8222-222222222222'),'paid charged once');
 PERFORM public.lab_assert((SELECT included_credits_remaining=100 FROM public.profiles WHERE id='44444444-4444-4444-8444-444444444444'),'admin not charged');
END $$;
SET ROLE authenticated;
SET lab.role='authenticated';
SET lab.uid='55555555-5555-4555-8555-555555555555';
SELECT public.lab_assert(public.consume_local_citation_trial('local-stale',repeat('a',64),'11111111-1111-4111-8111-111111111111')->>'error'='CITATION_RETRY_STALE','stale account');
SELECT public.lab_assert(public.consume_local_citation_trial('local-ok',repeat('a',64),'55555555-5555-4555-8555-555555555555') @> '{"ok":true,"remaining":4}','authenticated local debit');
SELECT public.lab_assert(public.consume_local_citation_trial('local-ok',repeat('a',64),'55555555-5555-4555-8555-555555555555') @> '{"ok":true,"replayed":true,"remaining":4}','local idempotent');
SELECT public.lab_assert(NOT has_table_privilege(current_user,'public.citation_trial_sources','UPDATE'),'owner cannot refund');
SELECT public.lab_assert(NOT has_table_privilege(current_user,'public.citation_trial_config','UPDATE'),'owner cannot enable');
SELECT public.lab_assert(NOT has_function_privilege(current_user,'public.begin_citation_request(uuid,text,text,text,text,jsonb)','EXECUTE'),'owner cannot provider begin');
RESET ROLE;
SELECT 'PASS synthetic accounting and privileges';
