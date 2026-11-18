"""Run new synthetic accounting lab in a NEW disposable PostgreSQL cluster.

Never connects to a socket/TCP/database URL or existing data directory. No existing
usage-guards fixture/draft is executed. No credentials or application data needed.
"""
from pathlib import Path
import argparse
import os
import re
import subprocess
import sys
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--postgres', required=True, type=Path, help='Installed postgres server binary')
parser.add_argument('--library-path', type=Path, help='Optional native library folder')
args = parser.parse_args()
here = Path(__file__).resolve().parent
root = here.parents[3]
lab = Path(tempfile.mkdtemp(prefix='relex-trial-fixture-'))
data = lab / 'data'
env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'HOME': str(lab), 'LANG': 'C'}
if args.library_path:
    env['LD_LIBRARY_PATH'] = str(args.library_path.resolve())
binary = args.postgres.resolve()
subprocess.run([str(binary.with_name('initdb')), '-D', str(data), '-U', 'postgres', '--no-locale', '--encoding=UTF8', '--auth=trust'], env=env, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
baseline = subprocess.check_output([sys.executable, str(here / 'baseline.py')], text=True)
source = '\n'.join([
    (here/'setup.sql').read_text(), baseline,
    (root/'supabase/migrations/20261119010000_citation_five_source_trial.sql').read_text(),
    (here/'test.sql').read_text(), (here/'extra.sql').read_text(), (here/'collision.sql').read_text(),
])
# -j delimits input on a blank line even inside a dollar-quoted body. Encode the
# bodies as E strings so their stored prosrc bytes/hashes remain EXACT, including
# blank lines. Merely deleting blank lines would correctly trip the drift guard.
def encode(match):
    return "E'" + match.group(2).replace('\\', '\\\\').replace("'", "''").replace('\n', '\\n').replace('\r', '\\r') + "'"
source = re.sub(r'(\$[a-zA-Z_]*\$)(.*?)\1', encode, source, flags=re.S)
source = '\n'.join(line for line in source.splitlines() if line.strip() and not line.startswith('\\')) + '\n\n'
result = subprocess.run([str(binary), '--single', '-j', '-D', str(data), 'postgres'], input=source, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
(lab/'result.log').write_text(result.stdout)
expected = ['PASS synthetic accounting and privileges', 'PASS extra settlement lifecycle and local quota', 'PASS cross-route collision guards']
failed = result.returncode != 0 or re.search(r'\b(?:ERROR|FATAL|PANIC):', result.stdout) or not all(marker in result.stdout for marker in expected)
if failed:
    print(f'FAIL. Inspect {lab}/result.log. Single-user exit code alone is not proof.', file=sys.stderr)
    sys.exit(1)
print('PASS: PostgreSQL serial accounting, lifecycle, privileges, route collision tests.')
print('NOT TESTED: concurrent SQL clients (no server/socket); actual recovery validators are stubbed.')
print(f'Disposable lab retained: {lab}. Backend exited; no server running.')
