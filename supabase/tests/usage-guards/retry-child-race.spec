# AUTHORED ONLY. No execution authorized. PostgreSQL isolationtester fixture.
# Different tabs submit different successor IDs for the same failed parent.
setup {
  SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
  INSERT INTO public.profiles(id,included_credits_remaining)
    VALUES ('44444444-4444-4444-8444-444444444444',10);
  SELECT public.fixture_begin_citation_request('44444444-4444-4444-8444-444444444444','race-parent',repeat('a',64));
  SELECT public.fixture_finish_citation_request('44444444-4444-4444-8444-444444444444','race-parent',
    (SELECT attempt_token FROM public.citation_usage_requests WHERE user_id='44444444-4444-4444-8444-444444444444' AND request_id='race-parent'),'failed','known failure');
}
teardown {
  DELETE FROM public.credit_ledger WHERE user_id='44444444-4444-4444-8444-444444444444';
  DELETE FROM public.profiles WHERE id='44444444-4444-4444-8444-444444444444';
}
session "first_tab"
setup { SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false); }
step "first_begin" { BEGIN; }
step "first_child" {
  SELECT public.fixture_assert(public.fixture_begin_citation_request('44444444-4444-4444-8444-444444444444','child-tab-one',repeat('a',64),NULL,'race-parent') @> '{"execute":true,"request_id":"child-tab-one"}', 'first child executes');
}
step "first_commit" { COMMIT; }
session "second_tab"
setup { SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false); }
step "second_child" {
  SELECT public.fixture_assert(public.fixture_begin_citation_request('44444444-4444-4444-8444-444444444444','child-tab-two',repeat('a',64),NULL,'race-parent') @> '{"execute":false,"request_id":"child-tab-one","status":"in_progress"}', 'second tab gets canonical child');
}
step "verify" {
  SELECT public.fixture_assert((SELECT count(*)=1 FROM public.citation_usage_requests WHERE user_id='44444444-4444-4444-8444-444444444444' AND retry_of_request_id='race-parent'), 'one successor');
  SELECT public.fixture_assert((SELECT included_credits_remaining=9 FROM public.profiles WHERE id='44444444-4444-4444-8444-444444444444'), 'one successor debit');
  SELECT public.fixture_assert(NOT EXISTS(SELECT 1 FROM public.credit_ledger WHERE user_id='44444444-4444-4444-8444-444444444444' AND request_id='child-tab-two'), 'losing ID has no ledger');
}
permutation "first_begin" "first_child" "second_child" "first_commit" "verify"
