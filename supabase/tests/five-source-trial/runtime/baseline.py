from pathlib import Path
import hashlib
root=Path(__file__).resolve().parents[4]
s=(root/'supabase/migrations/20261119010000_citation_five_source_trial.sql').read_text()
def f(name):
 a=s.index('CREATE OR REPLACE FUNCTION public.'+name+'(');b=s.index('\n$$;',a)+4;return s[a:b]
b=f('begin_citation_request').replace('  block text;\n  trial_used integer;','  block text;')
a=b.index('  -- All prior-request/retry/recovery validation above is unchanged.');z=b.index("  is_admin := (prof.plan = 'admin')",a);b=b[:a]+b[z:]
r=f('_citation_refund_receipt');a=r.index('  IF EXISTS(SELECT 1 FROM public.citation_trial_sources');z=r.index('  billing_id :=',a);r=r[:a]+r[z:]
t=f('finish_citation_request');a=t.index('  -- Same transaction/profile lock as recovery publication.');z=t.index('    INSERT INTO public.usage_terminal_failures',a);t=t[:a]+"  IF _outcome = 'failed' THEN\n"+t[z:]
for text,expected in [(b,'3509df563026d9ca419c5a47642e7ecd'),(r,'9ca4bc9c68f557702a8112d540d35407'),(t,'36b2b460653c41854668a782aa53b5ff')]:
 assert hashlib.md5(text.split('$$')[1].strip(' ').replace('\r','').encode()).hexdigest()==expected
 print(text)
