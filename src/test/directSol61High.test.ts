import { afterEach, beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { chat, newUsageLedger, type UsageLedger } from "../../supabase/functions/legal-research-v2/shared/model.ts";
import { directProviderConfigError, SOL61_PILOT_NATIVE_BUDGET_USD } from "../../supabase/functions/legal-research-v2/shared/directProviderPolicy.ts";
import { parseEvaluationReasoningEffort } from "../../supabase/functions/legal-research-v2/shared/evaluationReasoning.ts";

const globals = globalThis as typeof globalThis & { Deno?: { env: { get(key: string): string | undefined } } };
const oldFetch = globalThis.fetch, oldDeno = globals.Deno, oldInfo = console.info;
const oldCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");
const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
const logs: unknown[] = [];
let terminal: Record<string, unknown>, terminalType: string;
let checkpoint: () => Promise<boolean>;
let enabled: string;
const config = { provider: "openai" as const, max_output_tokens: 16384 };
const opts = (effort: "medium" | "high" = "high", usage: UsageLedger = newUsageLedger()) => ({
  model: "openai/gpt-6.1-sol", directProvider: config, reasoningEffort: effort, usage,
  messages: [{ role: "user" as const, content: "PRIVATE_PROMPT" }],
  tools: [{ name: "submit_research_memo", description: "Synthetic fixture", parameters: {
    type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false,
  } }], toolChoice: "required" as const, beforeDirectDispatch: () => checkpoint(),
});
beforeEach(() => {
  requests.length = 0; logs.length = 0; enabled = "openai";
  checkpoint = async () => true; terminalType = "response.completed";
  terminal = { id: "resp_high", model: "gpt-6.1-sol", status: "completed", service_tier: "default", reasoning: { effort: "high" },
    usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 10 } },
    output: [{ type: "function_call", call_id: "call_high", name: "submit_research_memo", arguments: '{"answer":"PRIVATE_ANSWER"}' }],
  };
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
  globals.Deno = { env: { get: key => key === "V2_DIRECT_PROVIDER_PILOT" ? enabled : key === "OPENAI_API_KEY" ? "synthetic-only" : undefined } };
  console.info = value => { logs.push(JSON.parse(value)); };
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    if (String(url).endsWith("/input_tokens")) return new Response(JSON.stringify({ object: "response.input_tokens", input_tokens: 100 }));
    return new Response(`data: ${JSON.stringify({ type: terminalType, response: terminal })}\n\n`, { headers: { "x-request-id": "req_high" } });
  };
});
afterEach(() => {
  globalThis.fetch = oldFetch; globals.Deno = oldDeno; console.info = oldInfo;
  if (oldCrypto) Object.defineProperty(globalThis, "crypto", oldCrypto); else Reflect.deleteProperty(globalThis, "crypto");
});

