/** Zero-network unit tests; run with native Vitest in a complete checkout. */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { fetchWithBoundedRetry, FETCH_RETRY_DELAY_MS } from "../../supabase/functions/legal-research-v2/shared/boundedFetchRetry.ts";
import { StopPolicy, MAX_FETCH_RETRY_CALLS } from "../../supabase/functions/legal-research-v2/agent/stopPolicy.ts";

const URL = "https://example.test/judgment.pdf";
const budgets = (max_fetch_calls = 12) => ({
  max_agent_steps: 20, max_fetch_calls, max_search_calls: 5,
  max_lookup_calls: 5, max_raw_search_calls: 1,
});
function fixture(statuses: number[], options: {
  budget?: number; deadlineMs?: number; reserve?: boolean; retry?: boolean;
  headers?: Record<string, string>; unsafe?: boolean; allowRetry?: boolean;
  policy?: StopPolicy;
} = {}) {
  let calls = 0;
  const policy = options.policy ?? new StopPolicy(budgets(options.budget));
  const controller = new AbortController();
  const fn = () => fetchWithBoundedRetry(URL, {
    signal: controller.signal,
    deadlineAt: Date.now() + (options.deadlineMs ?? 5_000),
    allowRetry: options.allowRetry ?? true,
    isSafeUrl: () => !options.unsafe,
    reserveAttempt: options.reserve === false ? undefined : () => {
      if (policy.checkTool("fetch")) return false;
      policy.note("fetch");
      return true;
    },
    reserveRetry: options.retry === false ? undefined : () => policy.reserveFetchRetry(),
    fetchOnce: async () => {
      const status = statuses[calls++];
      assert.ok(status, "unexpected extra HTTP attempt");
      const r = new Response("body", { status, headers: options.headers });
      r.arrayBuffer = async () => { throw new Error("retry helper must not read/extract bodies"); };
      return r;
    },
  });
  return { fn, controller, calls: () => calls, policy };
}

