# V1 research endpoint retirement — local candidate only

This is prepared source, not evidence of a deployed retirement. No live endpoint,
job, stored history, database permission, balance or provider state was changed.
The release successor is coordinated with the citation recovery guards; its
citation request protocol is version 3.

## Decision and scope

Keep `legal-research-v1/index.ts` as a small HTTP 410 tombstone instead of deleting
the whole function tree. Old clients and scripts receive a clear refresh/retirement
error before this handler does any authentication lookup, credit reservation,
operation lock, job creation, body processing or provider work. OPTIONS retains
CORS support. The handler cannot redirect or fall back into V2, and smoke-mode
headers cannot bypass retirement. It makes no claim about prior jobs or refunds.

The zero-work guarantee is scoped to this server handler. Existing clients can
still refresh authentication, upload attachments or write failure telemetry before
or after receiving the rejection. They must not automatically resubmit to V2.

The previous V1 execution entrypoint is replaced. Its stage/lib sources remain,
as do all historical data, the legacy-named presentation components and the shared
job/refund/reaper infrastructure. Keeping these modules avoids breaking historical
regression imports and does not make them callable through the retired entrypoint.
The frontend's explicit V1 rollback destination is removed; current V2 routes,
attachments, source search and academic calls retain their existing destination.

This eliminates the new-request path that debited V1 research and then delegated
to `citation-chat`. No research-to-citation billing-transfer policy or settlement
RPC is introduced. This compatibility conclusion becomes operationally true only
when the tombstone is actually deployed and earlier V1 executions are drained or
reconciled. Source deletion by itself would not prove either condition.

## What must remain

- V2's independently vendored implementation and current research/source/academic
  routes.
- Saved `qa_logs`, `legal_research_jobs`, conversations/messages, credit ledgers,
  job links and their read/replay interfaces, including legacy V1 labels.
- Shared cleanup and refund functions used by V2, with the separately reviewed
  guard changes. A V1-looking reaper log label is not proof of a V1 invocation.
- Existing module tests; later removal of unused V1 helpers or scripts is a
  separate cleanup, not part of this retirement candidate.

## Release prerequisites and sequence (not authorization)

1. Verify actual deployment versions, aggregate V1 callers and outstanding work
   without assuming current source equals the deployed service. Distinguish actual
   V1 invocation records from shared reaper records carrying old labels. Identify
   old browser bundles, direct callers and validation/smoke scripts.
2. Validate the combined guard/retirement candidate against an approved disposable
   PostgreSQL fixture and the exact schema/catalog. Current local SQL tests are
   text-only. No PostgreSQL engine is installed in this workspace; no installation,
   SQL execution or permission change was attempted.
3. Obtain separate deployment/permission approval and a drained-worker rollout
   plan. Deploy the V1 tombstone to stop new work and the V2-only frontend routing.
   Verify the actual endpoint/version returns the expected retirement marker;
   simply removing a configuration entry or a source folder is not verification.
   Do not transparently forward old V1 requests to V2 with different IDs/billing.
4. Let already-started V1 work finish, or reconcile its result and consumed units
   from reliable evidence. Do not cancel jobs, assume timeout means failure,
   auto-refund or rerun work merely because the new endpoint is retired. Ensure old
   workers cannot depend on owner refund mutation when hardened RPCs are applied.
5. Coordinate all compatible guard backends, frontend protocol 3 and reviewed SQL
   under the authorized maintenance plan. Validate normal-account quota/expiry,
   concurrent duplicate/successor behavior, shared V2 cleanup/refunds, old history,
   job deep links and deliberate rejection of old V1 clients.

A rollback must not silently re-enable the old V1 charged/delegated path under the
new refund rules. Keep the tombstone unless a separately compatible rollback is
reviewed. Durable unknown-result recovery and wider V2 execution recovery remain
outside this patch and remain acceptance work.
