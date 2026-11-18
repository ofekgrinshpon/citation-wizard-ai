SET lab.role='service_role';
DO $$ DECLARE u uuid:='11111111-1111-4111-8111-111111111111'; r jsonb; t uuid; BEGIN
 SELECT attempt_token INTO t FROM citation_usage_requests WHERE user_id=u AND request_id='provider-1';
 r:=finish_citation_request(u,'provider-1',t,'failed','again',NULL);
 PERFORM lab_assert(r @> '{"ok":true,"replayed":true,"refunded":true}','failed replay does not refund another slot');
 PERFORM lab_assert((SELECT count(*)=5 FROM citation_trial_sources WHERE user_id=u AND state<>'failed'),'failed replay exact count');
 SELECT attempt_token INTO t FROM citation_usage_requests WHERE user_id='33333333-3333-4333-8333-333333333333' AND request_id='paid-check';
 r:=finish_citation_request('33333333-3333-4333-8333-333333333333','paid-check',t,'failed','later',NULL);
 PERFORM lab_assert(r->>'error'='TERMINAL_STATE_CONFLICT','success cannot refund');
END $$;
SET ROLE authenticated;
SET lab.role='authenticated';
SET lab.uid='55555555-5555-4555-8555-555555555555';
SELECT lab_assert(get_citation_trial_status() @> '{"ok":true,"enabled":true,"limited":true,"used":1,"remaining":4}','owner status');
DO $$ DECLARE i int; r jsonb; BEGIN
 FOR i IN 2..5 LOOP
 r:=consume_local_citation_trial('local-'||i,repeat('b',64),'55555555-5555-4555-8555-555555555555');
 PERFORM lab_assert(r->>'ok'='true','local five');
 END LOOP;
 r:=consume_local_citation_trial('local-6',repeat('b',64),'55555555-5555-4555-8555-555555555555');
 PERFORM lab_assert(r->>'error'='TRIAL_EXHAUSTED','local sixth denied');
 r:=consume_local_citation_trial('local-ok',repeat('b',64),'55555555-5555-4555-8555-555555555555');
 PERFORM lab_assert(r->>'error'='REQUEST_FINGERPRINT_MISMATCH','local changed content denied');
END $$;
RESET ROLE;
UPDATE profiles SET plan='month',billing_period_ends_at=now()+interval '1 day' WHERE id='55555555-5555-4555-8555-555555555555';
SET ROLE authenticated;
SELECT lab_assert(get_citation_trial_status() @> '{"limited":false,"used":5,"remaining":0}','upgrade preserves trial exhausted ledger');
RESET ROLE;
UPDATE profiles SET billing_period_ends_at=now()-interval '1 day' WHERE id='55555555-5555-4555-8555-555555555555';
SET ROLE authenticated;
SELECT lab_assert(get_citation_trial_status() @> '{"limited":true,"used":5,"remaining":0}','expiry does not reset ledger');
RESET ROLE;
UPDATE citation_trial_config SET enabled=false;
SET ROLE authenticated;
SELECT lab_assert(get_citation_trial_status() @> '{"enabled":false,"limited":false,"used":5}','rollback preserves ledger');
RESET ROLE;
UPDATE citation_trial_config SET enabled=true;
SELECT 'PASS extra settlement lifecycle and local quota';
