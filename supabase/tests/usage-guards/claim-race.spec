# AUTHORED ONLY. No execution authorized. PostgreSQL isolationtester fixture.
# Requires fixture.sql loaded into a newly approved disposable test cluster.
setup {
  SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
  INSERT INTO public.profiles(id,included_credits_remaining)
    VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',10);
}
teardown {
  DELETE FROM public.credit_ledger WHERE user_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  DELETE FROM public.profiles WHERE id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
}
session "claim_one"
setup { SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false); }
step "begin_one" { BEGIN; }
step "claim_one" {
  SELECT public.fixture_assert(public.fixture_begin_citation_request('cccccccc-cccc-4ccc-8ccc-cccccccccccc','race-request',repeat('a',64)) @> '{"execute":true}', 'first executes');
}
step "commit_one" { COMMIT; }
session "claim_two"
setup { SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false); }
step "claim_two" {
  SELECT public.fixture_assert(public.fixture_begin_citation_request('cccccccc-cccc-4ccc-8ccc-cccccccccccc','race-request',repeat('a',64)) @> '{"execute":false,"status":"in_progress"}', 'concurrent duplicate cannot execute');
}
step "verify" {
  SELECT public.fixture_assert((SELECT included_credits_remaining=9 FROM public.profiles WHERE id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'),'one unit');
  SELECT public.fixture_assert((SELECT count(*)=1 FROM public.credit_ledger WHERE user_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc' AND event_type='consume'),'one consume');
}
permutation "begin_one" "claim_one" "claim_two" "commit_one" "verify"
