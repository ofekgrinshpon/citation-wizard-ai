-- AUTHORED ONLY: requires separate disposable PostgreSQL fixture approval/setup.
-- Load the existing usage-guards fixture + its migrations, then the new migration.
-- No production data and no network/provider calls are used by these assertions.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'relex_usage_fixture_%' THEN RAISE EXCEPTION 'Not a fixture DB'; END IF;
END $$;
BEGIN;
UPDATE public.citation_trial_config SET enabled=true WHERE singleton;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
DO $$
DECLARE u uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; r jsonb; t uuid; i integer;
BEGIN
 INSERT INTO public.profiles(id,plan) VALUES(u,'trial');
 FOR i IN 1..5 LOOP
   r:=public.fixture_begin_citation_request(u,'trial-source-'||i,repeat('a',64),'shared-document');
   PERFORM public.fixture_assert(r @> '{"ok":true,"execute":true,"charged":1}', 'one source reservation');
   IF i=1 THEN t:=(r->>'attempt_token')::uuid; END IF;
 END LOOP;
 r:=public.fixture_begin_citation_request(u,'trial-source-6',repeat('a',64),'shared-document');
 PERFORM public.fixture_assert(r->>'block_reason'='trial_exhausted','sixth denied even in batch');
 PERFORM public.fixture_assert((SELECT count(*)=0 FROM public.credit_ledger WHERE user_id=u),'no weighted charge');
 r:=public.fixture_begin_citation_request(u,'trial-source-1',repeat('a',64),'shared-document');
 PERFORM public.fixture_assert(r @> '{"ok":true,"execute":false}', 'last-slot replay not charged/executed');
 r:=public.fixture_finish_citation_request(u,'trial-source-1',t,'failed','confirmed failure');
 PERFORM public.fixture_assert(r @> '{"ok":true,"refunded":true}', 'failed source refunded');
 r:=public.fixture_begin_citation_request(u,'trial-source-6',repeat('a',64),'shared-document');
 PERFORM public.fixture_assert(r @> '{"ok":true,"execute":true}', 'replacement can reserve exactly one');
 r:=public.fixture_finish_citation_request(u,'trial-source-6',(r->>'attempt_token')::uuid,'unknown','lost response');
 r:=public.fixture_begin_citation_request(u,'trial-source-7',repeat('a',64),'shared-document');
 PERFORM public.fixture_assert(r->>'block_reason'='trial_exhausted','unknown remains reserved');
END $$;
ROLLBACK;
