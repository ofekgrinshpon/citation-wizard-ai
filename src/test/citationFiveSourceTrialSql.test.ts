import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const sql = readFileSync('supabase/migrations/20261119010000_citation_five_source_trial.sql', 'utf8');
const old = readFileSync('supabase/migration-drafts/20261013100000_citation_request_refund_guards.sql', 'utf8');
function definition(source: string, name: string) {
 const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
 return source.slice(start, source.indexOf('\n$$;', start) + 4);
}
describe('five-source trial SQL security and integration contract (static, not PostgreSQL execution)', () => {
 it('fails closed on exact deployed prerequisite drift before schema writes', () => {
  expect(sql.indexOf('DO $prerequisites$')).toBeLessThan(sql.indexOf('CREATE TABLE'));
  expect(sql).toContain('IF actual IS DISTINCT FROM required.fingerprint THEN');
  for (const [name, hash] of [
    ['finish_citation_request', '36b2b460653c41854668a782aa53b5ff'],
    ['_citation_refund_receipt', '9ca4bc9c68f557702a8112d540d35407']]) {
    const body = definition(old, name).split('$$')[1];
    expect(createHash('md5').update(body.replace(/\r/g, '').replace(/^ +| +$/g, '')).digest('hex')).toBe(hash);
    expect(sql).toContain(hash);
  }
 });
 it('stages disabled and denies clients config and ledger permissions', () => {
  expect(sql).toContain('VALUES(true,false)');
  for (const table of ['citation_trial_config', 'citation_trial_sources']) {
   expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
   expect(sql).toContain(`REVOKE ALL ON public.${table} FROM PUBLIC, anon, authenticated`);
  }
 });
 it('uses auth.uid for local debit and status, never a user supplied account', () => {
  expect(sql).toContain('CREATE FUNCTION public.get_citation_trial_status()');
  expect(sql).toContain('CREATE FUNCTION public.consume_local_citation_trial(_request_id text,_fingerprint text,_expected_user uuid)');
  expect(sql).toContain('WHERE id=auth.uid() FOR UPDATE');
  expect(sql).toContain('_expected_user IS DISTINCT FROM auth.uid()');
  expect(sql).toContain("'CITATION_RETRY_STALE'");
  expect(sql).toContain("prior.route <> 'local' OR prior.fingerprint <> _fingerprint");
 });
 it('retains all begin validation and legacy paid accounting byte for byte', () => {
  const after = definition(sql,'begin_citation_request');
  const marker = "  is_admin := (prof.plan = 'admin')";
  const deployed = after.slice(after.indexOf('AS $$') + 5, after.lastIndexOf('$$;'))
    .replace('  block text;\n  trial_used integer;', '  block text;');
  const branchStart = deployed.indexOf('  -- All prior-request/retry/recovery validation above is unchanged.');
  const branchEnd = deployed.indexOf(marker, branchStart);
  const reconstructed = deployed.slice(0, branchStart) + deployed.slice(branchEnd);
  expect(createHash('md5').update(reconstructed.replace(/\r/g, '').replace(/^ +| +$/g, '')).digest('hex'))
    .toBe('3509df563026d9ca419c5a47642e7ecd');
  expect(after).not.toContain('per_source');
  expect(after.indexOf('FOR UPDATE')).toBeLessThan(after.indexOf('IF trial_used >= 5'));
  expect(after.indexOf('RETRY_PARENT_NOT_FAILED')).toBeLessThan(after.indexOf('IF trial_used >= 5'));
  expect(after.indexOf('REQUEST_FINGERPRINT_MISMATCH')).toBeLessThan(after.indexOf('IF trial_used >= 5'));
 });
 it('claims exactly one source per trial request before any weighted branch', () => {
  const begin = definition(sql,'begin_citation_request');
  expect(begin).toContain("_retry_of_request_id,NULL,1,'in_progress',token");
  expect(begin).toContain("WHERE user_id=_user_id AND state <> 'failed'");
  expect(begin).toContain("'trial_remaining',4-trial_used");
  expect(begin).not.toContain("interval '24 hours' THEN");
 });
 it('settles under original token, recovery and terminal state checks', () => {
  const finish = definition(sql,'finish_citation_request');
  const at = finish.indexOf('UPDATE public.citation_trial_sources');
  expect(finish.indexOf('ATTEMPT_TOKEN_MISMATCH')).toBeLessThan(at);
  expect(finish.indexOf('TERMINAL_STATE_CONFLICT')).toBeLessThan(at);
  expect(finish.indexOf('UPDATE public.citation_recovery_payloads SET result')).toBeLessThan(at);
  expect(finish).toContain("IF _outcome = 'failed' AND NOT EXISTS(SELECT 1 FROM public.citation_trial_sources");
 });
 it('does not expire or reset quota or change paid profile credits', () => {
  expect(sql).not.toContain('DELETE FROM public.citation_trial_sources');
  expect(sql).not.toContain('TRUNCATE');
  expect(sql).toContain('(_prof).billing_period_ends_at <= now()');
  expect(sql).toContain("(_prof).plan = 'admin'");
 });
});
