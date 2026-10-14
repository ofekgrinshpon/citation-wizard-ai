# Citation usage guards with durable recovery, local candidate revision 4

Status: LOCAL DRAFT, NEVER APPLIED. No database SQL, RLS, grant, schema, provider, or live-account action is authorized by this packet. The SQL fixtures are authored but **not executed**, including on a synthetic database. Separate approval is required before any execution or deployment.

Revision 4 is a **replacement of the unexecuted review draft**, not an upgrade
migration from deployed revisions 1, 2 or 3. Nothing in this packet has been
applied. Both begin/finish now have an additional JSONB payload argument. Applying
this replacement over previously installed signatures would leave unsafe or
ambiguous overloads and is unsupported; any real catalog transition requires a
separately reviewed migration. Frozen revision-1/2/3 packets remain untouched.

## V1 delegation removed from new execution; deployment still required

This candidate replaces the V1 execution entrypoint with a static HTTP 410
`RESEARCH_VERSION_RETIRED` response before credit/provider/job work. It retains
old history, V1 helper modules and shared V2 infrastructure, and removes the
frontend's deliberate V1 rollback destination. It does not select a new billing
transfer or settlement policy. See `../functions/legal-research-v1/RETIREMENT.md`
for the scope and staged retirement plan.

The earlier V1→citation double-charge/false-failure handoff is no longer reachable
through this candidate's V1 handler. That is local code/compatibility evidence,
not proof that a live endpoint is retired or that previously started jobs settled.
Actual deployment, old callers and in-flight work must be checked and safely
drained before the old-handoff release blocker can be considered closed. The
candidate still requires real PostgreSQL validation, scheduler verification and
operational reconciliation of genuinely unknown work; it is not production-ready.


## Durable account-owned recovery contract (new in revision 4)

The authorized retention scope is citation input plus usable typed result for
24 hours from the original claim. This is recovery storage, not a replacement
for user-saved citation history. It does not delete or expire that history.

- A paid begin atomically inserts its claim and an allowlisted `input` into
  `citation_recovery_payloads` before changing balances/ledger. The input is
  `{messages:[{role,content}],rawInput:string|null,foreignLookup:object|null,batchId:string|null}`.
  Roles are system/user/assistant, at most 100 messages. Foreign input includes
  only enabled/kind/jurisdiction/rawInput/parsedFields/articleResponseVersion,
  with closed citation-field maps. Maximum encoded UTF-8 input: 128 KiB.
- The same exact execution fields retain the existing version-1 canonical
  fingerprint algorithm (not the wire protocol version). Runtime and draft SQL
  independently validate the binding, including null batch identity. UI/project,
  telemetry and diagnostic state are excluded. Invalid/extra execution fields
  are rejected before cache, claim or provider work, not silently normalized.
- Success atomically stores only `{content?,foreignLookup?}` and changes status
  under the owning attempt token and profile/request/payload locks. A valid
  structured-only result, including empty content with typed foreign output,
  is recoverable. Maximum result: 256 KiB. Typed foreign metadata/provenance and
  bounded contract diagnostic booleans survive; raw provider envelopes, trace
  payloads, citationDiagnostic envelopes, auth headers and credential fields do
  not. Free-text citation content is not scanned or rewritten.
- Repeated identical completion is idempotent. Changed terminal content is
  rejected as RESULT_CONFLICT. A content hash remains on the claim to prevent
  changed-result replays even after physical payload cleanup. Unknown and failed
  outcomes have no stored result; all earlier refund rules stay unchanged.
- Every successful actual citation response includes requestId and
  recoveryAvailability. `available` requires confirmed atomic result storage;
  `unconfirmed` means the live response can be used but durable storage was not
  confirmed. X-Usage-Status:unconfirmed remains and is exposed through CORS.
  A free verified-cache success has `unavailable` and no recovery claim/debit.
  Oversized/malformed live output is usable but records unknown without storing
  an invalid result. Neither a lost acknowledgement nor recovery authorizes an
  execution retry or compensating refund.
