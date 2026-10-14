/** Offline browser verification of REAL Chromium IndexedDB. No fake IDB,
 * production service, provider, account or database connection is used. */
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import assert from 'node:assert/strict';

const server = await createServer({ server: { host: '127.0.0.1', port: 4193, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true });
const context = await browser.newContext();
const base = 'http://127.0.0.1:4193';
await context.route('**/*', (route) => {
  const url = new URL(route.request().url());
  if (url.origin !== base) return route.abort('blockedbyclient');
  if (url.pathname === '/__journal_test__') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Offline journal test</title>' });
  return route.continue();
});
const results = [];
async function setup(page, dbName, capacity = 256) {
  await page.goto(`${base}/__journal_test__`);
  await page.evaluate(async ({ dbName, capacity }) => {
    const { CitationRequestIdentity } = await import('/src/lib/citationRequestIdentity.ts');
    const { IndexedDbCitationRecoveryJournal } = await import('/src/lib/citationRecoveryJournal.ts');
    window.journal = new IndexedDbCitationRecoveryJournal(dbName);
    window.registry = new CitationRequestIdentity(capacity, window.journal);
    window.input = { messages: [{ role: 'user', content: 'Fixture citation text' }] };
    window.run = async (account = 'account-A', outcome = 'unknown', descriptor) => {
      let dispatched;
      const result = await window.registry.invoke(account, window.input, null, async (body) => {
        dispatched = body;
        const committed = await window.journal.find(account, body.requestId);
        if (committed?.requestId !== body.requestId) throw new Error('Dispatch preceded durable commit');
        return { errorInfo: { code: outcome === 'failed' ? 'AI_REFUSED' : 'REQUEST_OUTCOME_UNKNOWN',
          requestId: body.requestId, body: { status: outcome, requestId: body.requestId } } };
      }, () => true, descriptor);
      window.descriptor = result.errorInfo?.citationRetry;
      return { request: dispatched, descriptor: window.descriptor };
    };
  }, { dbName, capacity });
}
try {
  const a = await context.newPage(), b = await context.newPage();
  const db = `journal-verification-${Date.now()}`;
  await setup(a, db); await setup(b, db);
  const roots = await Promise.all([a.evaluate(() => window.run()), b.evaluate(() => window.run())]);
  assert.equal(roots[0].request.requestId, roots[1].request.requestId);
  assert.equal(roots[0].request.citationRequestVersion, 3);
  results.push('Distinct pages allocate one root ID; each dispatch observes its committed metadata');
  await setup(a, db);
  assert.equal((await a.evaluate(() => window.run())).request.requestId, roots[0].request.requestId);
  results.push('Page reload restores the exact unknown root ID');
  assert.notEqual((await b.evaluate(() => window.run('account-B'))).request.requestId, roots[0].request.requestId);
  results.push('Account B is isolated from account A');
  await a.evaluate(() => window.registry.clearMemory());
  assert.equal((await a.evaluate(() => window.run())).request.requestId, roots[0].request.requestId);
  results.push('Logout memory clearing preserves account-owned durable identity');
  const failedRoots = await Promise.all([a.evaluate(() => window.run('account-A', 'failed')), b.evaluate(() => window.run('account-A', 'failed'))]);
  const parent = failedRoots[0].descriptor.failedRequestId;
  const children = await Promise.all([a.evaluate(() => window.run('account-A', 'failed', window.descriptor)), b.evaluate(() => window.run('account-A', 'failed', window.descriptor))]);
  assert.equal(children[0].request.requestId, children[1].request.requestId);
  assert.equal(children[0].request.retryOfRequestId, parent);
  results.push('Concurrent explicit failed-parent gestures choose one canonical child');
  const staleParent = failedRoots[1].descriptor;
  const grandchild = await a.evaluate(() => window.run('account-A', 'unknown', window.descriptor));
  assert.equal(grandchild.request.retryOfRequestId, children[0].request.requestId);
  await assert.rejects(b.evaluate((descriptor) => window.run('account-A', 'unknown', descriptor), staleParent), /CITATION_RETRY_STALE/);
  results.push('A stale ancestor cannot silently create or target a grandchild');

  const canonicalDb = `${db}-canonical`;
  await setup(a, canonicalDb);
  const failed = await a.evaluate(() => window.run('account-A', 'failed'));
  const canonicalId = 'server-canonical-child-0001';
  await a.evaluate(async (canonicalId) => {
    await window.registry.invoke('account-A', window.input, null, async (body) => ({ errorInfo: {
      code: 'REQUEST_ALREADY_STARTED', requestId: canonicalId, body: { requestId: canonicalId, status: 'unknown' },
    } }), () => true, window.descriptor);
  }, canonicalId);
  await setup(a, canonicalDb);
  const adopted = await a.evaluate(() => window.run());
  assert.equal(adopted.request.requestId, canonicalId);
  assert.equal(adopted.request.retryOfRequestId, failed.descriptor.failedRequestId);
  results.push('Server canonical-child adoption survives page reload');

  const old = await a.evaluate(async () => {
    const e = { accountId: 'old-account', key: 'a'.repeat(64), keyVersion: 1, requestId: 'old-unknown-request',
      parentRequestId: null, projectId: null, createdAt: '2020-01-01T00:00:00.000Z', capacity: 256 };
    await window.journal.claim(e);
    const again = await window.journal.claim({ ...e, requestId: 'new-proposed-request', createdAt: new Date().toISOString() });
    return { entry: again, keys: Object.keys(again).sort() };
  });
  assert.equal(old.entry.requestId, 'old-unknown-request');
  assert.deepEqual(old.keys, ['accountId', 'createdAt', 'key', 'keyVersion', 'parentRequestId', 'projectId', 'requestId'].sort());
  results.push('Metadata survives well beyond 24-hour content TTL and contains no input/result/token');
  const replay = await a.evaluate(async () => {
    const e = { accountId: 'delivered-account', key: 'b'.repeat(64), keyVersion: 1, requestId: 'delivered-old-request',
      parentRequestId: null, projectId: null, createdAt: new Date().toISOString(), capacity: 256 };
    const claimed = await window.journal.claim(e);
    await window.journal.delivered(claimed);
    const repeated = await window.journal.claim(e);
    let changedError;
    try { await window.journal.claim({ ...e, key: 'c'.repeat(64) }); } catch (error) { changedError = error.message; }
    return { id: repeated.requestId, changedError };
  });
  assert.equal(replay.id, 'delivered-old-request');
  assert.equal(replay.changedError, 'REQUEST_FINGERPRINT_MISMATCH');
  results.push('Replaying a delivered explicit ID never rotates it or rebinds it to other input');


  await setup(a, `${db}-capacity`, 1);
  await a.evaluate(() => window.run());
  await setup(a, `${db}-capacity`, 1);
  await assert.rejects(a.evaluate(async () => { window.input.messages[0].content = 'Different'; return window.run(); }), /REQUEST_RECOVERY_LIMIT/);
  results.push('Durable per-account capacity survives reload without evicting unknown requests');

  const unavailable = await a.evaluate(async () => {
    const { CitationRequestIdentity, citationRequests } = await import('/src/lib/citationRequestIdentity.ts');
    Object.defineProperty(window, 'indexedDB', { configurable: true, get() { throw new DOMException('Storage blocked', 'SecurityError'); } });
    let calls = 0;
    const codes = [];
    for (const registry of [new CitationRequestIdentity(), citationRequests]) {
      try { await registry.invoke('account', window.input, null, async () => { calls++; return { errorInfo: null }; }); }
      catch (error) { codes.push(error.message); }
    }
    return { calls, codes };
  });
  assert.equal(unavailable.calls, 0);
  assert.deepEqual(unavailable.codes, ['CITATION_RECOVERY_STORAGE_UNAVAILABLE', 'CITATION_RECOVERY_STORAGE_UNAVAILABLE']);
  results.push('Production defaults and global singleton fail closed when browser storage access is denied');
  console.log(JSON.stringify({ passed: results.length, engine: await browser.version(), checks: results }, null, 2));
} finally {
  await context.close(); await browser.close(); await server.close();
}
