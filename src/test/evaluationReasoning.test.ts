import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import * as m from "../../supabase/functions/legal-research-v2/shared/model";
import * as effort from "../../supabase/functions/legal-research-v2/shared/evaluationReasoning";

const SOL = "openai/gpt-6-sol";
const ASTRA = "openai/gpt-6-astra";
const originalFetch = globalThis.fetch;
const originalInfo = console.info;
const originalDeno = (globalThis as any).Deno;
let requests: Array<Record<string, unknown>>;
let logs: Array<Record<string, unknown>>;
const messages = [{ role: "user" as const, content: "synthetic prompt never logged" }];
function sse(returned?: unknown, terminal = "response.completed") {
  return new Response(`data: ${JSON.stringify({ type: terminal, response: {
    ...(returned === undefined ? {} : { reasoning: { effort: returned } }),
    usage: { input_tokens: 10, output_tokens: 5 },
  } })}\n\n`, { status: 200 });
}
function mockFetch(response: () => Response = () => sse("max")) {
  globalThis.fetch = async (_url, opts) => {
    requests.push(JSON.parse(String(opts?.body)));
    return response();
  };
}
beforeEach(() => {
  (globalThis as any).Deno = { env: { get: (key: string) => key === "LOVABLE_API_KEY" ? "synthetic-key-never-logged" : undefined } };
  requests = []; logs = [];
  console.info = (value: string) => { logs.push(JSON.parse(value)); };
  globalThis.fetch = async () => { throw new Error("Unmocked network is forbidden"); };
});
afterEach(() => { globalThis.fetch = originalFetch; console.info = originalInfo; (globalThis as any).Deno = originalDeno; });

describe("internal-only evaluation reasoning", () => {
  for (const value of ["max", "high", "garbage", null, 123, { effort: "max" }]) {
    it(`ignores public value ${JSON.stringify(value)}`, () => {
      assert.deepEqual(effort.parseEvaluationReasoningEffort({ isSmoke: false, model: ASTRA, value }), { ok: true });
    });
  }
  for (const value of [undefined, "medium", "high", "max"] as const) {
    it(`accepts internal Sol value ${value}`, () => {
      assert.deepEqual(effort.parseEvaluationReasoningEffort({ isSmoke: true, model: SOL, value }), { ok: true, effort: value });
    });
  }
  for (const value of [null, "", "MAX", "xhigh", "low", " max ", 0, {}, true]) {
    it(`rejects invalid internal value ${JSON.stringify(value)} explicitly`, () => {
      assert.deepEqual(effort.parseEvaluationReasoningEffort({ isSmoke: true, model: SOL, value }), { ok: false, error: "invalid_agent_reasoning_effort" });
    });
  }
  for (const model of [ASTRA, "google/gemini-3.7-flash", "openai/gpt-6-sol-fake", "gpt-6-sol", ""]) {
    it(`rejects max for ${model || "missing model"}`, async () => {
      assert.equal(effort.parseEvaluationReasoningEffort({ isSmoke: true, model, value: "max" }).ok, false);
      mockFetch();
      const result = await m.chat({ model, messages, reasoningEffort: "max" });
      assert.equal(result.ok, false); assert.equal(result.http_status, 400);
      assert.equal(result.error, "max_reasoning_requires_gpt_6_sol"); assert.equal(requests.length, 0);
    });
  }
  it("runtime rejects an invalid value without a fetch or fallback", async () => {
    mockFetch();
    const result = await m.chat({ model: SOL, messages, reasoningEffort: "invalid" as any });
    assert.equal(result.error, "invalid_agent_reasoning_effort"); assert.equal(requests.length, 0);
  });
});

