/** Zero-network unit tests; run with native Vitest in a complete checkout. */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { fetchWithBoundedRetry, FETCH_RETRY_DELAY_MS } from "../../supabase/functions/legal-research-v2/shared/boundedFetchRetry.ts";

const URL = "https://example.test/judgment.pdf";
function fixture(statuses: number[], options: { budget?: number; deadlineMs?: number; reserve?: boolean; headers?: Record<string,string>; unsafe?: boolean } = {}) {
  let calls = 0, charged = 0;
  const controller = new AbortController();
  const fn = () => fetchWithBoundedRetry(URL, {
    signal: controller.signal,
    deadlineAt: Date.now() + (options.deadlineMs ?? 5_000),
    allowRetry: true,
    isSafeUrl: () => !options.unsafe,
    reserveAttempt: options.reserve === false ? undefined : () => {
      if (charged >= (options.budget ?? 2)) return false;
      charged++; return true;
    },
    fetchOnce: async () => {
      const status = statuses[calls++];
      assert.ok(status, "unexpected extra HTTP attempt");
      const r = new Response("body", { status, headers: options.headers });
      r.arrayBuffer = async () => { throw new Error("retry helper must not read/extract bodies"); };
      return r;
    },
  });
  return { fn, controller, calls: () => calls, charged: () => charged };
}

describe("bounded in-call 504 retry", () => {
  it("504 then 200, exactly two debits", async () => {
    const f=fixture([504,200]); assert.equal((await f.fn()).status,200); assert.equal(f.calls(),2); assert.equal(f.charged(),2);
  });
  it("504 twice stops after the second response", async () => {
    const f=fixture([504,504]); assert.equal((await f.fn()).status,504); assert.equal(f.calls(),2); assert.equal(f.charged(),2);
  });
  for (const status of [200,401,403,404,429,500,502,503]) it(`does not retry HTTP ${status}`, async () => {
    const f=fixture([status]); assert.equal((await f.fn()).status,status); assert.equal(f.calls(),1); assert.equal(f.charged(),1);
  });
  for (const value of ["2", "Fri, 02 Oct 2026 10:00:00 GMT", "invalid"]) it(`does not override Retry-After: ${value}`, async () => {
    const f=fixture([504],{headers:{"retry-after":value}}); assert.equal((await f.fn()).status,504); assert.equal(f.calls(),1);
  });
  it("budget zero prevents any request/debit", async () => {
    const f=fixture([],{budget:0}); await assert.rejects(f.fn,/fetch_budget_exhausted/); assert.equal(f.calls(),0); assert.equal(f.charged(),0);
  });
  it("one remaining slot permits initial only", async () => {
    const f=fixture([504],{budget:1}); assert.equal((await f.fn()).status,504); assert.equal(f.calls(),1); assert.equal(f.charged(),1);
  });
  it("no reservation callback preserves the old single attempt", async () => {
    const f=fixture([504],{reserve:false}); assert.equal((await f.fn()).status,504); assert.equal(f.calls(),1);
  });
  it("does not retry unsafe redirect destinations", async () => {
    const f=fixture([504],{unsafe:true}); assert.equal((await f.fn()).status,504); assert.equal(f.calls(),1);
  });
  it("expired deadline prevents all work", async () => {
    const f=fixture([],{deadlineMs:-1}); await assert.rejects(f.fn,/fetch_deadline_exhausted/); assert.equal(f.calls(),0); assert.equal(f.charged(),0);
  });
  it("insufficient time for delay and useful retry returns first response", async () => {
    const f=fixture([504],{deadlineMs:FETCH_RETRY_DELAY_MS+900}); assert.equal((await f.fn()).status,504); assert.equal(f.calls(),1);
  });
  it("prior cancellation prevents all work", async () => {
    const f=fixture([]); f.controller.abort(); await assert.rejects(f.fn,/fetch_deadline_exhausted/); assert.equal(f.calls(),0);
  });
  it("cancellation during delay prevents the retry/debit", async () => {
    const f=fixture([504]); const pending=f.fn(); setTimeout(()=>f.controller.abort(),10); await assert.rejects(pending,/fetch_aborted/); assert.equal(f.calls(),1); assert.equal(f.charged(),1);
  });
  it("exceptions do not trigger blanket retry", async () => {
    let n=0;
    await assert.rejects(fetchWithBoundedRetry(URL,{signal:new AbortController().signal,deadlineAt:Date.now()+5000,allowRetry:true,isSafeUrl:()=>true,reserveAttempt:()=>true,fetchOnce:async()=>{n++;throw new Error("network_reset");}}),/network_reset/);
    assert.equal(n,1);
  });
});