- `citation-recovery` verifies the JWT itself and derives the owner from its
  subject. Supabase gateway defaults/config remain unchanged. POST is required;
  body is limited to 4 KiB and exactly
  `{requestId?:string,parentRequestId?:string,cursor?:string,limit?:number}`.
  RequestId and parentRequestId are mutually exclusive; a cursor is list-only.
  IDs/cursors are 8–200 characters, limit defaults to 20 and is 1–50.
- The service-only `read_citation_recovery(user,request,parent,cursor,limit)` does
  no claim/debit/refund/cache/provider/history work. Its accounting receipt reads
  take the same owner/profile lock for consistency, with no data mutation.
  Response is `{requests:RecoveryRecord[],nextCursor:string|null}`. Each record:
  `{requestId,retryOfRequestId,status,createdAt,expiresAt,availability,input,result,refundReceipt}`.
  No attempt token, fingerprint, balances, owner ID or account metadata is exposed.
- Exact missing/other-owner request is an empty list. Parent lookup returns the
  one immediate canonical child only, never the parent or a grandchild. List
  order is createdAt DESC then requestId DESC. A cursor is the last returned ID,
  resolved only in that owner scope. Missing/foreign cursors return the same
  INVALID_RECOVERY_CURSOR. Pages also stop below 1.5 MiB, so a short page can have
  nextCursor. Each read computes the current authoritative refund receipt.
- `availability` is pending for an active unexpired claim with input; available
  for a succeeded claim with input+valid result or failed/unknown claim with
  input; expired after the cutoff; otherwise unavailable. Unavailable and
  expired records contain null input/result. Unknown never becomes a paid-retry
  permission. Failure itself never proves a refund.
- Payload expires_at is claim.created_at + 24 hours. Both SQL and endpoint hide
  content at the cutoff, irrespective of physical cleanup. Cleanup removes only
  expired side-table content, never claims, ledgers, attestations or user-saved
  history. Scheduling is only described in
  `README.citation-recovery-cleanup-scheduling.md`: **not installed or verified**.
  Exact-time physical deletion and backup erasure are not claimed.

New permission changes here are drafts only: side-table RLS with no owner
policies; service-only table privileges; service-only begin/finish/read/cleanup
RPCs and closed-schema/canonicalization helpers. The read and cleanup APIs also
check service identity internally. Local Supabase type definitions add the
nullable history request identity; no live schema or settings were changed.

Historical accounting/isolation fixtures now use test-only adapters in
`fixture.sql` to supply deterministic synthetic protocol-3 input/hash/result.
They still call the actual proposed begin/finish functions. New
`recovery-behavior.sql` calls actual recovery APIs directly and covers ownership,
input binding, atomic success, immutable result, expiry and payload-only cleanup.
All SQL fixtures remain authored and unexecuted. No SQL parser/engine is used in
this task, and no SQL syntax/locking/RLS/concurrency proof is implied.

## Scope and guarantees designed into the draft