describe("bounded in-call 504 retry with separate run allowance", () => {
  it("504 then 200 uses one base slot plus one retry", async () => {
    const f = fixture([504, 200], { budget: 1 });
    assert.equal((await f.fn()).status, 200);
    assert.equal(f.calls(), 2);
    assert.equal(f.policy.fetch_calls, 1);
    assert.equal(f.policy.fetch_retry_calls, 1);
  });
  it("504 twice stops after the second response", async () => {
    const f = fixture([504, 504]);
    assert.equal((await f.fn()).status, 504);
    assert.equal(f.calls(), 2);
    assert.equal(f.policy.fetch_calls, 1);
    assert.equal(f.policy.fetch_retry_calls, 1);
  });
  it("two base slots still reach B after A returns 504 twice", async () => {
    const policy = new StopPolicy(budgets(2));
    const a = fixture([504, 504], { policy });
    const b = fixture([200], { policy });
    assert.equal((await a.fn()).status, 504);
    assert.equal(policy.checkTool("fetch"), null);
    assert.equal((await b.fn()).status, 200);
    assert.equal(policy.fetch_calls, 2);
    assert.equal(policy.fetch_retry_calls, 1);
    assert.equal(a.calls() + b.calls(), 3);
  });
  it("spent retry allowance does not block a new base acquisition", async () => {
    const policy = new StopPolicy(budgets(4));
    for (let i = 0; i < MAX_FETCH_RETRY_CALLS; i++) {
      assert.equal((await fixture([504, 504], { policy }).fn()).status, 504);
    }
    const noRetry = fixture([504], { policy });
    assert.equal((await noRetry.fn()).status, 504);
    assert.equal(noRetry.calls(), 1);
    assert.equal((await fixture([200], { policy }).fn()).status, 200);
    assert.equal(policy.fetch_calls, 4);
    assert.equal(policy.fetch_retry_calls, 2);
  });
  for (const status of [200, 401, 403, 404, 429, 500, 502, 503]) {
    it(`does not retry HTTP ${status}`, async () => {
      const f = fixture([status]);
      assert.equal((await f.fn()).status, status);
      assert.equal(f.calls(), 1);
      assert.equal(f.policy.fetch_calls, 1);
      assert.equal(f.policy.fetch_retry_calls, 0);
    });
  }
  for (const value of ["2", "Fri, 02 Oct 2026 10:00:00 GMT", "invalid"]) {
    it(`does not override Retry-After: ${value}`, async () => {
      const f = fixture([504], { headers: { "retry-after": value } });
      assert.equal((await f.fn()).status, 504);
      assert.equal(f.calls(), 1);
      assert.equal(f.policy.fetch_retry_calls, 0);
    });
  }
  it("zero base budget prevents any request or retry debit", async () => {
    const f = fixture([], { budget: 0 });
    await assert.rejects(f.fn, /fetch_budget_exhausted/);
    assert.equal(f.calls(), 0);
    assert.equal(f.policy.fetch_calls, 0);
    assert.equal(f.policy.fetch_retry_calls, 0);
  });
  it("missing independent callback never falls back to base budget", async () => {
    const f = fixture([504], { retry: false });
    assert.equal((await f.fn()).status, 504);
    assert.equal(f.calls(), 1);
    assert.equal(f.policy.fetch_calls, 1);
    assert.equal(f.policy.fetch_retry_calls, 0);
  });
  it("missing base callback preserves the old single attempt", async () => {
    const f = fixture([504], { reserve: false });
    assert.equal((await f.fn()).status, 504);
    assert.equal(f.calls(), 1);
    assert.equal(f.policy.fetch_retry_calls, 0);
  });
  it("allowRetry false preserves existing court/cache exclusions", async () => {
    const f = fixture([504], { allowRetry: false });
    assert.equal((await f.fn()).status, 504);
    assert.equal(f.calls(), 1);
    assert.equal(f.policy.fetch_retry_calls, 0);
  });
  it("does not retry unsafe redirect destinations", async () => {
    const f = fixture([504], { unsafe: true });
    assert.equal((await f.fn()).status, 504);
    assert.equal(f.calls(), 1);
    assert.equal(f.policy.fetch_retry_calls, 0);
  });
  it("expired deadline prevents all work", async () => {
    const f = fixture([], { deadlineMs: -1 });
    await assert.rejects(f.fn, /fetch_deadline_exhausted/);
    assert.equal(f.calls(), 0);
    assert.equal(f.policy.fetch_calls, 0);
    assert.equal(f.policy.fetch_retry_calls, 0);
  });
  it("insufficient time for delay and useful retry returns first response", async () => {
    const f = fixture([504], { deadlineMs: FETCH_RETRY_DELAY_MS + 900 });
    assert.equal((await f.fn()).status, 504);
    assert.equal(f.calls(), 1);
    assert.equal(f.policy.fetch_retry_calls, 0);
  });
  it("prior cancellation prevents all work", async () => {
    const f = fixture([]); f.controller.abort();
    await assert.rejects(f.fn, /fetch_deadline_exhausted/);
    assert.equal(f.calls(), 0);
  });
  it("cancellation during delay prevents the retry debit", async () => {
    const f = fixture([504]);
    const pending = f.fn(); setTimeout(() => f.controller.abort(), 10);
    await assert.rejects(pending, /fetch_aborted/);
    assert.equal(f.calls(), 1);
    assert.equal(f.policy.fetch_calls, 1);
    assert.equal(f.policy.fetch_retry_calls, 0);
  });
  it("exceptions do not trigger blanket retry", async () => {
    let n = 0, retries = 0;
    await assert.rejects(fetchWithBoundedRetry(URL, {
      signal: new AbortController().signal, deadlineAt: Date.now() + 5_000,
      allowRetry: true, isSafeUrl: () => true, reserveAttempt: () => true,
      reserveRetry: () => { retries++; return true; },
      fetchOnce: async () => { n++; throw new Error("network_reset"); },
    }), /network_reset/);
    assert.equal(n, 1); assert.equal(retries, 0);
  });
  it("parallel fetches cannot exceed the shared retry cap", async () => {
    const policy = new StopPolicy(budgets(4));
    const fixtures = Array.from({ length: 4 }, () => fixture([504, 504], { policy }));
    await Promise.all(fixtures.map(f => f.fn()));
    assert.equal(policy.fetch_calls, 4);
    assert.equal(policy.fetch_retry_calls, MAX_FETCH_RETRY_CALLS);
    assert.equal(fixtures.reduce((n, f) => n + f.calls(), 0), 6);
  });
});

