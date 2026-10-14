import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import * as m from "../../supabase/functions/legal-research-v2/shared/model.ts";
import * as od from "../../supabase/functions/legal-research-v2/shared/ordinaryDirect.ts";
import { resolveOrdinaryTransport, ORDINARY_RESEARCH_MODEL } from "../../supabase/functions/legal-research-v2/shared/ordinaryResearchPolicy.ts";

type Ev = Record<string, unknown>;
const globals = globalThis as unknown as { Deno?: unknown };
const originalFetch = globalThis.fetch;
const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
const keysRead: string[] = [];
let env: Record<string, string | undefined> = {};
let ledger: ReturnType<typeof od.createMemorySpendLedger>;

const messages = [{ role: "system" as const, content: "Synthetic system" }, { role: "user" as const, content: "Synthetic שאלה" }];
const tools = [{ name: "submit_research_memo", description: "memo", parameters: {
  type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false } },
{ name: "fetch", description: "fetch", parameters: { type: "object", properties: {}, additionalProperties: false } }];
const usageFix = { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 30, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 15 } };
const completed = (o: Ev = {}): Ev[] => [{ type: "response.completed", response: { id: "resp_1", model: "gpt-6.1-sol", status: "completed",
  usage: usageFix, reasoning: { effort: "medium" }, service_tier: "default", output: [
    { type: "reasoning", id: "rs_1", encrypted_content: "opaque-enc" },
    { type: "function_call", call_id: "call_1", name: "submit_research_memo", arguments: '{"answer":"memo"}' }], ...o } }];
const sse = (events: Ev[]) => new Response(new ReadableStream({ start(c) {
  c.enqueue(new TextEncoder().encode(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""))); c.close(); } }),
  { status: 200, headers: { "x-request-id": "req_1" } });
const countResp = (n = 100) => new Response(JSON.stringify({ object: "response.input_tokens", input_tokens: n }), { status: 200 });

/** Scripted fetch: count call then dispatch outcome. Gateway URLs are recorded as violations. */
function script(dispatch: () => Response | Promise<Response>, count = () => countResp()) {
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    requests.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : {} });
    if (u.includes("ai.gateway.lovable.dev")) throw new Error("GATEWAY_CALLED");
    if (u.endsWith("/v1/responses/input_tokens")) return count();
    if (u === "https://api.openai.com/v1/responses") return dispatch();
    throw new Error(`unexpected ${u}`);
  }) as typeof fetch;
}
const opts = (o: Partial<od.OrdinaryOptions> = {}): Parameters<typeof m.chat>[0] => ({
  model: ORDINARY_RESEARCH_MODEL, messages: structuredClone(messages), tools, toolChoice: "auto",
  usage: m.newUsageLedger(), beforeDirectDispatch: async () => true, ordinaryTransport: "openai_direct",
  runId: "11111111-1111-4111-8111-111111111111", costStage: "v2_research_agent", ...o,
} as Parameters<typeof m.chat>[0]);

beforeEach(() => {
  requests.length = 0; keysRead.length = 0;
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
  env = { V2_ORDINARY_RUN_CAP_USD: "1", V2_ORDINARY_DAY_CAP_USD: "5", OPENAI_API_KEY: "synthetic-key", LOVABLE_API_KEY: "synthetic-gw" };
  globals.Deno = { env: { get: (k: string) => { keysRead.push(k); return env[k]; } } };
  ledger = od.createMemorySpendLedger();
  od.setOrdinarySpendLedgerForTests(ledger.ledger);
});
afterEach(() => { globalThis.fetch = originalFetch; od.setOrdinarySpendLedgerForTests(null); delete globals.Deno; });