- `begin_citation_request(user, request, fingerprint, batch DEFAULT NULL, retry_of_request_id DEFAULT NULL, recovery_input DEFAULT NULL)` validates a service identity and atomically records consumption plus the sole execution claim under a profile row lock. Its `(user_id, request_id)` record binds the normalized server fingerprint and batch identity. A duplicate returns state without execution permission or the attempt token. A changed payload/batch or legacy ledger collision is rejected. There is no lease retry, automatic takeover, or expiration of idempotency protection.
- Explicit retry is a linked successor, never reuse/takeover of the original execution. `retry_of_request_id` must identify a same-user immutable `failed` parent with exactly matching fingerprint and batch. Self-links and existing-ID ancestry mismatch are rejected before replay. A same-user composite foreign key and `UNIQUE(user_id,retry_of_request_id)` allow one direct child per parent. The profile lock covers parent validation, requested-ID validation, canonical-child lookup and any new debit/claim. Two tabs proposing different IDs receive the same immediate canonical child; only its initial call gets execution/token permission. Stale parent clicks never follow a failed child into a grandchild. A new child of that failed child requires a separate explicit retry. Quota/expiry refusal creates no child and consumes no retry opportunity.
- `finish_citation_request(user, request, token, outcome, reason DEFAULT NULL, result DEFAULT NULL)` allows only the owning token to change `in_progress` to `succeeded`, `failed`, or `unknown`. Terminal state is immutable. Unknown/crashed/lost-acknowledgement work cannot auto-refund or auto-execute again.
- The database fixes batch pricing at one unit per five members. Only a service-recorded positively charged anchor can fund a non-admin follower; old owner-controlled metadata cannot. All member slots remain consumed even when an individual member fails. A failed anchor immediately closes its group. Its original unit refunds only when **all** group members are definitively failed; any successful, unknown, or still-active sibling retains the unit. The last failure can atomically refund the anchor once.
- Paid-plan expiry is checked even for a zero-unit batch follower. An already prepaid slot needs no additional unit of window/period quota; a new anchor requires current quota. Admin accounts retain zero-delta treatment.
- `refund_credits` stays owner-readable only for existing refund replay and otherwise denies. It never calls the service refund function or mints a refund from an owner-supplied reason.
- `refund_credits_for_user` requires service identity **and** a trusted failure attestation; successful/unknown/active citation requests are not eligible. It locks/rechecks before mutating balances and restores only the original included/topup/legacy deltas, at most once. Zero-delta/admin consumes do not mint ledger refunds.
- New citation ledgers capture the original plan and billing-period start. Included-credit restoration requires the current plan and period still match. For older ledgers without a period marker, matching plan plus `consumed.created_at >= current billing_period_started_at` proves eligibility; missing or mismatched evidence returns `review_required:true`, `refunded:false`, without changing quota. Topup/legacy refunds preserve their original persistent bucket. Old-window refunds never reduce the new window's counter.
- `attest_usage_failure` is a service-only bridge for definitive legacy failures. It cannot target citation requests (including old `citation-chat` ledger rows). Any linked research job must have explicit `execution_outcome_unknown:false` and either `status:error` or `status:done` with `delivery_failed:true`. The check is repeated while job rows are locked in the refund helper. Owner-insertable research status alone is not authorization.
- Reaper timeouts now mean unknown financial outcome; no automatic refund and no user text claiming one. The two-argument reaper is explicitly dropped/recreated without defaults (no CASCADE), and the one-argument wrapper provides the only default. If a real dependency prevents the drop, stop for review instead of cascading.

## Authoritative refund receipts

`_citation_refund_receipt(user, request)` is a service-only read helper that uses the same profile lock. It returns `refund_receipt` with `{status, refunded, units_refunded, request_id}`. `request_id` identifies the charged request or batch anchor, not necessarily the zero-unit member. Only an existing positive ledger refund produces `status:"refunded"`, `refunded:true`, and positive `units_refunded`; failure status by itself never does.

Other receipt states always carry `refunded:false` and `units_refunded:0`:
- `retained`: the charged anchor or another group member succeeded or has unknown outcome
- `deferred`: the anchor/group still has active work
- `review_required`: original included allowance can no longer be safely restored
- `not_charged`: the original charged request had no actual bucket debit (e.g. admin)
- `not_applicable`: this request has not definitively failed
- `unconfirmed`: the database cannot establish a complete accounting receipt

Receipts are recomputed from current authoritative ledger/group state, so an anchor initially deferred later reports a confirmed refund when the last sibling definitively fails. Fresh and duplicate-failed results carry receipts. A successor also returns `retry_parent_refund_receipt` to distinguish the prior accounting outcome from its new execution/debit. Missing/malformed receipt data must be shown as unconfirmed, never as a promised refund.

## Service RPC contract

