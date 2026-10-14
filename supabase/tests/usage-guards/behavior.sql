-- AUTHORED ONLY. Do not execute without separate approval; no SQL runtime verification claimed.
\set ON_ERROR_STOP on
-- Load only after fixture.sql in a dedicated, disposable fixture database.
DO $$ BEGIN
  IF current_database() NOT LIKE 'relex_usage_fixture_%' THEN RAISE EXCEPTION 'Refusing non-fixture database'; END IF;
END $$;
BEGIN;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $$ DECLARE t text; r text; p text; f text; BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public._require_usage_service()',
    'public.read_citation_recovery(uuid,text,text,text,integer)',
    'public.cleanup_citation_recovery(integer)',
    'public._citation_refund_receipt(uuid,text)',
    'public.begin_citation_request(uuid,text,text,text,text,jsonb)',
    'public.finish_citation_request(uuid,text,uuid,text,text,jsonb)',
    'public.attest_usage_failure(uuid,text,text)',
    'public.refund_credits_for_user(uuid,text,text)'
  ] LOOP
    PERFORM public.fixture_assert(NOT has_function_privilege('anon',f,'EXECUTE'), 'anon blocked: '||f);
    PERFORM public.fixture_assert(NOT has_function_privilege('authenticated',f,'EXECUTE'), 'owner blocked: '||f);
    PERFORM public.fixture_assert(has_function_privilege('service_role',f,'EXECUTE'), 'service allowed: '||f);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['citation_usage_requests','usage_terminal_failures','citation_recovery_payloads'] LOOP
    PERFORM public.fixture_assert((SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||t)::regclass), 'RLS enabled: '||t);
    FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
      FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
        PERFORM public.fixture_assert(NOT has_table_privilege(r,'public.'||t,p), 'no owner table privilege: '||r||' '||t||' '||p);
      END LOOP;
    END LOOP;
    PERFORM public.fixture_assert(has_table_privilege('service_role','public.'||t,'SELECT,INSERT,UPDATE,DELETE'), 'service table access: '||t);
  END LOOP;
END $$;


DO $$
DECLARE
  u uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  other uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  r jsonb; duplicate jsonb; terminal jsonb; token uuid; anchor_token uuid;
  i integer; before_balance integer; before_count integer;
