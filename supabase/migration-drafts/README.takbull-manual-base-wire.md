# Manual Takbull base pilot: integration plan, no production enablement

- Scope: weekly ₪39/100 or monthly ₪65/250 only. No top-up creation route,
  UI, provider demand or admin override. The dormant add-on ledger is not an offer.
- Offer CTA shows "request a payment link", not instant payment or automatic access.
  State payment will be verified, access begins at activation within 24h of verified
  settlement, and quote when to expect the link separately. No provider link is sent
  by the app until reliable demand binding is demonstrated.
- Owner intake: authenticated POST allows only an offer enum. Check current server
  JWT, derive owner from auth.uid(), never body UID/email/price. One pending base
  intent per owner across both products, bounded by an explicit retry/cancel
  policy; per-owner rate limit and same profile lock as settlement/meter.
  Authenticated owner GET returns only own exact rate/offer and coarse status. Do not
  return receipt evidence, provider details, arbitrary URLs or another user's email.
- Operator: designated limited operator identity with explicit membership in a
  private allowlist, not generic administrator or service key shared with Dot.
  Grant a narrow queue read and transactional mutation boundary to that identity.
  Log the operator auth UID and timestamps on issuance, fulfillment, exception and
  refund; don't copy card data, full provider responses, or unneeded PII into logs.
  Queue reports filtered/paginated rows, including paid/no-grant and missing proofs.
- Demand issuance: operator creates fixed-amount registered demand using the order UUID
  verbatim in a merchant-controlled provider-side field. Before any charge is allowed,
  confirm a stable demand ref linked to token, amount, merchant and one-time mode;
  the test must show how evidence maps through settled transaction and receipt.
  Email only delivers a link; it never identifies the order. Tracker separates buyer
  requested_at from confirmed demand_issued_at. Payment eligibility uses issuance;
  do not claim 30-minute provider link expiry unless independently verified. If the
  provider permits late or repeated charges, define observable duplicate detection,
  operator/customer reconciliation and actual refunds before opening.
- Fulfillment: independently inspect authenticated provider dashboard. Only an exact
  confirmed one-time charge, valid original timestamp with known timezone, amount,
  currency, auth merchant, unique transaction and receipt plus the order token (or
  verified demand ref unambiguously linked to it) may proceed. User screenshot, email,
  redirects, notes from webhooks and raw IDs are not proof. Execute bound owner settlement
  atomically. Distinguish database "recorded" from "fulfilled"; only the latter grants.
  Replay must return exact original dates even after client retries. No extension.
- Verified actual cancellation/refund only: an operator action does not itself refund
  provider funds. Record provider-authenticated evidence of existing full refund; if
  charge was recorded without access the refund settles it and does not grant.
  Provider does not receive payer card data from this code.
- Frontend must display exact paid source status/expiry across Quick, Word and
  Bibliography, not legacy trial counters. Resolve separate legacy bibliography
  entrypoint before exposure. User receives paid/refunded news only on verified state
  (if appropriate). Private polling can surface only actionable queues to Dot; no
  automated activation from reports/webhook, screenshots or missing evidence.
- Release gates: disposable SQL tests, concurrent last unit/settlement/refund,
  authenticated queue/access isolation, independent manual dashboard proof including
  duplicate behavior, deployment staging for 100 and 250 exact limits, all 3 source
  paths and refund, then owner-authorized live change. No public button until the
  complete configured production path can deliver what it sells, and the process
  can meet its 24-hour promise.

## Draft implementation and controls

- Third SQL draft adds actor-audited admin operations: queue, issue, settle,
  and record an already-performed refund. Existing ReLex admin is authorized by
  private.has_role against the actor verified via Supabase Auth. The server
  retains its own service credential and never returns it or accepts actor/buyer
  identity from user JSON. No new database grants for users; RLS-private stores.
- Admin users tab renders the new workflow only with
  VITE_TAKBULL_MANUAL_BASE_ADMIN=true, and then hides legacy allocation controls
  while preserving read-only display and untouched balances/server routes. Edge
  blocks every operation unless TAKBULL_MANUAL_BASE_ENABLED=true; SQL pilot
  defaults disabled. No public CTA is integrated.
- Latest owner-only order request/status and the operator workflow use a distinct,
  immutable demand issuance clock. The provider report must demonstrate UUID,
  demand identifier, terminal, fixed price and genuine offset for actual paid time;
  never reinterpret a timezone-less provider date. The draft requires confirmed
  demand within 30 minutes of charge eligibility and stores late settled exceptions.
  Buyer has no in-app cancel/retry route yet; pending orders should be operationally
  reconciled before pilot is opened, not silently replaced by pay links.
- Disposable SQL: load existing manual-pilot fixture and 1500 draft, then
  takbull-manual-base/roles.sql, 1700 draft and takbull-manual-base/behavior.sql.
  Run existing paid meter fixture/regression separately. Focused edge handler
  suite: src/test/takbullManualBaseHandler.test.ts. TSX syntax transform is not
  browser evidence. Production link issuance, queue load, mobile UI, pending-order
  repair, and duplicate charge/refund rehearsal were not tested end-to-end.
