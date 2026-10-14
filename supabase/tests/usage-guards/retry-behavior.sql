-- AUTHORED ONLY. Do not execute without separate approval; no SQL runtime verification claimed.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'relex_usage_fixture_%' THEN RAISE EXCEPTION 'Refusing non-fixture database'; END IF;
END $$;
BEGIN;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $$
DECLARE
  u uuid := '11111111-1111-4111-8111-111111111111';
  other uuid := '22222222-2222-4222-8222-222222222222';
  r jsonb; token uuid; child_token uuid; receipt jsonb; before_balance integer;
BEGIN
  INSERT INTO public.profiles(id,included_credits_remaining) VALUES(u,100),(other,100);
  r := public.fixture_begin_citation_request(u,'retry-parent',repeat('a',64));
  token := (r->>'attempt_token')::uuid;
  r := public.fixture_begin_citation_request(u,'no-active-retry',repeat('a',64),NULL,'retry-parent');
  PERFORM public.fixture_assert(r->>'error'='RETRY_PARENT_NOT_FAILED', 'active parent cannot authorize successor');
  r := public.fixture_finish_citation_request(u,'retry-parent',token,'failed','known provider rejection');
  PERFORM public.fixture_assert(r->'refund_receipt' @> '{"status":"refunded","refunded":true,"units_refunded":1,"request_id":"retry-parent"}', 'fresh failure has confirmed original receipt');
  r := public.fixture_begin_citation_request(u,'retry-parent',repeat('a',64));
  PERFORM public.fixture_assert(r @> '{"execute":false,"status":"failed","refunded":true}', 'ordinary failed replay never creates successor');
  PERFORM public.fixture_assert(r->'refund_receipt'->>'status'='refunded', 'duplicate failure reports ledger receipt');

  r := public.fixture_begin_citation_request(u,'retry-child-one',repeat('a',64),NULL,'retry-parent');
  child_token := (r->>'attempt_token')::uuid;
  PERFORM public.fixture_assert(r @> '{"ok":true,"execute":true,"request_id":"retry-child-one","retry_of_request_id":"retry-parent"}', 'explicit failed-parent successor executes once');
  PERFORM public.fixture_assert(r->'retry_parent_refund_receipt'->>'status'='refunded', 'successor reports prior refund independently');
  SELECT included_credits_remaining INTO before_balance FROM public.profiles WHERE id=u;
  r := public.fixture_begin_citation_request(u,'retry-child-two',repeat('a',64),NULL,'retry-parent');
  PERFORM public.fixture_assert(r @> '{"ok":true,"execute":false,"request_id":"retry-child-one","status":"in_progress"}', 'different tab receives canonical child');
  PERFORM public.fixture_assert(NOT r ? 'attempt_token', 'canonical child does not leak execution token');
  PERFORM public.fixture_assert((SELECT included_credits_remaining=before_balance FROM public.profiles WHERE id=u), 'canonical replay does not debit');
  PERFORM public.fixture_assert(NOT EXISTS(SELECT 1 FROM public.citation_usage_requests WHERE user_id=u AND request_id='retry-child-two'), 'losing child ID is not reserved');
  PERFORM public.fixture_assert((SELECT count(*)=1 FROM public.citation_usage_requests WHERE user_id=u AND retry_of_request_id='retry-parent'), 'one child per parent');

  r := public.fixture_begin_citation_request(u,'retry-child-one',repeat('a',64));
  PERFORM public.fixture_assert(r->>'error'='REQUEST_ANCESTRY_MISMATCH', 'existing child cannot omit its ancestry');
  r := public.fixture_begin_citation_request(u,'retry-child-one',repeat('b',64),NULL,'retry-parent');
  PERFORM public.fixture_assert(r->>'error'='RETRY_FINGERPRINT_MISMATCH', 'existing ID cannot bypass parent fingerprint');
  r := public.fixture_begin_citation_request(u,'retry-child-one',repeat('a',64),'wrong-batch','retry-parent');
  PERFORM public.fixture_assert(r->>'error'='RETRY_FINGERPRINT_MISMATCH', 'existing ID cannot bypass parent batch');
  r := public.fixture_begin_citation_request(u,'retry-child-one',repeat('a',64),NULL,'missing-parent');
  PERFORM public.fixture_assert(r->>'error'='RETRY_PARENT_NOT_FOUND', 'existing ID cannot bypass missing parent');
  r := public.fixture_begin_citation_request(u,'retry-parent',repeat('a',64),NULL,'retry-parent');
  PERFORM public.fixture_assert(r->>'error'='INVALID_RETRY_REQUEST', 'self-link denied');
  r := public.fixture_begin_citation_request(other,'cross-user-child',repeat('a',64),NULL,'retry-parent');
  PERFORM public.fixture_assert(r->>'error'='RETRY_PARENT_NOT_FOUND', 'foreign parent denied without cross-user disclosure');

  r := public.fixture_finish_citation_request(u,'retry-child-one',child_token,'failed','second known failure');
  PERFORM public.fixture_assert(r->'refund_receipt' @> '{"status":"refunded","request_id":"retry-child-one"}', 'child failure has its own accounting receipt');
  r := public.fixture_begin_citation_request(u,'stale-root-click',repeat('a',64),NULL,'retry-parent');
  PERFORM public.fixture_assert(r @> '{"execute":false,"status":"failed","request_id":"retry-child-one"}', 'stale parent does not advance to grandchild');
  PERFORM public.fixture_assert(NOT EXISTS(SELECT 1 FROM public.citation_usage_requests WHERE user_id=u AND retry_of_request_id='retry-child-one'), 'stale click creates no grandchild');
  r := public.fixture_begin_citation_request(u,'explicit-grandchild',repeat('a',64),NULL,'retry-child-one');
  PERFORM public.fixture_assert(r @> '{"execute":true,"request_id":"explicit-grandchild","retry_of_request_id":"retry-child-one"}', 'separate explicit child-failure retry is allowed');
  r := public.fixture_begin_citation_request(u,'stale-root-again',repeat('a',64),NULL,'retry-parent');
  PERFORM public.fixture_assert(r @> '{"execute":false,"status":"failed","request_id":"retry-child-one"}', 'old parent never follows chain even after grandchild exists');
  r := public.fixture_begin_citation_request(u,'retry-parent',repeat('a',64),NULL,'retry-child-one');
  PERFORM public.fixture_assert(r->>'error'='REQUEST_ANCESTRY_MISMATCH', 'ancestor ID cannot create a cycle');

  -- A sibling root with matching content cannot reuse another parent's child ID.
  r := public.fixture_begin_citation_request(u,'other-parent',repeat('a',64));
  token := (r->>'attempt_token')::uuid;
  PERFORM public.fixture_finish_citation_request(u,'other-parent',token,'failed','known failure');
  r := public.fixture_begin_citation_request(u,'retry-child-one',repeat('a',64),NULL,'other-parent');
  PERFORM public.fixture_assert(r->>'error'='REQUEST_ANCESTRY_MISMATCH', 'existing child rejects different failed parent');

  -- Successful and unknown parents never authorize any new work.
  r := public.fixture_begin_citation_request(u,'success-parent',repeat('a',64));
  token := (r->>'attempt_token')::uuid;
  PERFORM public.fixture_finish_citation_request(u,'success-parent',token,'succeeded',NULL);
  r := public.fixture_begin_citation_request(u,'no-success-retry',repeat('a',64),NULL,'success-parent');
  PERFORM public.fixture_assert(r->>'error'='RETRY_PARENT_NOT_FAILED', 'success retry denied');
  r := public.fixture_begin_citation_request(u,'retry-child-one',repeat('a',64),NULL,'success-parent');
  PERFORM public.fixture_assert(r->>'error'='RETRY_PARENT_NOT_FAILED', 'existing child ID does not bypass successful parent validation');
  r := public.fixture_begin_citation_request(u,'unknown-parent',repeat('a',64));
  token := (r->>'attempt_token')::uuid;
  PERFORM public.fixture_finish_citation_request(u,'unknown-parent',token,'unknown','transport uncertainty');
  r := public.fixture_begin_citation_request(u,'no-unknown-retry',repeat('a',64),NULL,'unknown-parent');
  PERFORM public.fixture_assert(r->>'error'='RETRY_PARENT_NOT_FAILED', 'unknown retry denied');

  -- Capacity refusal does not burn the explicit retry opportunity.
  UPDATE public.profiles SET included_credits_remaining=0,topup_credits_remaining=0,legacy_bonus_remaining=0 WHERE id=u;
  r := public.fixture_begin_citation_request(u,'quota-child',repeat('a',64),NULL,'other-parent');
  PERFORM public.fixture_assert(r->>'error'='INSUFFICIENT_CREDITS', 'retry respects current quota');
  PERFORM public.fixture_assert(NOT EXISTS(SELECT 1 FROM public.citation_usage_requests WHERE user_id=u AND retry_of_request_id='other-parent'), 'quota denial creates no child');
  UPDATE public.profiles SET included_credits_remaining=5,billing_period_ends_at=now()-interval '1 second' WHERE id=u;
  r := public.fixture_begin_citation_request(u,'quota-child',repeat('a',64),NULL,'other-parent');
  PERFORM public.fixture_assert(r->>'block_reason'='plan_expired', 'retry respects current expiry');
  PERFORM public.fixture_assert(NOT EXISTS(SELECT 1 FROM public.citation_usage_requests WHERE user_id=u AND request_id='quota-child'), 'expiry denial does not reserve child ID');
  UPDATE public.profiles SET billing_period_ends_at=NULL WHERE id=u;
  r := public.fixture_begin_citation_request(u,'quota-child',repeat('a',64),NULL,'other-parent');
  PERFORM public.fixture_assert(r @> '{"execute":true,"request_id":"quota-child"}', 'same explicit retry works after capacity restored');