describe("durable independent retry ceiling", () => {
  it("new runs have exactly two additional attempts and unchanged base limit", () => {
    const p = new StopPolicy(budgets());
    assert.equal(p.reserveFetchRetry(), true);
    assert.equal(p.reserveFetchRetry(), true);
    assert.equal(p.reserveFetchRetry(), false);
    assert.equal(p.fetch_calls, 0);
    assert.equal(p.checkTool("fetch"), null);
    for (let i = 0; i < 12; i++) p.note("fetch");
    assert.equal(p.checkTool("fetch"), "budget_exhausted:fetch (12)");
    assert.equal(p.fetch_retry_calls, 2);
  });
  it("JSON round trip retains the exact spent allowance", () => {
    const p = new StopPolicy(budgets()); p.note("fetch"); p.reserveFetchRetry();
    const saved = JSON.parse(JSON.stringify(p.toJSON()));
    const restored = StopPolicy.fromJSON(budgets(), saved);
    assert.equal(restored.fetch_calls, 1);
    assert.equal(restored.fetch_retry_calls, 1);
    assert.equal(restored.reserveFetchRetry(), true);
    assert.equal(restored.reserveFetchRetry(), false);
    const resumed = StopPolicy.fromJSON(budgets(), restored.toJSON());
    assert.equal(resumed.reserveFetchRetry(), false);
    assert.equal(resumed.fetch_calls, 1);
  });
  it("legacy checkpoint with prior fetches conservatively gets no renewed retries", () => {
    const legacy = new StopPolicy(budgets()).toJSON();
    delete legacy.fetch_retry_calls; legacy.fetch_calls = 1;
    const restored = StopPolicy.fromJSON(budgets(), legacy);
    assert.equal(restored.fetch_retry_calls, 2);
    assert.equal(restored.reserveFetchRetry(), false);
    assert.equal(restored.checkTool("fetch"), null);
    assert.equal(restored.fetch_calls, 1);
  });
  it("pristine legacy checkpoint and absent checkpoint retain initial allowance", () => {
    const legacy = new StopPolicy(budgets()).toJSON(); delete legacy.fetch_retry_calls;
    for (const state of [legacy, null, undefined]) {
      const restored = StopPolicy.fromJSON(budgets(), state);
      assert.equal(restored.fetch_retry_calls, 0);
      assert.equal(restored.reserveFetchRetry(), true);
    }
  });
  it("explicit zero in a new checkpoint remains zero despite prior base fetches", () => {
    const p = new StopPolicy(budgets()); p.note("fetch");
    const restored = StopPolicy.fromJSON(budgets(), p.toJSON());
    assert.equal(restored.fetch_retry_calls, 0);
    assert.equal(restored.reserveFetchRetry(), true);
  });
  for (const value of [-1, 0.5, NaN, Infinity]) {
    it(`malformed persisted retry count ${value} never renews allowance`, () => {
      const snapshot = new StopPolicy(budgets()).toJSON(); snapshot.fetch_retry_calls = value;
      const restored = StopPolicy.fromJSON(budgets(), snapshot);
      assert.equal(restored.reserveFetchRetry(), false);
    });
  }
});
