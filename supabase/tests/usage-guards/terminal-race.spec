# AUTHORED ONLY. No execution authorized. PostgreSQL isolationtester fixture.
setup {
  SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
  INSERT INTO public.profiles(id,included_credits_remaining)
    VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',10);
  SELECT public.fixture_begin_citation_request('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','terminal-race',repeat('c',64));
}
teardown {
  DELETE FROM public.credit_ledger WHERE user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  DELETE FROM public.profiles WHERE id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
}
session "winner"
setup { SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false); }
step "begin_winner" { BEGIN; }
step "succeed_first" {
  SELECT public.fixture_finish_citation_request('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','terminal-race',
    (SELECT attempt_token FROM public.citation_usage_requests WHERE user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' AND request_id='terminal-race'),'succeeded',NULL);
}
step "fail_first" {
  SELECT public.fixture_finish_citation_request('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','terminal-race',
    (SELECT attempt_token FROM public.citation_usage_requests WHERE user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' AND request_id='terminal-race'),'failed','provider rejected');
}
step "commit_winner" { COMMIT; }
session "loser"
setup { SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false); }
step "try_fail" {
  SELECT public.fixture_assert(public.fixture_finish_citation_request('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','terminal-race',
    (SELECT attempt_token FROM public.citation_usage_requests WHERE user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' AND request_id='terminal-race'),'failed','late failure')->>'error'='TERMINAL_STATE_CONFLICT','success wins');
}
step "try_succeed" {
  SELECT public.fixture_assert(public.fixture_finish_citation_request('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','terminal-race',
    (SELECT attempt_token FROM public.citation_usage_requests WHERE user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' AND request_id='terminal-race'),'succeeded',NULL)->>'error'='TERMINAL_STATE_CONFLICT','failure wins');
}
step "verify_success" {
  SELECT public.fixture_assert((SELECT included_credits_remaining=9 FROM public.profiles WHERE id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),'success charge retained');
  SELECT public.fixture_assert(NOT EXISTS(SELECT 1 FROM public.credit_ledger WHERE user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' AND event_type='refund'),'success never refunds');
}
step "verify_failure" {
  SELECT public.fixture_assert((SELECT included_credits_remaining=10 FROM public.profiles WHERE id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),'failure restores once');
  SELECT public.fixture_assert((SELECT count(*)=1 FROM public.credit_ledger WHERE user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' AND event_type='refund'),'failure one refund');
}
permutation "begin_winner" "succeed_first" "try_fail" "commit_winner" "verify_success"
permutation "begin_winner" "fail_first" "try_succeed" "commit_winner" "verify_failure"