- Fresh begin: `{ok:true, execute:true, status:"in_progress", request_id, attempt_token, charged, admin, retry_of_request_id, retry_parent_refund_receipt, ...balances}`. An ordinary request has null retry fields.
- Duplicate/canonical-child begin: `{ok:true, execute:false, replayed:true, status, request_id, retry_of_request_id, refunded, refund_receipt, retry_parent_refund_receipt}`. `request_id` is the canonical existing child when another proposed ID loses. The begin response includes no payload, new execution, or token disclosure; result retrieval uses the separate read-only recovery endpoint. The handler returns HTTP 409 with canonical status/identity.
- Finish: `{ok:true, status, result_stored, refunded, refund_receipt, review_required}`. A succeeded state is confirmed to the handler only with `result_stored:true`. `refunded:true` means positive original units were refunded; when a failed follower completes an all-failed group this may refer to its group's anchor. A free follower by itself never refunds units.
- Attest/refund: `{ok:true, refunded:true}` for actual/prior positive refund; zero-charge is `{ok:true,refunded:false,noop:true}`; pending group is `{ok:true,refunded:false,deferred:true}`; replaced/unknown included period is `{ok:true,refunded:false,review_required:true}`.
- Retry validation errors: `INVALID_RETRY_REQUEST`, `RETRY_PARENT_NOT_FOUND`, `RETRY_PARENT_NOT_FAILED`, `RETRY_FINGERPRINT_MISMATCH`, `REQUEST_ANCESTRY_MISMATCH`. All have `ok:false,execute:false` and perform no execution/debit. Other existing error codes are unchanged.
- Any RPC/network/persistence uncertainty must fail closed. No legacy charge/refund fallback and no new request ID generated automatically to defeat the claim.

## Permission changes requiring review, all drafted only

1. Create `citation_usage_requests` and `usage_terminal_failures`; enable RLS on both, with no owner policies.
2. Revoke all table privileges from PUBLIC, anon, authenticated; grant all on these two service-owned tables to service_role.
3. Revoke EXECUTE from PUBLIC, anon, authenticated for `_require_usage_service()`, `_citation_refund_receipt(uuid,text)`, `begin_citation_request(uuid,text,text,text,text,jsonb)`, `finish_citation_request(uuid,text,uuid,text,text,jsonb)`, `attest_usage_failure(uuid,text,text)`, and `refund_credits_for_user(uuid,text,text)`. Grant EXECUTE only to service_role. Each mutating RPC checks caller service identity internally, including if an EXECUTE grant is accidentally widened later.
4. Keep owner `refund_credits(text,text)` EXECUTE for authenticated only as read-only replay/deny; revoke PUBLIC/anon.
5. Replace both reaper entry points, revoke PUBLIC/anon/authenticated, grant EXECUTE to service_role/postgres for scheduled cleanup. The reaper cannot authorize a refund.
6. No database permissions, profile/RLS changes, existing ledger policies or function ACL migrations have been applied. Local API types include the draft history identity only. The schema owner remains trusted; direct service-role writes are privileged by design.

## Required coordinated rollout and affected callers

Do not deploy only the edge changes: missing RPCs cause fail-closed unavailability. Do not deploy only the SQL changes while legacy refund callers still rely on owner authorization: valid historical refunds would stop. Deployment/order, drain window and rollback require a separate reviewed plan; no rollout is authorized here.

Protocol 3 compatibility gate: every older ordinary `citation-chat` request is rejected with HTTP 426 before server cache lookup, usage consumption or provider work. This affects all cached older bundles using Index, ManualEntry, bibliography, batch footnotes and the legal-research UniformCitationPanel until refresh. Client-only verified/deterministic results can still work without invoking the edge handler. The separately authorized diagnostic preflight is exempt from this ordinary-work gate. Old direct V1 calls instead receive the retirement response; they must not be silently forwarded to V2. Browser refresh can load the supported frontend but cannot settle a previous job.

Complete ordinary citation caller inventory:
- `src/pages/Index.tsx`: chat, follow-up, disambiguation, source-type/edit paths; explicit retries retain their prepared body, rendering and successful persistence continuation.
- `src/components/ManualEntry.tsx`: manual source form, with click/revision/account/Back/unmount guards.
- `src/lib/runCitation.ts`: exact prepared-request and renderer recovery shared by `BibliographyGenerator.tsx`, `BatchFootnoteBuilder.tsx`, and `legal-research/UniformCitationPanel.tsx`. Each UI retains same-attempt recovery and exposes a separate paid-new-attempt action only after server-confirmed failure; pools do not automatically repeat.
- `supabase/functions/legal-research-v1/index.ts`: retired compatibility endpoint, rejects new execution before any debit/provider call. The old delegation is removed from this candidate.
- `src/lib/citationDiagnostic.ts`: authorized observation preflight only, not ordinary paid work.