describe("actual Responses request and effort audit", () => {
  it("sends exact max and preserves replay/tool transport", async () => {
    mockFetch(); const usage = m.newUsageLedger();
    const result = await m.chat({ model: SOL, messages, reasoningEffort: "max", replayReasoning: true,
      tools: [{ name: "test", description: "fixture", parameters: {} }], toolChoice: "required", usage,
      costStage: "v2_research_agent" });
    assert.equal(result.ok, true); assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].reasoning, { effort: "max", summary: "auto" });
    assert.equal(requests[0].model, SOL); assert.equal(requests[0].stream, true); assert.equal(requests[0].store, false);
    assert.deepEqual(requests[0].include, ["reasoning.encrypted_content"]); assert.equal(requests[0].tool_choice, "required");
    assert.equal(result.reasoning_effort_status, "matched"); assert.equal(result.reasoning_effort_returned, "max");
    assert.equal(usage.reasoning_max_requested_calls, 1); assert.equal(usage.reasoning_max_confirmed_calls, 1);
    assert.equal(logs.length, 2); assert.equal(logs[0].status, "requested");
    assert.ok(!JSON.stringify(logs).includes("synthetic"));
  });
  for (const model of [SOL, ASTRA]) for (const value of [undefined, "medium", "high"] as const) {
    it(`preserves ${model} ${value ?? "default medium"} wire request`, async () => {
      mockFetch(() => sse()); const usage = m.newUsageLedger();
      const result = await m.chat({ model, messages, reasoningEffort: value, usage });
      assert.equal(result.ok, true); assert.equal(requests.length, 1);
      assert.deepEqual(requests[0], { model, input: m.toResponsesInput(messages), stream: true, store: false,
        reasoning: { effort: value ?? "medium", summary: "auto" } });
      assert.equal(logs.length, 0); assert.equal(usage.reasoning_max_requested_calls, undefined);
    });
  }
  it("absence of provider effort remains explicitly unverified", async () => {
    mockFetch(() => sse()); const usage = m.newUsageLedger();
    const result = await m.chat({ model: SOL, messages, reasoningEffort: "max", usage });
    assert.equal(result.ok, true); assert.equal(result.reasoning_effort_status, "not_reported");
    assert.equal(result.reasoning_effort_returned, null); assert.equal(usage.reasoning_max_unreported_calls, 1);
    assert.equal(usage.reasoning_max_confirmed_calls, undefined);
  });
  for (const returned of ["medium", "high", "xhigh", "untrusted arbitrary content", { private: "content" }]) {
    it(`rejects provider downgrade/unrecognized effort ${JSON.stringify(returned)}`, async () => {
      mockFetch(() => sse(returned)); const usage = m.newUsageLedger();
      const result = await m.chat({ model: SOL, messages, reasoningEffort: "max", usage });
      assert.equal(result.ok, false); assert.equal(result.error, "reasoning_effort_mismatch");
      assert.equal(result.terminal, true); assert.deepEqual(result.tool_calls, []); assert.equal(result.content, "");
      assert.equal(requests.length, 1); assert.equal(usage.model_calls, 1); assert.equal(usage.completion_tokens, 5);
      assert.equal(usage.reasoning_max_mismatch_calls, 1);
      assert.ok(!JSON.stringify(logs).includes("arbitrary")); assert.ok(!JSON.stringify(logs).includes("private"));
    });
  }
  it("discards provider tool calls and text on reported mismatch", async () => {
    mockFetch(() => new Response([
      { type: "response.output_text.delta", delta: "must not publish" },
      { type: "response.output_item.done", item: { type: "function_call", call_id: "c1", name: "fetch", arguments: "{}" } },
      { type: "response.completed", response: { reasoning: { effort: "medium" }, usage: { input_tokens: 3, output_tokens: 2 } } },
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { status: 200 }));
    const result = await m.chat({ model: SOL, messages, reasoningEffort: "max" });
    assert.equal(result.ok, false); assert.equal(result.content, ""); assert.deepEqual(result.tool_calls, []);
  });
  it("incomplete max response remains failed and retains effort audit", async () => {
    mockFetch(() => sse("max", "response.incomplete")); const usage = m.newUsageLedger();
    const result = await m.chat({ model: SOL, messages, reasoningEffort: "max", usage });
    assert.equal(result.ok, false); assert.equal(result.reasoning_effort_status, "matched");
    assert.equal(usage.reasoning_max_confirmed_calls, 1); assert.equal(usage.model_calls, 1);
  });
  it("EOF without terminal event never reports experiment success", async () => {
    mockFetch(() => new Response('data: {"type":"response.output_text.delta","delta":"partial"}\n\n'));
    const usage = m.newUsageLedger(); const result = await m.chat({ model: SOL, messages, reasoningEffort: "max", usage });
    assert.equal(result.ok, false); assert.equal(result.content, ""); assert.equal(usage.reasoning_max_unreported_calls, 1);
  });
  it("HTTP rejection makes one max request and never retries medium", async () => {
    mockFetch(() => new Response("unsupported reasoning effort", { status: 400 })); const usage = m.newUsageLedger();
    const result = await m.chat({ model: SOL, messages, reasoningEffort: "max", usage });
    assert.equal(result.ok, false); assert.equal(result.http_status, 400); assert.equal(result.terminal, true);
    assert.equal(requests.length, 1); assert.equal((requests[0].reasoning as any).effort, "max");
    assert.equal(usage.reasoning_max_requested_calls, 1); assert.equal(usage.reasoning_max_unreported_calls, 1);
  });
  it("network failure is accounted without a fallback", async () => {
    mockFetch(() => { throw new Error("synthetic network failure"); }); const usage = m.newUsageLedger();
    const result = await m.chat({ model: SOL, messages, reasoningEffort: "max", usage });
    assert.equal(result.ok, false); assert.equal(requests.length, 1);
    assert.equal(usage.reasoning_max_unreported_calls, 1); assert.equal(logs.at(-1)?.status, "network_error");
  });
  it("counters survive serialized usage and continue over rejected-repair attempts", async () => {
    mockFetch(); const usage = m.newUsageLedger();
    await m.chat({ model: SOL, messages, reasoningEffort: "max", usage });
    const resumed = JSON.parse(JSON.stringify(usage));
    await m.chat({ model: SOL, messages, reasoningEffort: "max", usage: resumed });
    mockFetch(() => sse("medium"));
    await m.chat({ model: SOL, messages, reasoningEffort: "max", usage: resumed });
    assert.equal(resumed.reasoning_max_requested_calls, 3); assert.equal(resumed.reasoning_max_confirmed_calls, 2);
    assert.equal(resumed.reasoning_max_mismatch_calls, 1); assert.equal(resumed.model_calls, 3);
  });
});