describe("ordinary transport selection (new jobs only)", () => {
  it("defaults to gateway; only the exact value enables direct", () => {
    assert.equal(resolveOrdinaryTransport(() => undefined), undefined);
    for (const v of ["gateway", "OPENAI_DIRECT", "openai_direct ", "1", ""]) assert.equal(resolveOrdinaryTransport(() => v), undefined);
    assert.equal(resolveOrdinaryTransport(() => "openai_direct"), "openai_direct");
  });
  it("intake stamps the transport only from the server switch, rejects pilot mixing, and eval intake never passes it", () => {
    const src = readFileSync("supabase/functions/legal-research-v2/index.ts", "utf8");
    assert.match(src, /\.\.\.ORDINARY_RESEARCH_SETTINGS,\n\s+agent_transport: resolveOrdinaryTransport\(\),/);
    assert.equal(src.match(/agent_transport: resolveOrdinaryTransport\(\)/g)?.length, 1);
    assert.doesNotMatch(src, /agent_transport:\s*body\./);
    assert.match(src, /throw new Error\("ordinary_transport_pilot_conflict"\)/);
  });
});

describe("pre-dispatch gates: no OpenAI call of any kind", () => {
  it("absent or invalid caps block even the input count", async () => {
    for (const caps of [{}, { V2_ORDINARY_RUN_CAP_USD: "1" }, { V2_ORDINARY_DAY_CAP_USD: "5" },
      { V2_ORDINARY_RUN_CAP_USD: "abc", V2_ORDINARY_DAY_CAP_USD: "5" }, { V2_ORDINARY_RUN_CAP_USD: "0", V2_ORDINARY_DAY_CAP_USD: "5" },
      { V2_ORDINARY_RUN_CAP_USD: "-1", V2_ORDINARY_DAY_CAP_USD: "5" }, { V2_ORDINARY_RUN_CAP_USD: "6", V2_ORDINARY_DAY_CAP_USD: "5" }]) {
      env = { OPENAI_API_KEY: "k", LOVABLE_API_KEY: "g", ...caps }; requests.length = 0;
      script(() => sse(completed()));
      const r = await m.chat(opts());
      assert.equal(r.ok, false); assert.equal(r.error, "ordinary_spend_caps_unset"); assert.equal(r.ordinary_dispatch, "not_sent");
      assert.equal(requests.length, 0);
    }
  });
  it("missing key fails before any call, is definitive, and never uses the gateway", async () => {
    delete env.OPENAI_API_KEY; script(() => sse(completed()));
    const o = opts(); const r = await m.chat(o);
    assert.equal(r.error, "ordinary_key_missing"); assert.equal(r.http_status, 401); assert.equal(requests.length, 0);
    assert.equal(od.ordinaryFailureIsDefinitive(o.usage, r), true);
  });
  it("wrong model or non-medium effort is rejected without calls", async () => {
    script(() => sse(completed()));
    assert.equal((await m.chat(opts({ model: "openai/gpt-6-astra" }))).error, "ordinary_model_mismatch");
    assert.equal((await m.chat(opts({ reasoningEffort: "high" }))).error, "ordinary_effort_mismatch");
    assert.equal(requests.length, 0);
  });
  it("run cap refusal happens after count but before dispatch", async () => {
    env.V2_ORDINARY_RUN_CAP_USD = "0.0001"; script(() => sse(completed()));
    const r = await m.chat(opts());
    assert.equal(r.error, "ordinary_spend_run_cap"); assert.equal(r.ordinary_dispatch, "not_sent");
    assert.deepEqual(requests.map(q => q.url), ["https://api.openai.com/v1/responses/input_tokens"]);
  });
  it("ledger unavailable fails closed", async () => {
    od.setOrdinarySpendLedgerForTests({ ...ledger.ledger, reserve: async () => "error" });
    script(() => sse(completed()));
    const r = await m.chat(opts()); assert.equal(r.error, "ordinary_spend_ledger_unavailable");
    assert.equal(requests.filter(q => q.url.endsWith("/v1/responses")).length, 0);
  });
  it("failed checkpoint releases the reservation and never dispatches", async () => {
    script(() => sse(completed()));
    const r = await m.chat(opts({ beforeDirectDispatch: async () => false }));
    assert.equal(r.error, "ordinary_checkpoint_failed"); assert.equal([...ledger.rows.values()][0].state, "released");
    assert.equal(requests.filter(q => q.url.endsWith("/v1/responses")).length, 0);
  });
});