END $$;

DO $$
DECLARE
  u uuid := '33333333-3333-4333-8333-333333333333';
  r jsonb; anchor_token uuid; follower_token uuid;
BEGIN
  INSERT INTO public.profiles(id,included_credits_remaining) VALUES(u,100);
  r := public.fixture_begin_citation_request(u,'receipt-anchor',repeat('a',64),'receipt-batch');
  anchor_token := (r->>'attempt_token')::uuid;
  r := public.fixture_begin_citation_request(u,'receipt-follower',repeat('a',64),'receipt-batch');
  follower_token := (r->>'attempt_token')::uuid;
  r := public.fixture_finish_citation_request(u,'receipt-anchor',anchor_token,'failed','anchor known failure');
  PERFORM public.fixture_assert(r->'refund_receipt' @> '{"status":"deferred","refunded":false,"units_refunded":0,"request_id":"receipt-anchor"}', 'active sibling defers receipt');
  r := public.fixture_begin_citation_request(u,'receipt-anchor',repeat('a',64),'receipt-batch');
  PERFORM public.fixture_assert(r->'refund_receipt'->>'status'='deferred', 'failed replay does not invent a refund');
  r := public.fixture_begin_citation_request(u,'receipt-retry',repeat('a',64),'receipt-batch','receipt-anchor');
  PERFORM public.fixture_assert(r @> '{"execute":true,"charged":1}', 'explicit deferred-parent retry charged through ordinary rules');
  PERFORM public.fixture_assert(r->'retry_parent_refund_receipt'->>'status'='deferred', 'prior retained unit disclosed before new work');
  PERFORM public.fixture_finish_citation_request(u,'receipt-follower',follower_token,'unknown','transport uncertainty');
  r := public.fixture_begin_citation_request(u,'receipt-anchor',repeat('a',64),'receipt-batch');
  PERFORM public.fixture_assert(r->'refund_receipt' @> '{"status":"retained","refunded":false}', 'unknown sibling retains original unit');

  r := public.fixture_begin_citation_request(u,'refunded-anchor',repeat('b',64),'refunded-batch');
  anchor_token := (r->>'attempt_token')::uuid;
  r := public.fixture_begin_citation_request(u,'refunded-follower',repeat('b',64),'refunded-batch');
  follower_token := (r->>'attempt_token')::uuid;
  PERFORM public.fixture_finish_citation_request(u,'refunded-anchor',anchor_token,'failed','known failure');
  r := public.fixture_finish_citation_request(u,'refunded-follower',follower_token,'failed','last known failure');
  PERFORM public.fixture_assert(r->'refund_receipt' @> '{"status":"refunded","refunded":true,"units_refunded":1,"request_id":"refunded-anchor"}', 'last sibling receives authoritative group receipt');
  r := public.fixture_begin_citation_request(u,'refunded-anchor',repeat('b',64),'refunded-batch');
  PERFORM public.fixture_assert(r->'refund_receipt'->>'status'='refunded', 'later duplicate sees completed deferred refund');

  r := public.fixture_begin_citation_request(u,'period-review',repeat('c',64));
  anchor_token := (r->>'attempt_token')::uuid;
  UPDATE public.profiles SET billing_period_started_at=now()+interval '1 day',included_credits_remaining=140 WHERE id=u;
  r := public.fixture_finish_citation_request(u,'period-review',anchor_token,'failed','late rejection');
  PERFORM public.fixture_assert(r->'refund_receipt' @> '{"status":"review_required","refunded":false}', 'period mismatch accurately disclosed');
  r := public.fixture_begin_citation_request(u,'period-review',repeat('c',64));
  PERFORM public.fixture_assert(r->'refund_receipt'->>'status'='review_required', 'duplicate preserves review status');

  UPDATE public.profiles SET plan='admin' WHERE id=u;
  r := public.fixture_begin_citation_request(u,'admin-no-charge',repeat('d',64));
  anchor_token := (r->>'attempt_token')::uuid;
  r := public.fixture_finish_citation_request(u,'admin-no-charge',anchor_token,'failed','known failure');
  PERFORM public.fixture_assert(r->'refund_receipt' @> '{"status":"not_charged","refunded":false,"units_refunded":0}', 'admin failure never claims a refund');
END $$;
ROLLBACK;