BEGIN
  INSERT INTO public.profiles(id) VALUES (u), (other);
  r := public.fixture_begin_citation_request(u, 'request-first', repeat('a',64));
  token := (r->>'attempt_token')::uuid;
  PERFORM public.fixture_assert(r @> '{"ok":true,"execute":true,"status":"in_progress"}', 'fresh claim executes');
  PERFORM public.fixture_assert(token IS NOT NULL, 'fresh claim receives token');
  PERFORM public.fixture_assert((SELECT included_credits_remaining = 139 FROM public.profiles WHERE id=u), 'one included unit charged');
  duplicate := public.fixture_begin_citation_request(u, 'request-first', repeat('a',64));
  PERFORM public.fixture_assert(duplicate @> '{"ok":true,"execute":false,"status":"in_progress"}', 'duplicate cannot execute');
  PERFORM public.fixture_assert(NOT duplicate ? 'attempt_token', 'duplicate never receives token');
  PERFORM public.fixture_assert((SELECT count(*)=1 FROM public.credit_ledger WHERE user_id=u AND request_id='request-first'), 'one consume row');
  r := public.fixture_begin_citation_request(u, 'request-first', repeat('b',64));
  PERFORM public.fixture_assert(r->>'error'='REQUEST_FINGERPRINT_MISMATCH', 'changed payload rejected');
  r := public.fixture_begin_citation_request(u, 'request-first', repeat('a',64), 'different-batch');
  PERFORM public.fixture_assert(r->>'error'='REQUEST_FINGERPRINT_MISMATCH', 'changed batch rejected');
  r := public.fixture_finish_citation_request(u, 'request-first', gen_random_uuid(), 'failed', 'forged token');
  PERFORM public.fixture_assert(r->>'error'='ATTEMPT_TOKEN_MISMATCH', 'forged token rejected');
  r := public.fixture_finish_citation_request(other, 'request-first', token, 'failed', 'cross user');
  PERFORM public.fixture_assert(r->>'error'='REQUEST_NOT_FOUND', 'cross-user finish denied');
  r := public.fixture_finish_citation_request(u, 'request-first', token, 'succeeded', NULL);
  PERFORM public.fixture_assert(r @> '{"ok":true,"status":"succeeded","refunded":false}', 'success terminal no refund');
  r := public.fixture_finish_citation_request(u, 'request-first', token, 'failed', 'late failure');
  PERFORM public.fixture_assert(r->>'error'='TERMINAL_STATE_CONFLICT', 'success immutable');
  r := public.refund_credits_for_user(u, 'request-first', 'please refund success');
  PERFORM public.fixture_assert(r->>'error'='TRUSTED_FAILURE_REQUIRED', 'service helper cannot refund success');
  r := public.attest_usage_failure(u, 'request-first', 'legacy bypass');
  PERFORM public.fixture_assert(r->>'error'='CITATION_ATTEMPT_REQUIRED', 'legacy attestation cannot bypass citation token');
  r := public.fixture_begin_citation_request(u, 'request-first', repeat('a',64));
  PERFORM public.fixture_assert(r @> '{"execute":false,"status":"succeeded"}', 'completed replay cannot execute');

  r := public.fixture_begin_citation_request(u, 'unknown-work', repeat('c',64));
  token := (r->>'attempt_token')::uuid;
  r := public.fixture_finish_citation_request(u, 'unknown-work', token, 'unknown', 'transport uncertain');
  PERFORM public.fixture_assert(r @> '{"ok":true,"status":"unknown","refunded":false}', 'unknown retained');
  r := public.fixture_finish_citation_request(u, 'unknown-work', token, 'failed', 'later retry');
  PERFORM public.fixture_assert(r->>'error'='TERMINAL_STATE_CONFLICT', 'unknown cannot auto-transition to refundable failure');
  UPDATE public.citation_usage_requests SET created_at=now()-interval '30 days' WHERE user_id=u AND request_id='unknown-work';
  r := public.fixture_begin_citation_request(u, 'unknown-work', repeat('c',64));
  PERFORM public.fixture_assert(r @> '{"execute":false,"status":"unknown"}', 'age never permits retry');

  r := public.fixture_begin_citation_request(u, 'failed-work', repeat('d',64));
  token := (r->>'attempt_token')::uuid;
  SELECT included_credits_remaining INTO before_balance FROM public.profiles WHERE id=u;
  r := public.fixture_finish_citation_request(u, 'failed-work', token, 'failed', 'known provider rejection');
  PERFORM public.fixture_assert(r @> '{"ok":true,"status":"failed","refunded":true}', 'known failure refunded');
  PERFORM public.fixture_assert((SELECT included_credits_remaining=before_balance+1 FROM public.profiles WHERE id=u), 'exact original unit restored');
  r := public.fixture_finish_citation_request(u, 'failed-work', token, 'failed', 'retry finalize');
  PERFORM public.fixture_assert(r @> '{"ok":true,"replayed":true,"refunded":true}', 'finalize repeat is read-only');
  r := public.refund_credits_for_user(u, 'failed-work', 'retry refund');
  PERFORM public.fixture_assert(r @> '{"ok":true,"replayed":true,"refunded":true}', 'refund repeat read-only');
  PERFORM public.fixture_assert((SELECT count(*)=1 FROM public.credit_ledger WHERE user_id=u AND request_id='failed-work' AND event_type='refund'), 'single refund');
  PERFORM public.fixture_assert((SELECT included_credits_remaining=before_balance+1 FROM public.profiles WHERE id=u), 'repeat never overcredits');
  r := public.fixture_begin_citation_request(u, 'failed-work', repeat('d',64));
  PERFORM public.fixture_assert(r @> '{"execute":false,"status":"failed"}', 'refunded request never executes again');

  -- Six items cost two units; client cannot choose a cheaper group_size.
  SELECT included_credits_remaining INTO before_balance FROM public.profiles WHERE id=u;
  FOR i IN 1..6 LOOP
    r := public.fixture_begin_citation_request(u, 'batch-item-'||i, repeat('e',64), 'batch-exact');
    PERFORM public.fixture_assert(r @> '{"ok":true,"execute":true}', 'batch item claimed');
    PERFORM public.fixture_assert((r->>'charged')::integer=CASE WHEN i IN (1,6) THEN 1 ELSE 0 END, 'fixed five slot pricing');
  END LOOP;
  PERFORM public.fixture_assert((SELECT included_credits_remaining=before_balance-2 FROM public.profiles WHERE id=u), 'six items cost two');
  r := public.fixture_begin_citation_request(u, 'refund-anchor', repeat('f',64), 'batch-fail');
  anchor_token := (r->>'attempt_token')::uuid;
  r := public.fixture_begin_citation_request(u, 'refund-follower', repeat('f',64), 'batch-fail');
  token := (r->>'attempt_token')::uuid;
  r := public.fixture_finish_citation_request(u, 'refund-follower', token, 'failed', 'follower rejection');
  PERFORM public.fixture_assert(r @> '{"ok":true,"refunded":false}', 'free follower never mints units');
  r := public.fixture_finish_citation_request(u, 'refund-anchor', anchor_token, 'failed', 'anchor rejection');
  PERFORM public.fixture_assert(r @> '{"ok":true,"refunded":true}', 'anchor refunds original unit');
  r := public.fixture_begin_citation_request(u, 'after-refund-anchor', repeat('f',64), 'batch-fail');
  PERFORM public.fixture_assert(r->>'charged'='1', 'refunded anchor cannot fund new follower');

  r := public.fixture_begin_citation_request(u, 'deferred-anchor', repeat('a',64), 'batch-defer');
  anchor_token := (r->>'attempt_token')::uuid;
  r := public.fixture_begin_citation_request(u, 'deferred-follower', repeat('a',64), 'batch-defer');
  token := (r->>'attempt_token')::uuid;
  r := public.fixture_finish_citation_request(u, 'deferred-anchor', anchor_token, 'failed', 'anchor failure');
  PERFORM public.fixture_assert(r @> '{"ok":true,"refunded":false}', 'in-progress sibling retains anchor unit');
  r := public.refund_credits_for_user(u,'deferred-anchor','cannot bypass group');
  PERFORM public.fixture_assert(r @> '{"ok":true,"refunded":false,"deferred":true}', 'direct refund respects group');
  r := public.fixture_finish_citation_request(u, 'deferred-follower', token, 'failed', 'last sibling failure');
  PERFORM public.fixture_assert(r @> '{"ok":true,"refunded":true}', 'last definitive failure refunds original anchor');
  PERFORM public.fixture_assert((SELECT count(*)=1 FROM public.credit_ledger WHERE user_id=u AND request_id='deferred-anchor' AND event_type='refund'), 'deferred anchor refunded once');
  PERFORM public.fixture_assert(NOT EXISTS(SELECT 1 FROM public.credit_ledger WHERE user_id=u AND request_id='deferred-follower' AND event_type='refund'), 'follower never mints its own unit');

  r := public.fixture_begin_citation_request(u, 'success-group-anchor', repeat('a',64), 'batch-delivered');
  anchor_token := (r->>'attempt_token')::uuid;
  r := public.fixture_begin_citation_request(u, 'success-group-follower', repeat('a',64), 'batch-delivered');
  token := (r->>'attempt_token')::uuid;
  PERFORM public.fixture_finish_citation_request(u,'success-group-follower',token,'succeeded',NULL);
  r := public.fixture_finish_citation_request(u,'success-group-anchor',anchor_token,'failed','anchor failed');
  PERFORM public.fixture_assert(r @> '{"ok":true,"refunded":false}', 'successful sibling retains group unit');
  r := public.fixture_begin_citation_request(u, 'unknown-group-anchor', repeat('a',64), 'batch-unknown');
  anchor_token := (r->>'attempt_token')::uuid;
  r := public.fixture_begin_citation_request(u, 'unknown-group-follower', repeat('a',64), 'batch-unknown');
  token := (r->>'attempt_token')::uuid;
  PERFORM public.fixture_finish_citation_request(u,'unknown-group-follower',token,'unknown','lost acknowledgement');
  r := public.fixture_finish_citation_request(u,'unknown-group-anchor',anchor_token,'failed','anchor failed');
  PERFORM public.fixture_assert(r @> '{"ok":true,"refunded":false}', 'unknown sibling retains group unit');

  UPDATE public.profiles SET billing_period_ends_at=now()-interval '1 second' WHERE id=u;
  r := public.fixture_begin_citation_request(u, 'expired-follower', repeat('e',64), 'batch-exact');
  PERFORM public.fixture_assert(r->>'block_reason'='plan_expired', 'expiry enforced on free follower');
  PERFORM public.fixture_assert(NOT EXISTS(SELECT 1 FROM public.citation_usage_requests WHERE user_id=u AND request_id='expired-follower'), 'rejected request has no execution claim');
  UPDATE public.profiles SET billing_period_ends_at=NULL, included_credits_remaining=0, topup_credits_remaining=0, legacy_bonus_remaining=0 WHERE id=u;
  r := public.fixture_begin_citation_request(u, 'quota-blocked', repeat('a',64));
  PERFORM public.fixture_assert(r->>'error'='INSUFFICIENT_CREDITS', 'empty quota fails closed');
  UPDATE public.profiles SET topup_credits_remaining=1 WHERE id=u;
  r := public.fixture_begin_citation_request(u, 'topup-refund', repeat('a',64));
  token := (r->>'attempt_token')::uuid;
  PERFORM public.fixture_assert((SELECT topup_delta=-1 AND included_delta=0 AND legacy_delta=0 FROM public.credit_ledger WHERE user_id=u AND request_id='topup-refund'), 'topup charged');
  PERFORM public.fixture_finish_citation_request(u, 'topup-refund', token, 'failed', 'rejected');
  PERFORM public.fixture_assert((SELECT topup_credits_remaining=1 AND included_credits_remaining=0 AND legacy_bonus_remaining=0 FROM public.profiles WHERE id=u), 'only original topup restored');
  UPDATE public.profiles SET topup_credits_remaining=0, legacy_bonus_remaining=1 WHERE id=u;
  r := public.fixture_begin_citation_request(u, 'legacy-refund', repeat('a',64));
  token := (r->>'attempt_token')::uuid;
  PERFORM public.fixture_finish_citation_request(u, 'legacy-refund', token, 'failed', 'rejected');
  PERFORM public.fixture_assert((SELECT legacy_bonus_remaining=1 AND included_credits_remaining=0 AND topup_credits_remaining=0 FROM public.profiles WHERE id=u), 'only original legacy restored');

  UPDATE public.profiles SET included_credits_remaining=10, window_units_used=0, window_started_at=now() WHERE id=u;
  r := public.fixture_begin_citation_request(u, 'old-window', repeat('a',64));
  token := (r->>'attempt_token')::uuid;
  UPDATE public.profiles SET window_started_at=now()+interval '6 hours', window_units_used=7 WHERE id=u;
  PERFORM public.fixture_finish_citation_request(u, 'old-window', token, 'failed', 'late rejection');
  PERFORM public.fixture_assert((SELECT window_units_used=7 FROM public.profiles WHERE id=u), 'old-window refund does not erase current use');

  r := public.fixture_begin_citation_request(u,'old-period',repeat('a',64));
  token := (r->>'attempt_token')::uuid;
  UPDATE public.profiles SET billing_period_started_at=now()+interval '1 day', included_credits_remaining=140 WHERE id=u;
  r := public.fixture_finish_citation_request(u,'old-period',token,'failed','late rejection after renewal');
  PERFORM public.fixture_assert(r @> '{"ok":true,"refunded":false,"review_required":true}', 'old-period included refund requires review');
  PERFORM public.fixture_assert((SELECT included_credits_remaining=140 FROM public.profiles WHERE id=u), 'old refund cannot inflate renewal');
  UPDATE public.profiles SET billing_period_started_at=now() WHERE id=u;
  r := public.fixture_begin_citation_request(u,'old-plan',repeat('a',64));
  token := (r->>'attempt_token')::uuid;
  UPDATE public.profiles SET plan='week', included_credits_remaining=45 WHERE id=u;
  r := public.fixture_finish_citation_request(u,'old-plan',token,'failed','late rejection after plan switch');
  PERFORM public.fixture_assert(r @> '{"ok":true,"refunded":false,"review_required":true}', 'old-plan refund requires review');
  PERFORM public.fixture_assert((SELECT included_credits_remaining=45 FROM public.profiles WHERE id=u), 'old refund cannot inflate new plan');
  UPDATE public.profiles SET plan='month', included_credits_remaining=100 WHERE id=u;

  INSERT INTO public.credit_ledger(user_id,request_id,event_type,amount,included_delta,balance_after_included,balance_after_topup,reason)
    VALUES (u,'legacy-preseed','consume',-1,-1,9,0,'legal-qa');
  UPDATE public.credit_ledger SET metadata=jsonb_build_object('plan','month') WHERE user_id=u AND request_id='legacy-preseed';
  r := public.fixture_begin_citation_request(u,'legacy-preseed',repeat('a',64));
  PERFORM public.fixture_assert(r->>'error'='REQUEST_ID_ALREADY_USED', 'old ledger cannot bootstrap execution');
  r := public.refund_credits_for_user(u,'legacy-preseed','service but no attestation');
  PERFORM public.fixture_assert(r->>'error'='TRUSTED_FAILURE_REQUIRED', 'service helper alone does not authorize refund');