describe("successful dispatch", () => {
  it("sends the exact native request, records usage, and settles", async () => {
    script(() => sse(completed()));
    const o = opts(); const r = await m.chat(o);
    assert.equal(r.ok, true); assert.equal(r.tool_calls[0].name, "submit_research_memo");
    const body = requests.at(-1)!.body;
    assert.equal(body.model, "gpt-6.1-sol"); assert.deepEqual(body.reasoning, { effort: "medium", summary: "auto" });
    assert.equal(body.store, false); assert.deepEqual(body.include, ["reasoning.encrypted_content"]);
    assert.equal(body.max_output_tokens, 16384); assert.equal(body.service_tier, "default");
    assert.equal((body.tools as Ev[])[0].strict, false);
    const a = o.usage!.ordinary_direct_attempts![0];
    assert.equal(a.outcome, "ok"); assert.equal(a.requested_model, "gpt-6.1-sol"); assert.equal(a.response_model, "gpt-6.1-sol");
    assert.equal(a.input_tokens, 100); assert.equal(a.cache_read_input_tokens, 30); assert.equal(a.reasoning_tokens, 15);
    assert.equal(a.effort_status, "matched");
    const row = [...ledger.rows.values()][0];
    assert.equal(row.state, "settled"); assert.ok(row.settled! <= row.reserved);
    assert.ok(!keysRead.some(k => k.startsWith("V2_DIRECT_PROVIDER_PILOT")), "ordinary must never read pilot flags");
    assert.ok(!keysRead.includes("LOVABLE_API_KEY"));
  });
  it("replays full native reasoning and tool history unchanged (no 64-item trimming)", async () => {
    const history: m.ChatMessage[] = [...structuredClone(messages)];
    for (let i = 0; i < 70; i++) {
      history.push({ role: "assistant", content: "", reasoning_items: [{ type: "reasoning", id: `rs_${i}`, encrypted_content: `enc_${i}` }],
        replay_seq: ["r", `c:call_${i}`], tool_calls: [{ id: `call_${i}`, type: "function", function: { name: "fetch", arguments: "{}" } }] } as m.ChatMessage);
      history.push({ role: "tool", tool_call_id: `call_${i}`, content: "result" } as m.ChatMessage);
    }
    script(() => sse(completed()), () => countResp(100));
    const r = await m.chat(opts({ messages: history }));
    const input = requests.at(-1)!.body.input as Ev[];
    assert.equal(input.filter(x => x.type === "reasoning").length, 70);
    assert.equal(input.filter(x => x.type === "function_call").length, 70);
    assert.equal(r.reasoning_items_forwarded, 70);
  });
});

describe("uncertain outcomes: no resend, no refund, liability held", () => {
  for (const [name, dispatch] of [
    ["5xx", () => new Response("secret body", { status: 503 })],
    ["429", () => new Response("rate", { status: 429 })],
    ["network error", () => { throw new TypeError("network"); }],
    ["interrupted stream", () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("event: x\ndata: {}\n\n")); c.error(new Error("cut")); } }), { status: 200 })],
  ] as Array<[string, () => Response]>) {
    it(`${name}: single dispatch, uncertain, held, blocks next call`, async () => {
      script(dispatch);
      const o = opts(); const r = await m.chat(o);
      assert.equal(r.ok, false); assert.equal(r.ordinary_dispatch, "uncertain");
      assert.equal(requests.filter(q => q.url === "https://api.openai.com/v1/responses").length, 1);
      assert.equal(od.ordinaryFailureIsDefinitive(o.usage, r), false);
      assert.equal([...ledger.rows.values()][0].state, "uncertain");
      requests.length = 0;
      const next = await m.chat({ ...opts(), usage: o.usage });
      assert.equal(next.error, "ordinary_reconciliation_required"); assert.equal(requests.length, 0);
      assert.equal(od.ordinaryFailureIsDefinitive(o.usage, next), false);
    });
  }
  it("a sent call without usage is held as uncertain", async () => {
    script(() => sse(completed({ usage: {} })));
    const o = opts(); const r = await m.chat(o);
    assert.equal(r.ordinary_dispatch, "uncertain"); assert.equal([...ledger.rows.values()][0].state, "uncertain");
  });
});

