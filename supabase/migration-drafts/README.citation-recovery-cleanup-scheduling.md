# Physical recovery cleanup: scheduling plan only

LOCAL REVIEW DRAFT. Nothing here is installed, run, or scheduled. No SQL may be
executed (even against a fixture) without separate approval.

The proposed service-only cleanup_citation_recovery(limit DEFAULT 1000) deletes
only expired rows from citation_recovery_payloads. It never deletes claim
identities, balances, ledgers, failure attestations, or separately saved history.
Read access to input and result ends at claim.created_at + 24 hours regardless
of when physical cleanup next runs. Thus the current candidate promises an
access cutoff, not verified exact-time physical erasure.

Before release, obtain separate scheduling/security/deployment authorization,
choose the supported platform scheduler and service invocation route, and verify
its permissions, database/timezone behavior, retention policy for backups, logs,
and observability. Do not blindly use pg_cron: installed extensions and execution
identity are unverified, and this cleanup explicitly requires service identity.
A suggested operational cadence is every five minutes with bounded batches,
repeating on the next scheduled tick when the batch is full. Monitor oldest
expired payload age and alert on missed/failed cleanup; never log payloads.

Required release evidence: schedule installed, one authorized synthetic payload
physically removed after expiry, still-active payload retained, prior request
state/accounting/history unchanged, and the expected owner/API roles denied
direct table access. No such evidence has been obtained in this local task.
