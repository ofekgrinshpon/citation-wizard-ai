# AUTHORED ONLY. No execution authorized. PostgreSQL isolationtester fixture.
setup {
  SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
  INSERT INTO public.profiles(id,included_credits_remaining)
    VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd',10);
  SELECT public.fixture_begin_citation_request('dddddddd-dddd-4ddd-8ddd-dddddddddddd','race-finish',repeat('b',64));
}
teardown {
  DELETE FROM public.credit_ledger WHERE user_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  DELETE FROM public.profiles WHERE id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
}
session "refund_one"
setup { SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false); }
step "begin_one" { BEGIN; }
step "fail_one" {
  SELECT public.fixture_finish_citation_request('dddddddd-dddd-4ddd-8ddd-dddddddddddd','race-finish',
    (SELECT attempt_token FROM public.citation_usage_requests WHERE user_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' AND request_id='race-finish'),'failed','rejected');
}
step "commit_one" { COMMIT; }
session "refund_two"
setup { SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false); }
step "fail_two" {
  SELECT public.fixture_assert(public.fixture_finish_citation_request('dddddddd-dddd-4ddd-8ddd-dddddddddddd','race-finish',
    (SELECT attempt_token FROM public.citation_usage_requests WHERE user_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' AND request_id='race-finish'),'failed','same rejection') @> '{"ok":true,"replayed":true}', 'repeat finalize');
}
step "verify" {
  SELECT public.fixture_assert((SELECT included_credits_remaining=10 FROM public.profiles WHERE id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'),'restored once');
  SELECT public.fixture_assert((SELECT count(*)=1 FROM public.credit_ledger WHERE user_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' AND event_type='refund'),'one refund');
}
permutation "begin_one" "fail_one" "fail_two" "commit_one" "verify"
