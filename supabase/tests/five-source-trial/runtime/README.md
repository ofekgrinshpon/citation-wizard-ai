# Independent disposable PostgreSQL runtime lab

This is a newly authored minimal accounting test, **not** the prohibited historical
usage-guards fixture. It never connects to an existing database or remote service.
The runner initializes a fresh temporary cluster itself, executes a genuine PostgreSQL
standalone backend, inspects errors and explicit success markers, then exits. No server
remains running. No binaries, cluster files, private read-only evidence, or logs are bundled.

## Run

Requires Python 3 and installed `postgres` + sibling `initdb` binaries. If native libraries
are not on the normal loader path, supply their directory.

```sh
python supabase/tests/five-source-trial/runtime/run.py \
  --postgres /path/to/native/bin/postgres \
  --library-path /path/to/native/lib
```

Executed successfully using PostgreSQL 18.6:

```sh
python supabase/tests/five-source-trial/runtime/run.py \
  --postgres /tmp/relex-pg-quota/dist/package/native/bin/postgres \
  --library-path /tmp/relex-pg-quota/dist/package/native/lib
```

Result: `PASS: PostgreSQL serial accounting, lifecycle, privileges, route collision tests.`
No ERROR/FATAL/PANIC; all three explicit PASS markers found. Tests cover provider/local
5th vs 6th source, replay without execution, no weighted trial debit, confirmed failure
release, duplicate finalization, unknown retention, active paid/admin exemption, expired
plan fallback, successful atomic recovery write, no success refund, owner-only local debit,
stale account and hash mismatch, permissions, upgrade/expiry/rollback without quota reset,
and both directions of local/provider request ID collision.

`baseline.py` reconstructs the prior three function bodies from the new migration by
removing only the trial additions, checks their expected hashes, and emits SQL. The new
migration's actual prerequisite guard and actual changed functions are then executed.
The E-string transformation preserves dollar body bytes exactly for `--single -j` input;
otherwise removing blank lines would change the prerequisite hashes.

## Limits

- Two independent real SQL clients/races were **not** tested: the environment refused
  Unix-socket creation. Single-user mode cannot establish concurrent lock correctness.
- Schema is independently authored minimalist synthetic tables. Recovery validators,
  claim readers, and roles are stubbed; production schema triggers and full input/parser
  compatibility still need verification. Legacy paid refunds deliberately fail in this lab
  because they are not the changed functionality; active paid debit is tested.
- Existing historical fixture/draft execution remains prohibited and was not performed.
- All records are synthetic. No deployment, activation, application database change, or
  provider call is part of this runner.
