BEGIN;
DO $$
DECLARE owner_id CONSTANT uuid:='10000000-0000-4000-a000-000000000000';
 admin_id CONSTANT uuid:='20000000-0000-4000-a000-000000000000';
 o uuid; issued timestamptz; result jsonb;
BEGIN
 PERFORM set_config('test.rpc_role','service_role',true);
 PERFORM set_config('test.uid',owner_id::text,true);
 PERFORM test_assert(NOT has_function_privilege('authenticated','public.takbull_manual_base_queue(uuid)','EXECUTE'),'queue private');
 BEGIN
  PERFORM takbull_manual_base_queue(owner_id);
  RAISE EXCEPTION 'ordinary user granted operator queue';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 PERFORM test_assert(takbull_manual_base_intent(owner_id,'citation_week_pass_v1')->>'code'='DISABLED','gate closed');
 UPDATE private.takbull_pilot_config SET enabled=true,verified_merchant_ref='merchant';
 PERFORM test_assert(takbull_manual_base_intent(owner_id,'citation_source_topup_50_v1')->>'code'='UNKNOWN_OFFER','top-up absent');
 o:=(takbull_manual_base_intent(owner_id,'citation_week_pass_v1')->>'order_id')::uuid;
 PERFORM test_assert(takbull_manual_base_intent(owner_id,'citation_month_pass_v1')->>'order_id'=o::text,'one open intent across base products');
 PERFORM test_assert(takbull_manual_base_intent(admin_id,NULL)->>'status'='none','other owner status excludes pending');
 PERFORM test_assert(takbull_manual_base_queue(admin_id)->0->>'order_id'=o::text,'operator queue');
 PERFORM test_assert(takbull_manual_base_settle(admin_id,o,'demand','merchant','tx','doc',3900,'ILS','confirmed_one_time_charge',clock_timestamp())->>'ok'='false','demand evidence required');
 UPDATE private.takbull_pilot_orders SET requested_at=clock_timestamp()-interval '8 hours' WHERE id=o;
 issued:=clock_timestamp()-interval '5 minutes';
 PERFORM test_assert(takbull_manual_base_issue(admin_id,o,'demand','merchant',6500,'ILS',issued)->>'ok'='false','wrong demand amount');
 PERFORM test_assert(takbull_manual_base_issue(admin_id,o,'demand','merchant',3900,'ILS',issued)->>'ok'='true','demand bound');
 PERFORM test_assert(takbull_manual_base_settle(admin_id,o,'demandOther','merchant','tx','doc',3900,'ILS','confirmed_one_time_charge',clock_timestamp())->>'ok'='false','wrong demand reference');
 result:=takbull_manual_base_settle(admin_id,o,'demand','merchant','tx','doc',3900,'ILS','confirmed_one_time_charge',clock_timestamp());
 PERFORM test_assert(result->>'fulfilled'='true','valid payment window based on demand issued, not request');
 PERFORM test_assert(takbull_pilot_my_entitlement()->>'base_sources_purchased'='100','owner 100-source access');
 PERFORM test_assert(takbull_manual_base_intent(owner_id,'citation_month_pass_v1')->>'code'='ALREADY_ACTIVE','no overlapping order');
 PERFORM test_assert(takbull_manual_base_refund(admin_id,o,'merchant','tx','refund','credit','confirmed_full_refund')->>'ok'='true','verified refund');
 PERFORM test_assert((SELECT count(*)=3 AND bool_and(actor_id=admin_id) FROM private.takbull_manual_operator_audit),'operator audit');
 PERFORM test_assert(takbull_pilot_my_entitlement()->>'active'='false','refund removes access');
END;
$$;
ROLLBACK;