END $$;

-- Owner cannot create refunds, forge service failures, or read attempt tokens.
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}', true);
SET LOCAL ROLE authenticated;
SELECT public.fixture_assert(public.refund_credits('legacy-preseed','my failure')->>'error'='TRUSTED_FAILURE_REQUIRED', 'owner cannot mint refund');
SELECT public.fixture_assert(public.refund_credits('request-first','please refund success')->>'error'='TRUSTED_FAILURE_REQUIRED', 'owner cannot refund successful request');
DO $$ BEGIN
  BEGIN PERFORM public.fixture_begin_citation_request('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','forged-claim',repeat('a',64));
    RAISE EXCEPTION 'Owner unexpectedly executed begin'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.attest_usage_failure('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','legacy-preseed','forged');
    RAISE EXCEPTION 'Owner unexpectedly attested'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public.citation_usage_requests;
    RAISE EXCEPTION 'Owner unexpectedly read tokens'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- Defense-in-depth: even accidental EXECUTE grants do not remove identity checks.
GRANT EXECUTE ON FUNCTION public.begin_citation_request(uuid,text,text,text,text,jsonb), public.attest_usage_failure(uuid,text,text), public._require_usage_service() TO authenticated;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.fixture_begin_citation_request('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','forged-claim',repeat('a',64));
    RAISE EXCEPTION 'Owner bypassed body identity check'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.attest_usage_failure('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','legacy-preseed','forged');
    RAISE EXCEPTION 'Owner bypassed attestation identity check'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $$
