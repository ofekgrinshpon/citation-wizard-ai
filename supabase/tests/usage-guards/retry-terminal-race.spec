# AUTHORED ONLY. No execution authorized. PostgreSQL isolationtester fixture.
# A retry racing parent finalization must observe the committed terminal state.
setup {
  SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
  INSERT INTO public.profiles(id,included_credits_remaining)
    VALUES ('55555555-5555-4555-8555-555555555555',10);
  SELECT public.fixture_begin_citation_request('55555555-5555-4555-8555-555555555555','terminal-parent',repeat('a',64));
}
teardown {
  DELETE FROM public.credit_ledger WHERE user_id='55555555-5555-4555-8555-555555555555';
  DELETE FROM public.profiles WHERE id='55555555-5555-4555-8555-555555555555';
}
session "terminal_writer"
setup { SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false); }
step "terminal_begin" { BEGIN; }
step "mark_failed" {
  SELECT public.fixture_finish_citation_request('55555555-5555-4555-8555-555555555555','terminal-parent',
    (SELECT attempt_token FROM public.citation_usage_requests WHERE user_id='55555555-5555-4555-8555-555555555555' AND request_id='terminal-parent'),'failed','known rejection');
}
step "mark_unknown" {
  SELECT public.fixture_finish_citation_request('55555555-5555-4555-8555-555555555555','terminal-parent',
    (SELECT attempt_token FROM public.citation_usage_requests WHERE user_id='55555555-5555-4555-8555-555555555555' AND request_id='terminal-parent'),'unknown','lost acknowledgement');
}
step "terminal_commit" { COMMIT; }
session "retry_reader"
setup { SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false); }
step "retry_after_failure" {
  SELECT public.fixture_assert(public.fixture_begin_citation_request('55555555-5555-4555-8555-555555555555','terminal-child',repeat('a',64),NULL,'terminal-parent') @> '{"execute":true}', 'committed failure permits one explicit successor');
}
step "retry_after_unknown" {
  SELECT public.fixture_assert(public.fixture_begin_citation_request('55555555-5555-4555-8555-555555555555','terminal-child',repeat('a',64),NULL,'terminal-parent') @> '{"execute":false,"error":"RETRY_PARENT_NOT_FAILED"}', 'unknown parent remains protected');
}
permutation "terminal_begin" "mark_failed" "retry_after_failure" "terminal_commit"
permutation "terminal_begin" "mark_unknown" "retry_after_unknown" "terminal_commit"