describe("isolated Sol 6.1 high pilot", () => {
  it("permits high only for the exact Sol 6.1 native model", () => {
    assert.equal(directProviderConfigError(config, "openai/gpt-6.1-sol", "high"), null);
    for (const model of ["openai/gpt-6-astra", "openai/gpt-6-sol", "openai/gpt-6.1-sol-other"]) {
      assert.notEqual(directProviderConfigError(config, model, "high"), null);
    }
    assert.notEqual(directProviderConfigError({ ...config, provider: "anthropic" }, "claude-opus-5-5", "high"), null);
    for (const effort of ["max", "xhigh", "HIGH", {}, null]) assert.notEqual(directProviderConfigError(config, "openai/gpt-6.1-sol", effort), null);
    assert.equal(SOL61_PILOT_NATIVE_BUDGET_USD, 2);
  });
  it("public input still ignores effort and max remains unauthorized for Sol 6.1", () => {
    assert.deepEqual(parseEvaluationReasoningEffort({ isSmoke: false, model: "openai/gpt-6.1-sol", value: "high" }), { ok: true });
    assert.equal(parseEvaluationReasoningEffort({ isSmoke: true, model: "openai/gpt-6.1-sol", value: "max" }).ok, false);
  });
  it("counts the same high input and checkpoints before the only generation", async () => {
    const o = opts(); let saves = 0;
    checkpoint = async () => { saves++; assert.equal(requests.length, 1); assert.equal(o.usage.direct_provider_attempts?.[0].effort, "high"); return true; };
    const result = await chat(o);
    assert.equal(result.ok, true); assert.equal(saves, 1); assert.equal(requests.length, 2);
    assert.deepEqual(requests[0].body.reasoning, { effort: "high", summary: "auto" });
    for (const key of ["model", "input", "tools", "tool_choice", "reasoning"]) assert.deepEqual(requests[0].body[key], requests[1].body[key]);
    assert.equal(requests[1].body.max_output_tokens, 16384); assert.equal(requests[1].body.service_tier, "default");
    assert.equal(result.direct_attempt?.effort_status, "matched"); assert.equal(result.direct_attempt?.effort_returned, "high");
    for (const value of [result.direct_attempt?.input_count_ms, result.direct_attempt?.checkpoint_ms]) {
      assert.equal(typeof value, "number"); assert.ok(Number.isFinite(value) && value! >= 0);
    }
    assert.ok(result.direct_attempt?.settled_upper_usd !== undefined);
    assert.equal(result.completion_tokens, 20); assert.equal(result.direct_attempt?.reasoning_tokens, 10);
    assert.ok(!JSON.stringify(logs).includes("PRIVATE"));
  });
  for (const effort of [undefined, "medium", "max", "PRIVATE_EFFORT", { private: "PRIVATE_EFFORT" }]) {
    it(`fails closed on unconfirmed high receipt ${typeof effort === "object" ? "object" : String(effort)}`, async () => {
      terminal.reasoning = effort === undefined ? {} : { effort };
      const result = await chat(opts());
      assert.equal(result.ok, false); assert.equal(result.content, ""); assert.deepEqual(result.tool_calls, []);
      assert.equal(requests.length, 2); assert.equal(result.direct_attempt?.outcome, "invalid_output");
      assert.equal(result.direct_attempt?.settled_upper_usd, undefined);
      assert.equal(result.direct_attempt?.effort_status, effort === undefined ? "not_reported" : "mismatch");
      assert.equal(result.direct_attempt?.effort_returned, effort === undefined ? null : effort === "medium" ? "medium" : "other");
      assert.ok(!JSON.stringify(logs).includes("PRIVATE"));
    });
  }
  it("preserves effort audit and billed usage on incomplete output", async () => {
    terminalType = "response.incomplete"; terminal.status = "incomplete";
    const result = await chat(opts());
    assert.equal(result.ok, false); assert.equal(result.direct_attempt?.effort_status, "matched");
    assert.equal(result.direct_attempt?.output_tokens, 20); assert.equal(result.direct_attempt?.outcome, "incomplete");
    assert.equal(requests.length, 2);
  });
  it("retains high across a serialized usage ledger", async () => {
    const first = opts(); assert.equal((await chat(first)).ok, true);
    const restored = JSON.parse(JSON.stringify(first.usage)) as UsageLedger;
    assert.equal((await chat(opts("high", restored))).ok, true);
    assert.equal(restored.direct_provider_attempts?.length, 2);
    assert.ok(restored.direct_provider_attempts?.every(a => a.effort === "high" && a.effort_status === "matched"));
  });
  for (const from of ["medium", "high"] as const) {
    it(`blocks restored ${from} history switching effort before any network`, async () => {
      terminal.reasoning = { effort: from }; const first = opts(from); assert.equal((await chat(first)).ok, true);
      requests.length = 0;
      const result = await chat(opts(from === "medium" ? "high" : "medium", JSON.parse(JSON.stringify(first.usage)) as UsageLedger));
      assert.equal(result.error, "direct_reasoning_effort_changed"); assert.equal(requests.length, 0);
    });
  }
  it("does not accept unconfirmed high history", async () => {
    const first = opts(); assert.equal((await chat(first)).ok, true);
    delete first.usage.direct_provider_attempts![0].effort_status; requests.length = 0;
    assert.equal((await chat(first)).error, "direct_reasoning_effort_unconfirmed"); assert.equal(requests.length, 0);
  });
  for (const returned of [undefined, "medium", "other"] as const) {
    it(`rejects inconsistent restored high receipt ${String(returned)}`, async () => {
      const first = opts(); assert.equal((await chat(first)).ok, true);
      first.usage.direct_provider_attempts![0].effort_returned = returned; requests.length = 0;
      assert.equal((await chat(first)).error, "direct_reasoning_effort_unconfirmed"); assert.equal(requests.length, 0);
    });
  }
  it("preserves medium missing-effort behavior and does not add high-only receipt fields", async () => {
    terminal.reasoning = {}; const result = await chat(opts("medium"));
    assert.equal(result.ok, true); assert.equal(result.direct_attempt?.effort, "medium");
    assert.equal(result.direct_attempt?.effort_status, undefined); assert.equal(result.direct_attempt?.effort_returned, undefined);
  });
  it("keeps the native cap and stops before generation", async () => {
    const first = opts(); assert.equal((await chat(first)).ok, true);
    const a = first.usage.direct_provider_attempts![0]; a.reserved_usd = 1.99; a.settled_upper_usd = 1.99;
    requests.length = 0; assert.equal((await chat(first)).error, "direct_native_budget_exhausted");
    assert.equal(requests.length, 1); assert.ok(requests[0].url.endsWith("/input_tokens"));
  });
  it("checkpoint failure dispatches no generation", async () => {
    checkpoint = async () => false; const result = await chat(opts());
    assert.equal(result.error, "direct_checkpoint_failed"); assert.equal(requests.length, 1);
  });
  it("retains the provider enablement gate before any network", async () => {
    enabled = ""; assert.equal((await chat(opts())).error, "direct_provider_pilot_disabled"); assert.equal(requests.length, 0);
  });
});
