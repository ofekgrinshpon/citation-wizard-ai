-- Meter covers Quick, Word and bibliography requests using identical RPCs;
-- use synthetic IDs and provider states below, never a real provider.
BEGIN;
DO $$
DECLARE uid CONSTANT uuid:='10000000-0000-4000-a000-000000000000';
 outsider CONSTANT uuid:='20000000-0000-4000-a000-000000000000';
 f CONSTANT text:=repeat('a',64);
 payload jsonb:=jsonb_build_object('fingerprint',f,'batchId','batch-1');
 base uuid; extra uuid; attempt uuid; first_nonce uuid; b jsonb; started timestamptz;
BEGIN
 PERFORM set_config('lab.role','service_role',true);
 PERFORM set_config('lab.uid',uid::text,true);
 INSERT INTO public.profiles(id) VALUES(uid),(outsider);
 UPDATE private.takbull_pilot_config SET enabled=true,verified_merchant_ref='sandbox';
 base:=(public.takbull_pilot_prepare(uid,'citation_week_pass_v1')->>'order_id')::uuid;
 PERFORM lab_assert((public.takbull_pilot_record_payment(base,'sandbox','BASE','DBASE',3900,'ILS','confirmed_one_time_charge',clock_timestamp())->>'ok')::boolean,'base receipt');
 extra:=(public.takbull_pilot_prepare(uid,'citation_source_topup_50_v1')->>'order_id')::uuid;
 PERFORM lab_assert((public.takbull_pilot_record_payment(extra,'sandbox','EXTRA','DEXTRA',1500,'ILS','confirmed_one_time_charge',clock_timestamp())->>'ok')::boolean,'50 receipt');
 PERFORM lab_assert(get_citation_trial_status()->>'remaining'='150','paid source quota combines only current pass plus its addon');
 PERFORM lab_assert(NOT has_table_privilege('authenticated','private.takbull_pilot_source_usage','INSERT'),'private rows');
 PERFORM lab_assert((public.consume_local_citation_trial('local-1',f,uid)->>'remaining')='149','fresh local quick hash');
 PERFORM lab_assert((public.consume_local_citation_trial('local-1',f,uid)->>'remaining')='149','local replay no debit');
 PERFORM lab_assert((public.consume_local_citation_trial('local-1',repeat('b',64),uid)->>'error')='REQUEST_FINGERPRINT_MISMATCH','different fingerprint denied');
 PERFORM lab_assert((public.begin_citation_request(uid,'local-1',f,'batch-1',NULL,payload)->>'error')='REQUEST_ID_ALREADY_USED','no local id provider reuse');
 b:=public.begin_citation_request(uid,'word-1',f,'batch-1',NULL,payload);
 first_nonce:=(b->>'attempt_token')::uuid;
 PERFORM lab_assert(b->>'charged'='1' AND b->>'paid_source_meter'='true','paid provider word reservation');
 PERFORM lab_assert(public.begin_citation_request(uid,'word-1',f,'batch-1',NULL,payload)->>'execute'='false','replay before finish');
 PERFORM lab_assert((public.consume_local_citation_trial('word-1',f,uid)->>'error')='REQUEST_FINGERPRINT_MISMATCH','provider id local reuse denied');
 b:=public.begin_citation_request(uid,'word-2',f,'batch-1',NULL,payload);
 attempt:=(b->>'attempt_token')::uuid;
 PERFORM lab_assert(b->>'charged'='1','no legacy batching freebies');
 PERFORM lab_assert(get_citation_trial_status()->>'remaining'='147','local/word share meter');
 PERFORM lab_assert((public.finish_citation_request(uid,'word-1',gen_random_uuid(),'failed',NULL,NULL)->>'error')='ATTEMPT_TOKEN_MISMATCH','only correct attempt can finish');
 PERFORM lab_assert((public.finish_citation_request(uid,'word-1',first_nonce,'failed',NULL,NULL)->>'refunded')='true','definitive failure returns one to original bucket');
 PERFORM lab_assert(get_citation_trial_status()->>'remaining'='148','one returned');
 PERFORM lab_assert((public.finish_citation_request(uid,'word-1',first_nonce,'failed',NULL,NULL)->>'replayed')='true','failure replay');
 PERFORM lab_assert(get_citation_trial_status()->>'remaining'='148','no double refund');
 PERFORM lab_assert((public.finish_citation_request(uid,'word-2',attempt,'unknown',NULL,NULL)->>'refunded')='false','uncertain keeps seat');
 PERFORM lab_assert(get_citation_trial_status()->>'remaining'='148','uncertain retained');
 b:=public.begin_citation_request(uid,'bib-1',f,'batch-1','word-1',payload);
 attempt:=(b->>'attempt_token')::uuid;
 PERFORM lab_assert(attempt IS NOT NULL,'retry reuses fingerprint under fresh paid reservation');
 PERFORM lab_assert((public.finish_citation_request(uid,'bib-1',attempt,'succeeded',NULL,'{}')->>'result_stored')='true','success persists recovery');
 PERFORM lab_assert(get_citation_trial_status()->>'remaining'='147','bibliography shared provider accounting');
 PERFORM lab_assert(NOT EXISTS(SELECT 1 FROM public.credit_ledger) AND NOT EXISTS(SELECT 1 FROM public.citation_trial_sources),'no shared legacy/trial ledger debits');
 -- Fill remaining synthetic capacity, verify exactly one more shared debit, no pay-to-legacy fallback.
 INSERT INTO private.takbull_pilot_source_usage(user_id,request_id,fingerprint,route,payment_order_id,state)
 SELECT uid,'base-pad-'||n,f,'local',base,'succeeded' FROM generate_series(1,97) n;
 INSERT INTO private.takbull_pilot_source_usage(user_id,request_id,fingerprint,route,payment_order_id,state)
 SELECT uid,'topup-pad-'||n,f,'local',extra,'succeeded' FROM generate_series(1,49) n;
 PERFORM lab_assert(get_citation_trial_status()->>'remaining'='1','single shared last source');
 PERFORM lab_assert((public.consume_local_citation_trial('local-final',f,uid)->>'remaining')='0','final unit from paid add-on');
 PERFORM lab_assert((public.begin_citation_request(uid,'final-denied',f,'batch-1',NULL,payload)->>'block_reason')='plan_allowance','provider depletion no fallback');
 PERFORM lab_assert((public.consume_local_citation_trial('local-denied',f,uid)->>'error')='TRIAL_EXHAUSTED','local depletion no fallback');
 PERFORM lab_assert(public.takbull_pilot_record_full_refund(extra,'sandbox','EXTRA','R1','RD1','confirmed_full_refund')->>'ok'='true','add-on reversal');
 PERFORM lab_assert(get_citation_trial_status()->>'limit'='100','refunded add-on excluded');
 PERFORM lab_assert(public.takbull_pilot_record_full_refund(base,'sandbox','BASE','R2','RD2','confirmed_full_refund')->>'ok'='true','base reversal');
 PERFORM lab_assert(get_citation_trial_status()->>'limit'='5','no paid capacity once base revoked');
 PERFORM lab_assert(public.consume_local_citation_trial('local-final',f,uid)->>'replayed'='true','read old same-id local result, no new debit');
 PERFORM lab_assert(NOT EXISTS(SELECT 1 FROM public.citation_trial_sources),'historical paid replay does not burn trial');
 PERFORM set_config('lab.uid',outsider::text,true);
 PERFORM lab_assert(get_citation_trial_status()->>'limit'='5' AND NOT(get_citation_trial_status()?'paid_source_meter'),'unrelated owner unaffected');