Explicit retry is a new billable attempt and may consume another unit under existing batch pricing. UI disclosure distinguishes confirmed prior refund from retained, not-charged or unconfirmed outcomes. A failed state alone is not refund evidence. Per-account retained capacity is 256 payload slots; replacing a failed parent with its explicit successor reuses its slot. Full reload/new-tab recovery now uses the authenticated recovery endpoint for unexpired server claims; it never re-executes providers just to recover.

Other affected refund call sites:
- `citation-chat/index.ts`: replace owner consume/replay with service claim before paid calls, bind payload fingerprint, finish known outcomes, retain unknown without refund.
- `verify-case-fulltext/index.ts`: propagate provider outcome uncertainty to its caller rather than turning transport/malformed output into definitive no-match. Deploy this caller contract before the compatible legal-qa handler, only after separate authorization.
- `legal-qa/index.ts`: service-attest only verified failure of newly consumed work; generic catch stays unknown.
- `bibliography-lookup/index.ts`: same service-only definitive failure and no repeat execution on `consume` replay.
- `legal-research-v1/index.ts`: static retirement response only; no debit, refund, job, watchdog or provider operations. Old in-flight workers and their existing ledger/jobs still need release-time reconciliation.
- `legal-research-v2/beta/job.ts`: CAS terminal job state first; explicit known/unknown marker, then service attest only for proven failure/non-delivery. A lost persistence acknowledgement never authorizes refund.
- `legal-research-v2/index.ts`: job-create refund only for a definitively rejected insert, not transport/no-row ambiguity.
- `reap_stale_research_jobs` SQL: no timeout refunds and corrected Hebrew notice.
- `src/test/rpcPrivileges.test.ts`: new RPC identities added. It is live-dependent and must remain skipped in this local work; after a separately approved deployment it will fail until all expected functions/ACLs exist.

Historical unproven refunds are not retroactively classified as failures. Legacy citation ledger collisions return `REQUEST_ID_ALREADY_USED`; they are never migrated into an executable claim. Unknown/stuck requests and period-mismatched refunds still require explicit support/reconciliation; they are never automatically restarted or refunded. A definitive failed request may authorize the one-child explicit retry described above, with current quota and accurate prior-refund disclosure.

## Verification status

Executed: static source-contract tests in `src/test/citationUsageSqlDraft.test.ts`, bounded-payload and actual-handler transport mocks in `citationRecoveryBackend.test.ts`, plus affected guard/actual-citation-handler tests. These are offline and **not** PostgreSQL syntax, RLS, locking, race, or transactional proof. Aggregate counts live in the validation packet rather than this mutable implementation note.

Not executed: SQL fixture, behavioral and explicit-retry/receipt assertions, role/ACL assertions, and isolationtester claim/refund/terminal/quota/retry-child/retry-terminal concurrency specifications under `supabase/tests/usage-guards/`. They must be reviewed and run only after separate approval in a fresh disposable cluster, never pointed at an existing project. A fixture database-name guard and empty-schema check reduce mistakes but do not grant execution permission.

Inspection found no installed PostgreSQL server/client engine, initdb/pg_ctl, isolation tester, Docker/Podman, or embedded PostgreSQL/PGlite engine. The installed `postgres` npm package is a network client, not an engine. No installs, cluster creation, fixture execution or security-setting changes were performed.

Still required before deployment: verify actual V1 retirement and reconcile/drain old executions; real PostgreSQL function compilation, exact baseline catalog compatibility, RLS/ACL checks under actual PostgREST roles, two-session concurrency and lock ordering, refund-vs-success/batch races, trigger/referral interactions, safe migration of in-flight legacy jobs, query plan/load review, and staged end-to-end verification with strictly approved provider/account exposure.
