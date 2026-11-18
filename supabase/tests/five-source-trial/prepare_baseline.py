"""Render (never execute) fixture-only prerequisite SQL from reviewed migration."""
from pathlib import Path
import hashlib

root = Path(__file__).resolve().parents[3]
sql = (root / 'supabase/migrations/20261119010000_citation_five_source_trial.sql').read_text()
a = sql.index('CREATE OR REPLACE FUNCTION public.begin_citation_request(')
b = sql.index('\n$$;', a) + 4
function = sql[a:b]
function = function.replace('  block text;\n  trial_used integer;', '  block text;', 1)
start = function.index('  -- All prior-request/retry/recovery validation above is unchanged.')
end = function.index("  is_admin := (prof.plan = 'admin')", start)
function = function[:start] + function[end:]
body = function.split('$$')[1]
assert hashlib.md5(body.strip(' ').replace('\r', '').encode()).hexdigest() == '3509df563026d9ca419c5a47642e7ecd'
print("-- FIXTURE ONLY: never run against application data.")
print("DO $$ BEGIN IF current_database() NOT LIKE 'relex_usage_fixture_%' THEN RAISE EXCEPTION 'Not a fixture database'; END IF; END $$;")
print(function)