END;
$$;
DO $$
DECLARE uid CONSTANT uuid:='30000000-0000-4000-a000-000000000000';
 f CONSTANT text:=repeat('c',64);
 payload jsonb:=jsonb_build_object('fingerprint',f);
 cycle uuid; supplement uuid; attempt uuid; out jsonb;
BEGIN
 PERFORM set_config('lab.role','service_role',true);
 PERFORM set_config('lab.uid',uid::text,true);
 INSERT INTO public.profiles(id) VALUES(uid);
 cycle:=(public.takbull_pilot_prepare(uid,'citation_week_pass_v1')->>'order_id')::uuid;
 PERFORM lab_assert((public.takbull_pilot_record_payment(cycle,'sandbox','BASEEXP','DBASEEXP',3900,'ILS','confirmed_one_time_charge',clock_timestamp())->>'ok')::boolean,'expiry base fixture');
 supplement:=(public.takbull_pilot_prepare(uid,'citation_source_topup_50_v1')->>'order_id')::uuid;
 PERFORM lab_assert((public.takbull_pilot_record_payment(supplement,'sandbox','EXTRAEXP','DEXTRAEXP',1500,'ILS','confirmed_one_time_charge',clock_timestamp())->>'ok')::boolean,'expiry add-on fixture');
 out:=public.begin_citation_request(uid,'before-expiry',f,NULL,NULL,payload);
 attempt:=(out->>'attempt_token')::uuid;
 PERFORM lab_assert(attempt IS NOT NULL,'in-flight paid request');
 -- Synthetic clock transition in fixture: never rewrite production receipts.
 UPDATE private.takbull_pilot_receipts SET starts_at=clock_timestamp()-interval '7 days',ends_at=clock_timestamp()-interval '1 hour'
 WHERE order_id IN (cycle,supplement);
 PERFORM lab_assert(get_citation_trial_status()->>'limit'='5','base and add-on expire together');
 out:=public.finish_citation_request(uid,'before-expiry',attempt,'failed',NULL,NULL);
 PERFORM lab_assert(out->>'refunded'='false' AND out->>'status'='failed','expired reservation terminally released without offering phantom credit');
 PERFORM lab_assert((SELECT state='failed' AND NOT released_while_active FROM private.takbull_pilot_source_usage
 WHERE user_id=uid AND request_id='before-expiry'),'historical released bucket does not spill forward');
 PERFORM lab_assert(get_citation_trial_status()->>'remaining'='5','trial quota untouched by old paid refund');
END;
$$;
ROLLBACK;