describe("no gateway fallback and pilot isolation", () => {
  it("a run with ordinary attempts cannot silently switch to the gateway", async () => {
    script(() => sse(completed()));
    const o = opts(); await m.chat(o); requests.length = 0;
    const r = await m.chat({ model: ORDINARY_RESEARCH_MODEL, messages: structuredClone(messages), usage: o.usage, costStage: "v2_research_agent" } as Parameters<typeof m.chat>[0]);
    assert.equal(r.error, "ordinary_transport_missing"); assert.equal(requests.length, 0);
  });
  it("pilot route and ordinary route cannot be combined", async () => {
    script(() => sse(completed()));
    const r = await m.chat({ ...opts(), directProvider: { provider: "openai", max_output_tokens: 16384 } } as Parameters<typeof m.chat>[0]);
    assert.equal(r.error, "ordinary_transport_pilot_conflict");
    const u = m.newUsageLedger(); u.direct_provider_attempts = [{} as never];
    assert.equal((await m.chat(opts({ usage: u }))).error, "ordinary_pilot_state_conflict");
    assert.equal(requests.length, 0);
  });
  it("cost-event writes stay disabled for this route", () => {
    assert.equal(od.ORDINARY_COST_EVENTS_ENABLED, false);
    assert.doesNotMatch(readFileSync("supabase/functions/legal-research-v2/shared/ordinaryDirect.ts", "utf8"), /ai_cost_events"\)|from\("ai_cost_events/);
  });
});

describe("spend ledger reference model (draft SQL semantics)", () => {
  const req = (id: string, usd: number, run = "r1") => ({ attempt_id: id, run_id: run, usd, run_cap_usd: 1, day_cap_usd: 2 });
  it("concurrent reservations never exceed run or day caps", async () => {
    const { ledger: l, rows } = od.createMemorySpendLedger();
    const out = await Promise.all(Array.from({ length: 20 }, (_, i) => l.reserve(req(`a${i}`, 0.3, `run${i % 4}`))));
    const total = [...rows.values()].reduce((s, r) => s + r.reserved, 0);
    assert.ok(total <= 2 + 1e-9);
    for (const run of ["run0", "run1", "run2", "run3"]) {
      assert.ok([...rows.values()].filter(r => r.run_id === run).reduce((s, r) => s + r.reserved, 0) <= 1 + 1e-9);
    }
    assert.ok(out.includes("day_cap") || out.includes("run_cap"));
  });
  it("attempt id reuse never authorizes, and transitions happen once", async () => {
    const { ledger: l } = od.createMemorySpendLedger();
    assert.equal(await l.reserve(req("x", 0.1)), "reserved");
    assert.equal(await l.reserve(req("x", 0.1)), "duplicate");
    assert.equal(await l.reserve({ ...req("x", 0.5), run_id: "other" }), "duplicate");
    assert.equal(await l.release("x"), true); assert.equal(await l.release("x"), false);
    assert.equal(await l.settle("x", 0.05), false); assert.equal(await l.markUncertain("x"), false);
  });
  it("uncertain liability carries across a UTC day change; settled does not", async () => {
    let now = new Date("2026-10-14T23:59:00Z");
    const { ledger: l } = od.createMemorySpendLedger(() => now);
    await l.reserve(req("u", 0.9, "a")); await l.markUncertain("u");
    await l.reserve(req("s", 0.9, "b")); await l.settle("s", 0.9);
    now = new Date("2026-10-15T00:01:00Z");
    assert.equal(await l.reserve(req("n1", 0.9, "c")), "reserved");
    assert.equal(await l.reserve(req("n2", 0.3, "d")), "day_cap");
  });
  it("settle cannot exceed the reservation", async () => {
    const { ledger: l } = od.createMemorySpendLedger();
    await l.reserve(req("y", 0.1)); assert.equal(await l.settle("y", 0.2), false);
  });
  it("draft SQL exists, is service-role only, and uses one advisory lock", () => {
    const sql = readFileSync("supabase/migration-drafts/20261014210000_ordinary_native_spend.sql", "utf8");
    assert.match(sql, /^-- DRAFT ONLY\. NOT EXECUTED/);
    assert.match(sql, /REVOKE ALL ON public\.research_native_spend FROM PUBLIC, anon, authenticated/);
    assert.match(sql, /pg_advisory_xact_lock/);
    assert.match(sql, /RETURN 'duplicate'/);
  });
});
