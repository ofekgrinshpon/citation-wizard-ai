# Selected citation-only offers — local integration boundary

Status: local code and unexecuted SQL draft, no payment activation or deployment.
Baseline: 92ee2e62. Existing account plans are unchanged. Tax treatment is unresolved;
no VAT-inclusive/exclusive claim is made. Offer IDs are internal versioned IDs, not
provider product IDs and not currently assignable profile plan values.

| Offer | Price | Included billable source requests | Renewal interval |
| --- | --- | --- | --- |
| citation_weekly_v1 | ILS 39 | 100 | one weekly paid cycle |
| citation_monthly_v1 | ILS 65 | 250 | one calendar month from billing anchor |

Both are intended to renew until cancellation. A month is not 30 days. Exact
cycle timestamps, timezone and month-end/leap-day handling must come from the
selected provider's authoritative paid-cycle contract. No dates are synthesized
by the browser and no new local-clock renewal function is introduced.

## What already exists and is reused

- `citationUsageGuard.ts` binds execution fingerprint, request ID, attempt token,
  explicit failed-parent retry lineage, definitive failure, unknown outcome,
  terminal storage and refund receipt. It was not replaced.
- Existing draft SQL locks owner profile before request, then atomically claims,
  stores recovery input, debits and writes the ledger. Replays cannot execute or
  debit twice; uncertain requests do not automatically retry or refund.
- Existing refund SQL binds original plan and cycle start, refunds once, and
  retains period-mismatched refunds for review rather than inflating a new cycle.
- `runCitation` has free deterministic/verified-cache paths. One unit means one
  billable source request, not every displayed source or every provider stage.
- Word embedding/download uses already-approved results locally; it neither
  invokes generation nor consumes a second unit. Fresh regeneration remains a
  separate explicit request, subject to the existing usage policy.

## Necessary local changes

`citationOffers.ts` is an offer catalogue, separate from legacy `PLANS`. Landing
and Profile use one disabled component with the selected prices, source counts,
citation-only scope and recurring disclosure. No checkout callback, provider ID,
subscription write or admin assignment was added. Trial entry elsewhere remains.

The unexecuted begin-request draft distinguishes the new IDs from legacy plans:
new claims retain `batch_id` for fingerprint/recovery binding, but never share a
billing anchor. Each gets charged_units=1 and null batch_anchor_request_id. Thus
one failed source can use the existing refund mechanism independently of other
successful sources in the document. Legacy five-item settlement remains intact.
New plans cannot spend old top-ups or legacy bonuses. Existing profile locks,
replay-first handling, terminal-state checks and period-bound refund logic remain.

## Missing authoritative contracts — do not activate yet

1. Payment provider/merchant configuration, signed event validation, account and
   subscription ownership, currency/amount/product mapping, settled-payment
   semantics, stable event and paid-cycle IDs, deduplication and event ordering.
2. Atomic paid-cycle application under the same profile lock, with durable unique
   provider event/cycle constraints and audit receipt. A duplicate paid event
   must not refill quota; a distinct event for the same cycle must not refill it
   either. Stale/overlapping periods and uncertain payment state must not grant.
3. Cancellation lifecycle: distinguish stopping automatic renewal from withdrawal,
   termination and refund rights. Do not assume all cancellations take effect at
   the paid-period end or that paid access must always remain until then. The
   future adapter must accept authoritative effective-end and refund events,
   including an earlier end when applicable, and apply them atomically with audit
   receipts. No new grant follows merely from elapsed time. Define event ordering,
   immediate termination/refund, chargebacks, failed renewal, proration and plan
   switches with the provider and approved policy. Do not reuse the existing
   seven-day discretionary refund wording as approved policy. Operator identity,
   VAT treatment and final cancellation/refund policy remain unresolved.
   There is deliberately no client cancellation action or working webhook here.
4. New profile-plan constraints and helper support, separate paid-event-only
   reset mode, and review of existing clock-driven `reset_or_renew_credits`.
   Never alias these offers to `billing_period`/`calendar_month`: legacy reset
   code can grant from time alone. Historical accounts and ledgers stay intact.
5. Citation-only server operation gates across ALL noncitation entrypoints;
   hiding UI alone is not enforcement. Short-window limits are not decided for
   these offers and must not be silently inherited from the old 45/140-unit plans.
6. Existing deployed schema/function signatures are unverified. Do not infer the
   draft is installed or the deployed quota/refund mechanism is absent. No remote
   data query was retried. Real catalog compatibility and deployment need review.

## Verification boundary

Executed offline tests cover catalogue/display, disabled controls, preserved
legacy metadata, existing guard/refund/recovery contracts and static SQL changes.
Full regression includes repeated Word generation/reset/export tests. Static SQL
assertions and mocked RPC tests are NOT PostgreSQL transactional/race proof.

Required before activation: disposable PostgreSQL execution of actual functions,
independent-source partial failure (success + failure + unknown in one batch),
concurrent same-ID and distinct-source final-unit claims, duplicate refunds,
refund across cycle rollover, exact cycle-end rejection, missing/future bounds,
concurrent paid-cycle application/cancel/refund, and duplicate/out-of-order payment
webhooks. Provider-dependent cancellation and cycle renewal cannot be truthfully
validated before that contract exists. No SQL fixtures, migrations, grants, live
provider calls or billing operations were executed in this task.
