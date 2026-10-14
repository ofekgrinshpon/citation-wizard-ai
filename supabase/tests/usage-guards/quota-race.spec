# AUTHORED ONLY. No execution authorized. PostgreSQL isolationtester fixture.
setup {
  SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
  INSERT INTO public.profiles(id,included_credits_remaining)
    VALUES ('ffffffff-ffff-4fff-8fff-ffffffffffff',1);
}
teardown {
  DELETE FROM public.credit_ledger WHERE user_id='ffffffff-ffff-4fff-8fff-ffffffffffff';
  DELETE FROM public.profiles WHERE id='ffffffff-ffff-4fff-8fff-ffffffffffff';
}
session "first"
setup { SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false); }
step "begin_first" { BEGIN; }
step "spend_last" {
  SELECT public.fixture_assert(public.fixture_begin_citation_request('ffffffff-ffff-4fff-8fff-ffffffffffff','last-unit-one',repeat('a',64)) @> '{"execute":true}', 'last unit claimed');
}
step "commit_first" { COMMIT; }
session "second"
setup { SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false); }
step "try_last" {
  SELECT public.fixture_assert(public.fixture_begin_citation_request('ffffffff-ffff-4fff-8fff-ffffffffffff','last-unit-two',repeat('a',64)) @> '{"execute":false,"error":"INSUFFICIENT_CREDITS"}', 'last unit cannot be overspent');
}
step "verify" {
  SELECT public.fixture_assert((SELECT included_credits_remaining=0 FROM public.profiles WHERE id='ffffffff-ffff-4fff-8fff-ffffffffffff'),'no negative quota');
  SELECT public.fixture_assert((SELECT count(*)=1 FROM public.citation_usage_requests WHERE user_id='ffffffff-ffff-4fff-8fff-ffffffffffff'),'one execution claim');
}
permutation "begin_first" "spend_last" "try_last" "commit_first" "verify"
