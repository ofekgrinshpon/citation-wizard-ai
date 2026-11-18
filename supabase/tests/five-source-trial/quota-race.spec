# AUTHORED ONLY. Disposable PostgreSQL isolationtester fixture, never production.
# Preconditions: usage-guards fixture and five-source migration applied.
setup
{
 UPDATE public.citation_trial_config SET enabled=true WHERE singleton;
 INSERT INTO public.profiles(id,plan) VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd','trial');
 INSERT INTO public.citation_trial_sources(user_id,request_id,fingerprint,route,state)
 SELECT 'dddddddd-dddd-4ddd-8ddd-dddddddddddd','seed-'||i,repeat('a',64),'local','succeeded'
 FROM generate_series(1,4) i;
}
teardown
{
 DELETE FROM public.profiles WHERE id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
}
session "one"
step "one_begin" { BEGIN; SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd"}',true); }
step "one_claim" { SELECT public.consume_local_citation_trial('last-slot-one',repeat('a',64),'dddddddd-dddd-4ddd-8ddd-dddddddddddd'); }
step "one_commit" { COMMIT; }
session "two"
step "two_begin" { BEGIN; SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd"}',true); }
step "two_claim" { SELECT public.consume_local_citation_trial('last-slot-two',repeat('b',64),'dddddddd-dddd-4ddd-8ddd-dddddddddddd'); }
step "two_commit" { COMMIT; }
permutation "one_begin" "two_begin" "one_claim" "two_claim" "one_commit" "two_commit"
permutation "one_begin" "two_begin" "two_claim" "one_claim" "two_commit" "one_commit"