DECLARE u uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; r jsonb; state text; j uuid;
BEGIN
  -- Successful, active, stale, missing, and explicitly unknown states all block.
  FOREACH state IN ARRAY ARRAY['done','running','queued','awaiting_user','timed_out','error'] LOOP
    INSERT INTO public.legal_research_jobs(user_id,credit_request_id,status,result)
      VALUES(u,'legacy-preseed',state,'{}') RETURNING id INTO j;
    r := public.attest_usage_failure(u,'legacy-preseed','cannot prove failure');
    PERFORM public.fixture_assert(r->>'error'='TRUSTED_FAILURE_REQUIRED', 'legacy state without evidence denied: '||state);
    DELETE FROM public.legal_research_jobs WHERE id=j;
  END LOOP;
  INSERT INTO public.legal_research_jobs(user_id,credit_request_id,status,result)
    VALUES(u,'legacy-preseed','done','{"execution_outcome_unknown":false}') RETURNING id INTO j;
  r := public.attest_usage_failure(u,'legacy-preseed','missing delivery marker');
  PERFORM public.fixture_assert(r->>'error'='TRUSTED_FAILURE_REQUIRED', 'NULL delivery marker fails closed');
  UPDATE public.legal_research_jobs SET result='{"execution_outcome_unknown":true,"delivery_failed":true}' WHERE id=j;
  r := public.attest_usage_failure(u,'legacy-preseed','unknown delivery');
  PERFORM public.fixture_assert(r->>'error'='TRUSTED_FAILURE_REQUIRED', 'unknown delivery blocked');
  UPDATE public.legal_research_jobs SET result='{"execution_outcome_unknown":false,"delivery_failed":true}' WHERE id=j;
  r := public.attest_usage_failure(u,'legacy-preseed','verified non-delivery');
  PERFORM public.fixture_assert(r @> '{"ok":true,"refunded":true}', 'trusted terminal failure refunds');
  r := public.attest_usage_failure(u,'legacy-preseed','verified non-delivery repeated');
  PERFORM public.fixture_assert(r @> '{"ok":true,"refunded":true,"replayed":true}', 'legacy repeated attestation refunds once');

  INSERT INTO public.legal_research_jobs(user_id,credit_request_id,status,created_at,updated_at)
    VALUES(u,'stale-unfinished','running',now()-interval '1 hour',now()-interval '1 hour') RETURNING id INTO j;
  PERFORM public.reap_stale_research_jobs();
  PERFORM public.fixture_assert((SELECT status='timed_out' AND result @> '{"credits_refunded":false,"execution_outcome_unknown":true}' FROM public.legal_research_jobs WHERE id=j), 'reaper never refunds unknown timeout');
END $$;
ROLLBACK;
