SET lab.role='service_role';
DO $$ DECLARE r jsonb; f text:=repeat('a',64); BEGIN
 r:=begin_citation_request('55555555-5555-4555-8555-555555555555','local-ok',f,NULL,NULL,jsonb_build_object('fingerprint',f));
 PERFORM lab_assert(r->>'error'='REQUEST_ID_ALREADY_USED','local debit never authorizes provider claim');
END $$;
SET ROLE authenticated;
SET lab.role='authenticated';
SET lab.uid='11111111-1111-4111-8111-111111111111';
SELECT lab_assert(consume_local_citation_trial('provider-2',repeat('a',64),'11111111-1111-4111-8111-111111111111')->>'error'='REQUEST_FINGERPRINT_MISMATCH','provider claim cannot be reused as local');
RESET ROLE;
SELECT 'PASS cross-route collision guards';
