# Five-source trial verification and release boundary

## Executed

`vitest run src/test/citationFiveSourceTrialSql.test.ts`: 7 static contract tests pass.
These static checks are not concurrency proof. Additional real PostgreSQL 18.6 single-user
runtime verification passed in a separately authored disposable synthetic lab (no original
prohibited fixture/draft was executed; no application database or remote provider was contacted).

Runtime verified: exact migration prerequisites and syntax; five/six provider and local requests;
provider/local idempotency; zero weighted trial debit; known failure refund and duplicate refund;
unknown retains its slot; active paid legacy debit; admin exemption; expired paid fallback;
success commits recovery and cannot later refund; authenticated own status/local debit;
expected-account mismatch; changed fingerprint denial; client table/guarded-RPC restrictions;
upgrade/expiry/rollout rollback preserve lifetime ledger.

The lab uses independently authored minimalist tables and **stubbed recovery validators/auth
claim readers**, so it is not proof of full deployed schema/parser compatibility. The actual
three prerequisite function bodies were reconstructed from this migration, with exact MD5
verification, before the real migration was applied. SQL command output was inspected for
ERROR/FATAL and explicit PASS markers, rather than trusting the single-user process exit code.

## Not executed / required before activation

Unix-socket creation was blocked by the sandbox, so real two-client race tests could not run.
Concurrency correctness still needs a normal disposable PostgreSQL server. Also verify actual
production schema constraints/triggers and recovery validators before release. Existing
`usage-guards/fixture.sql` and original migration retain their explicit execution prohibition;
they were not executed. New legacy-style `behavior.sql`, `local-behavior.sql`, and
`quota-race.spec` remain authored-only. The independent runtime lab was under `/tmp`.

No result should be published before its accounting operation confirms success; no retries
after uncertain provider execution. The migration was applied only to a new synthetic local
cluster. No production schema changes, data reads, activation or deployment occurred.

## API

- `get_citation_trial_status()` authenticated owner only returns `ok, enabled, limited, limit,
  used, remaining`. Only `limited=true` participates in new debit. Missing/error is not unlimited.
- `consume_local_citation_trial(_request_id text, _fingerprint text, _expected_user uuid)` owner only: idempotent local
  debit, hash binding, expected-account binding (`CITATION_RETRY_STALE` on mismatch), `TRIAL_EXHAUSTED` denial. It does not authorize provider execution.
- Guarded begin/finish signatures remain unchanged; provider trial debit plus recovery write
  share one transaction. Legacy paid logic follows the original code unchanged.
- `citation_trial_sources`: permanent lifetime ledger; in_progress/succeeded/unknown count.
  Failed requests stop counting only after a valid service token finalization. No time expiry.

## Rollout gate

Migration defaults `citation_trial_config.enabled=false`; clients cannot modify the flag.
Do not activate automatically. Read-only comparison found the deployed begin differs from the
old draft (the draft had unused versioned paid restrictions). This migration is rebased on the
observed deployed begin, preserving its paid tail and all validation unchanged. Finish/refund
matched the checked-in draft. A first-transaction prerequisite verifies `md5(replace(trim(prosrc),
E'\r',''))` for all three replaced bodies and aborts on any drift or missing function. Do not bypass
that guard; inspect/rebase instead. Other schema and recovery validator dependencies still require
review. The private read-only observation is not a committed fixture or migration dependency.
Staging requires schema compatibility confirmation, PostgreSQL tests, frontend fast-path debit
and backend provider guard, then coordinated release. The final authorized activation is one
service/admin transaction setting `enabled=true` on the singleton row. Never perform activation
from a client. Reverting the flag stops new trial charging but preserves the ledger and completes
already-claimed requests. A flag rollback returns old weighted accounting; it does not erase usage.

Existing historical trial usage is not retrospectively converted from weighted credits because
that cannot determine exact source counts. The new lifetime ledger starts empty on activation.
No existing paid entitlement/credit balance or legacy ledger is overwritten. Any policy to migrate
historical usage must be explicit rather than inferred from 15 weighted credits.

### Preparing an authorized synthetic fixture

After explicit authorization to execute the existing usage-guards fixture, install it and its
original draft. Before the new migration, use `prepare_baseline.py` to produce the **observed
legacy begin** from the new migration by removing just trial insertion/declaration. It verifies
the exact prereq MD5 before emitting SQL and does not execute SQL. Apply the emitted function
only to the disposable fixture, then run this migration. This makes the fixture match the live
begin baseline without storing private observed source separately or removing drift checks.

## Application wiring

- A staged frontend build sets `VITE_CITATION_SOURCE_TRIAL=true`. This renders
  source selection and calls the status and local debit RPCs. It does not
  activate trial accounting while the database flag is off.
- A staged `citation-chat` deployment sets `CITATION_SOURCE_TRIAL=true`. This
  guards verified-store responses that bypass provider claims. Provider claims
  are always governed by the deployed DB function and database flag.
- Do not enable the database flag before both staged versions are verified.
  Check fresh and stale browser builds; older cached client builds may still
  format deterministic sources locally, but cannot bypass server provider claims.
- Existing delivered citations, local edition choices from previously delivered
  records, DOCX approval/export and bibliography copying do not consume a slot.
  Current payment rails and active paid plan accounting remain untouched.

## Authorized production release wiring (2026-11-18)

Owner approved deployment and live checks despite unavailable socket concurrency test.
Client and cache accounting now default on unless their environment flags are explicitly false;
the database singleton still stages false and remains the activation/rollback authority.
Install and verify dormant migration before deploying either integration. No secret changes required.
Existing paid accounts and admin roles must not be altered for smoke tests.
