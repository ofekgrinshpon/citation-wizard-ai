-- AUTHORED ONLY. Run only after explicit fixture authorization and prerequisites.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'relex_usage_fixture_%' THEN RAISE EXCEPTION 'Not a fixture DB'; END IF;
END $$;
BEGIN;
INSERT INTO public.profiles(id,plan) VALUES('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','trial');
UPDATE public.citation_trial_config SET enabled=true WHERE singleton;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}',true);
DO $$
DECLARE u uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'; r jsonb; i integer;
BEGIN
 r:=public.consume_local_citation_trial('local-stale',repeat('a',64),'ffffffff-ffff-4fff-8fff-ffffffffffff');
 PERFORM public.fixture_assert(r->>'error'='CITATION_RETRY_STALE','stale auth does not charge');
 PERFORM public.fixture_assert((SELECT count(*)=0 FROM public.citation_trial_sources WHERE user_id=u),'no stale ledger');
 FOR i IN 1..5 LOOP
  r:=public.consume_local_citation_trial('local-'||i,repeat('a',64),u);
  PERFORM public.fixture_assert(r @> '{"ok":true,"limited":true,"replayed":false}','debit one local source');
 END LOOP;
 r:=public.consume_local_citation_trial('local-1',repeat('a',64),u);
 PERFORM public.fixture_assert(r @> '{"ok":true,"replayed":true,"remaining":0}','local last-slot replay safe');
 r:=public.consume_local_citation_trial('local-1',repeat('b',64),u);
 PERFORM public.fixture_assert(r->>'error'='REQUEST_FINGERPRINT_MISMATCH','cannot reuse source ID with changed content');
 r:=public.consume_local_citation_trial('local-6',repeat('a',64),u);
 PERFORM public.fixture_assert(r->>'error'='TRIAL_EXHAUSTED','sixth local denied');
 PERFORM public.fixture_assert(NOT has_function_privilege('anon','public.consume_local_citation_trial(text,text,uuid)','EXECUTE'),'anonymous debit denied');
 PERFORM public.fixture_assert(NOT has_table_privilege('authenticated','public.citation_trial_sources','UPDATE'),'no client refunds');
 PERFORM public.fixture_assert(NOT has_table_privilege('authenticated','public.citation_trial_config','UPDATE'),'no client activation');
END $$;
ROLLBACK;
