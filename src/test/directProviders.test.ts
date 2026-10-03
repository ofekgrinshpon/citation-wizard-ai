import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import * as m from "../../supabase/functions/legal-research-v2/shared/model.ts";
import * as policy from "../../supabase/functions/legal-research-v2/shared/directProviderPolicy.ts";
import * as direct from "../../supabase/functions/legal-research-v2/shared/directProviders.ts";
import * as usage from "../../supabase/functions/legal-research-v2/shared/directProviderUsage.ts";

type FixtureEvent = Record<string, unknown>;
interface WireBody {
  [key: string]: unknown;
  model?: string;
  max_tokens?: number;
  system?: Array<{ cache_control?: { ttl?: string } }>;
  tools?: Array<{ input_schema?: unknown }>;
  tool_choice?: { type?: string; name?: string } | string;
  messages?: Array<{ content: Array<Record<string, unknown>> }>;
  input?: Array<Record<string, unknown>>;
}
type ChatOptions = Parameters<typeof m.chat>[0];
// Malformed history fixtures are deliberately cast only at the transport boundary.
type Overrides = Partial<Omit<ChatOptions, "messages">> & { messages?: unknown };
const globals = globalThis as typeof globalThis & { Deno?: { env: { get(key: string): string | undefined } } };
const oldFetch = globalThis.fetch, oldDeno = globals.Deno, oldInfo = console.info;
const oldCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");
const requests: Array<{ url: string; body: WireBody; headers?: unknown }> = [];
const logs: Array<Record<string, unknown>> = [];
const keysRead: string[] = [];
let enabled = "anthropic", missingKey = false;
const messages = [{ role: "system" as const, content: "Synthetic system never logged" }, { role: "user" as const, content: "Synthetic Hebrew שאלה never logged" }];
const tools = [{ name: "submit_research_memo", description: "Synthetic memo tool", parameters: {
  type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false,
} }, { name: "fetch", description: "Synthetic fetch", parameters: { type: "object", properties: {}, additionalProperties: false } }];
const config = (provider = "anthropic") => ({ provider: provider as "anthropic" | "openai", max_output_tokens: 16384 });
const opts = (overrides: Overrides = {}): ChatOptions & { usage: m.UsageLedger } => ({
  model: enabled === "anthropic" ? "claude-opus-5-5" : "openai/gpt-6-astra",
  tools, beforeDirectDispatch: async () => true, directProvider: config(enabled), ...overrides,
  messages: overrides.messages === undefined ? structuredClone(messages) : overrides.messages as m.ChatMessage[],
  usage: overrides.usage ?? m.newUsageLedger(),
});
const aUsage = { input_tokens: 20, output_tokens: 30, cache_creation_input_tokens: 40, cache_read_input_tokens: 100,
  cache_creation: { ephemeral_5m_input_tokens: 40, ephemeral_1h_input_tokens: 0 }, service_tier: "standard" };
function aEvents(blocks: FixtureEvent[] = [{ type: "thinking", thinking: "", signature: "opaque-signed-not-logged" },
  { type: "tool_use", id: "toolu_1", name: "submit_research_memo", input: { answer: "Synthetic secret memo" } }], stop = "tool_use", u: FixtureEvent = aUsage): FixtureEvent[] {
  return [{ type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], usage: u } },
    ...blocks.flatMap((b, index) => [{ type: "content_block_start", index, content_block: b }, { type: "content_block_stop", index }]),
    { type: "message_delta", delta: { stop_reason: stop }, usage: { output_tokens: u.output_tokens } }, { type: "message_stop" }];
}
const oUsage = { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 30, cache_write_tokens: 20 }, output_tokens_details: { reasoning_tokens: 15 } };
function oEvents(overrides: FixtureEvent = {}): FixtureEvent[] { return [{ type: "response.completed", response: { id: "resp_1", model: "gpt-6-astra", status: "completed", usage: oUsage,
  reasoning: { effort: "medium" }, service_tier: "default", output: [
    { type: "reasoning", id: "rs_1", encrypted_content: "opaque-encrypted-not-logged", summary: [{ type: "summary_text", text: "must not retain plaintext" }] },
    { type: "function_call", id: "fc_1", call_id: "call_1", name: "submit_research_memo", arguments: '{"answer":"memo"}' },
  ], ...overrides } }]; }
function response(events: FixtureEvent[], split = false, crlf = false) {
  const str = events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("").replace(/\n/g, crlf ? "\r\n" : "\n");
  const bytes = new TextEncoder().encode(str);
  return new Response(new ReadableStream({ start(c) { if (split) { for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7)); }
    else c.enqueue(bytes); c.close(); } }), { status: 200, headers: { "request-id": "req_1", "x-request-id": "req_2" } });
}
function mock(events: FixtureEvent[] = aEvents(), split = false, crlf = false) {
  globalThis.fetch = async (url, request) => { requests.push({ url: String(url), body: JSON.parse(String(request!.body)), headers: request!.headers }); return response(events, split, crlf); };
}
beforeEach(() => {
  requests.length = 0; logs.length = 0; keysRead.length = 0; enabled = "anthropic"; missingKey = false;
  // Keep the repository's jsdom setup; polyfill only this test's Web Crypto.
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
  globals.Deno = { env: { get: (name: string) => {
    keysRead.push(name); if (name === "V2_DIRECT_PROVIDER_PILOT") return enabled;
    if (name.endsWith("_API_KEY")) return missingKey ? undefined : "synthetic-key-never-logged";
    return undefined;
  } } };
  console.info = (value: string) => logs.push(JSON.parse(value));
  globalThis.fetch = async () => { throw new Error("Unmocked network is forbidden"); };
});
afterEach(() => {
  globalThis.fetch = oldFetch; globals.Deno = oldDeno; console.info = oldInfo;
  if (oldCrypto) Object.defineProperty(globalThis, "crypto", oldCrypto);
  else Reflect.deleteProperty(globalThis, "crypto");
});

describe("authenticated pilot isolation", () => {
  for (const provider of ["anthropic", "openai", "lovable_gateway", "hostile", null, {}, 1, undefined]) {
    it(`ignores public provider ${JSON.stringify(provider)}`, () => assert.deepEqual(policy.parseDirectProvider({ isSmoke: false, provider, model: "bad", maxOutputTokens: 0 }), { ok: true }));
  }
  it("pins internal providers and requires an explicit output limit", () => {
    assert.equal(policy.parseDirectProvider({ isSmoke: true, provider: "anthropic", model: undefined, maxOutputTokens: undefined }).ok, false);
    assert.deepEqual(policy.parseDirectProvider({ isSmoke: true, provider: "anthropic", model: undefined, maxOutputTokens: 16384 }),
      { ok: true, config: config(), model: "claude-opus-5-5" });
    assert.equal(policy.parseDirectProvider({ isSmoke: true, provider: "anthropic", model: "openai/gpt-6-astra", maxOutputTokens: 16384 }).ok, false);
  });
  it("disabled route stops before key lookup or HTTP", async () => { enabled = "off"; mock(); const result = await m.chat(opts({ model: "claude-opus-5-5", directProvider: config() }));
    assert.equal(result.error, "direct_provider_pilot_disabled"); assert.equal(requests.length, 0); assert(!keysRead.some(k => k.endsWith("API_KEY"))); });
  it("missing direct key never reads Lovable key or retries gateway", async () => { missingKey = true; mock(); const result = await m.chat(opts());
    assert.equal(result.error, "direct_provider_key_missing"); assert.equal(requests.length, 0); assert(!keysRead.includes("LOVABLE_API_KEY")); });
  it("requires medium effort without downgrading incompatible request", async () => { mock(); const result = await m.chat(opts({ reasoningEffort: "high" }));
    assert.equal(result.error, "direct_pilot_requires_medium_effort"); assert.equal(requests.length, 0); });
  it("checkpoints a pending attempt before dispatch and blocks uncertain replay", async () => {
    let saved = m.newUsageLedger(); mock(); const opt = opts();
    opt.beforeDirectDispatch = async () => { assert.equal(requests.length, 0); saved = JSON.parse(JSON.stringify(opt.usage)); return true; };
    assert.equal((await m.chat(opt)).ok, true); assert.equal(saved.direct_provider_attempts[0].outcome, "pending");
    const before = requests.length; const r = await m.chat(opts({ usage: saved })); assert.equal(r.error, "direct_attempt_reconciliation_required"); assert.equal(requests.length, before);
  });
  it("missing or failed checkpoint cannot trigger a paid attempt", async () => {
    mock(); assert.equal((await m.chat(opts({ beforeDirectDispatch: undefined }))).error, "direct_checkpoint_required");
    const opt = opts({ beforeDirectDispatch: async () => false }); assert.equal((await m.chat(opt)).error, "direct_checkpoint_failed");
    assert.equal(requests.length, 0); assert.equal(opt.usage.model_calls, 0); assert.equal(opt.usage.direct_provider_attempts![0].outcome, "not_sent");
  });
  it("failed pilot cannot be resumed into another paid call", async () => {
    mock(); const ledger = m.newUsageLedger(); ledger.direct_provider_failed = true;
    assert.equal((await m.chat(opts({ usage: ledger }))).error, "direct_pilot_already_failed"); assert.equal(requests.length, 0);
  });
  it("caller abort during native streaming stays unknown and never executes partial tools", async () => {
    const controller = new AbortController();
    globalThis.fetch = async () => new Response(new ReadableStream({ start(c) {
      c.enqueue(new TextEncoder().encode('data: '+JSON.stringify(aEvents()[0])+'\n\n'));
      queueMicrotask(() => controller.abort());
    } }));
    const opt = opts({ signal: controller.signal }); const r = await m.chat(opt);
    assert.equal(r.error, "direct_aborted"); assert.deepEqual(r.tool_calls, []); assert.equal(opt.usage.direct_provider_attempts![0].outcome, "aborted_unknown");
  });
  it("public default stays Astra on Lovable Responses", async () => { mock(oEvents()); const result = await m.chat({ model: m.DEFAULT_AGENT_MODEL, messages });
    assert.equal(result.ok, true); assert.equal(requests[0].url, "https://ai.gateway.lovable.dev/v1/responses"); assert.equal(requests[0].body.model, "openai/gpt-6-astra"); });
  it("research checkpoint cannot silently fall back while verifier can keep its route", async () => {
    mock(); const ledger = m.newUsageLedger(); await m.chat(opts({ usage: ledger }));
    const blocked = await m.chat({ model: "openai/gpt-6-astra", messages, usage: ledger, costStage: "v2_research_agent" });
    assert.equal(blocked.error, "direct_provider_route_missing"); assert.equal(requests.length, 1);
    globalThis.fetch = async (url, request) => { requests.push({ url: String(url), body: JSON.parse(String(request!.body)), headers: request!.headers }); return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }], usage: {} })); };
    assert.equal((await m.chat({ model: "google/gemini-3.7-flash", messages, usage: ledger, costStage: "v2_support_verifier" })).ok, true);
    assert.equal(requests.at(-1)!.url, "https://ai.gateway.lovable.dev/v1/chat/completions");
  });
});

describe("native Anthropic Messages", () => {
  it("uses native wire, adaptive medium, explicit cache prefix, auto tool choice, native usage", async () => {
    mock(); const opt = opts({ toolChoice: { name: "submit_research_memo" } }); const result = await m.chat(opt);
    assert.equal(result.ok, true); assert.equal(requests[0].url, "https://api.anthropic.com/v1/messages");
    const body = requests[0].body; assert.equal(body.model, "claude-opus-5-5"); assert.equal(body.max_tokens, 16384);
    assert.deepEqual(body.thinking, { type: "adaptive" }); assert.deepEqual(body.output_config, { effort: "medium" }); assert.deepEqual(body.tool_choice, { type: "auto" });
    assert.equal(body.system[0].cache_control.ttl, "5m"); assert.deepEqual(body.tools[0].input_schema, tools[0].parameters);
    assert(!("reasoning" in body)); assert(!("store" in body)); assert(!("fallbacks" in body));
    assert.equal(result.native_replay!.blocks[0].signature, "opaque-signed-not-logged");
    assert.equal(result.prompt_tokens, 160); assert.equal(result.completion_tokens, 30); assert.equal(opt.usage.model_calls, 1);
    assert.equal(opt.usage.direct_provider_attempts![0].estimated_usd, .0009);
    assert.equal(opt.usage.direct_provider_attempts![0].provider_request_id, "req_1");
    assert(!JSON.stringify(logs).includes("Synthetic")); assert(!JSON.stringify(logs).includes("opaque-")); assert(!JSON.stringify(logs).includes("synthetic-key"));
  });
  it("preserves signed thinking, parallel IDs, tool results, and order across checkpoint JSON", async () => {
    const events = aEvents([{ type: "thinking", thinking: "", signature: "sig" }, { type: "tool_use", id: "toolu_a", name: "fetch", input: {} },
      { type: "tool_use", id: "toolu_b", name: "fetch", input: {} }]); mock(events, true, true);
    const first = await m.chat(opts()); assert.equal(first.ok, true);
    const history = JSON.parse(JSON.stringify([...messages, { role: "assistant", content: first.content, native_replay: first.native_replay,
      tool_calls: first.tool_calls.map(c => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })) },
      { role: "tool", tool_call_id: "toolu_a", content: "A" }, { role: "tool", tool_call_id: "toolu_b", content: "B" }, { role: "user", content: "new rolling state" }]));
    mock(); const second = await m.chat(opts({ messages: history })); assert.equal(second.ok, true);
    const wire = requests.at(-1)!.body.messages;
    assert.deepEqual(wire[1].content, first.native_replay!.blocks); assert.deepEqual(wire[2].content.map((x: Record<string, unknown>) => x.type), ["tool_result", "tool_result", "text"]);
    assert.deepEqual(wire[2].content.slice(0, 2).map((x: Record<string, unknown>) => x.tool_use_id), ["toolu_a", "toolu_b"]);
    history[1].content = "rewritten prefix"; const before = requests.length; const broken = await m.chat(opts({ messages: history }));
    assert.equal(broken.error, "direct_replay_prefix_changed"); assert.equal(requests.length, before);
  });
  it("assembles native JSON, text, and signature deltas", async () => {
    mock([{ type: "message_start", message: { model: "claude-opus-5-5", usage: aUsage } },
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "opaque-sig" } }, { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "שלום" } }, { type: "content_block_stop", index: 1 },
      { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "toolu_1", name: "submit_research_memo", input: {} } },
      { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"answer":' } },
      { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '"שלום"}' } }, { type: "content_block_stop", index: 2 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 30 } }, { type: "message_stop" }], true);
    const result = await m.chat(opts()); assert.equal(result.ok, true); assert.equal(result.content, "שלום"); assert.equal(result.tool_calls[0].arguments, '{"answer":"שלום"}');
  });
  for (const stop of ["max_tokens", "refusal", "pause_turn", "stop_sequence"]) it(`fails closed on ${stop}, retains billed usage`, async () => {
    mock(aEvents(undefined, stop)); const opt = opts(); const r = await m.chat(opt); assert.equal(r.ok, false); assert.deepEqual(r.tool_calls, []); assert.equal(r.content, "");
    assert.equal(opt.usage.prompt_tokens, 160); assert.equal(opt.usage.direct_provider_attempts![0].output_tokens, 30); assert.equal(requests.length, 1);
  });
  it("no memo at forced boundary fails without nudging or extra call", async () => {
    mock(aEvents([{ type: "text", text: "I will continue" }], "end_turn")); const r = await m.chat(opts({ toolChoice: { name: "submit_research_memo" } }));
    assert.equal(r.error, "direct_required_memo_missing"); assert.equal(r.content, ""); assert.equal(requests.length, 1);
  });
  it("rejects invalid memo schema and disallowed research tool before execution", async () => {
    for (const [name, input] of [["submit_research_memo", {}], ["fetch", {}]]) {
      mock(aEvents([{ type: "tool_use", id: "t1", name, input }])); const r = await m.chat(opts({ toolChoice: { name: "submit_research_memo" } })); assert.equal(r.ok, false); assert.deepEqual(r.tool_calls, []);
    }
  });
  it("incomplete stream never exposes executable calls or falsely records zero cost", async () => {
    mock(aEvents().slice(0, -1)); const opt = opts(); const r = await m.chat(opt); assert.equal(r.error, "direct_eof_without_terminal"); assert.deepEqual(r.tool_calls, []);
    assert.equal(opt.usage.direct_provider_attempts![0].estimated_usd, null); assert.equal(opt.usage.direct_provider_attempts![0].usage_complete, false);
  });
  it("provisional Anthropic message_start output is not terminal usage", async () => {
    const events = aEvents(); events[events.length - 2].usage = {};
    mock(events); const opt = opts(); const r = await m.chat(opt);
    assert.equal(r.error, "direct_usage_missing"); assert.equal(opt.usage.direct_provider_attempts![0].output_tokens, null);
    assert.equal(opt.usage.direct_provider_attempts![0].estimated_usd, null);
  });
  it("HTTP errors never return raw body or retry", async () => {
    globalThis.fetch = async () => { requests.push({ url: "mock", body: {}, headers: {} }); return new Response("secret prompt in error", { status: 429 }); };
    const opt = opts(); const r = await m.chat(opt); assert.equal(r.error, "direct_http_error"); assert.equal(r.terminal, true); assert.equal(requests.length, 1);
    assert(!JSON.stringify(logs).includes("secret prompt")); assert.equal(opt.usage.direct_provider_attempts![0].estimated_usd, null);
  });
  it("network errors are uncertain, not free or retried", async () => {
    globalThis.fetch = async () => { requests.push({ url: "mock", body: {}, headers: {} }); throw new Error("secret raw network error"); };
    const opt = opts(); const r = await m.chat(opt); assert.equal(r.ok, false); assert.equal(opt.usage.direct_provider_attempts![0].outcome, "network_unknown");
    assert.equal(requests.length, 1); assert(!JSON.stringify(logs).includes("secret raw"));
  });
  it("rejects oversized request and already-aborted caller before dispatch", async () => {
    mock(); const r = await m.chat(opts({ messages: [{ role: "user", content: "a".repeat(4_000_001) }] })); assert.equal(r.error, "direct_request_limit");
    const c = new AbortController(); c.abort(); assert.equal((await m.chat(opts({ signal: c.signal }))).error, "direct_aborted_before_dispatch"); assert.equal(requests.length, 0);
  });
  it("rejects orphan/missing/duplicate IDs without paid dispatch", async () => {
    mock(); const assistant = { role: "assistant", content: "", tool_calls: [{ id: "a", type: "function", function: { name: "fetch", arguments: "{}" } }] };
    for (const history of [[...messages, { role: "tool", content: "orphan", tool_call_id: "b" }], [...messages, assistant],
      [...messages, { ...assistant, tool_calls: [...assistant.tool_calls, ...assistant.tool_calls] }]]) {
      assert.equal((await m.chat(opts({ messages: history }))).ok, false);
    } assert.equal(requests.length, 0);
  });
  it("rejects foreign reasoning and unreported required usage", async () => {
    mock(); const bad = await m.chat(opts({ messages: [...messages, { role: "assistant", content: "", reasoning_items: [{ type: "reasoning", encrypted_content: "enc" }] }, { role: "user", content: "continue" }] }));
    assert.equal(bad.error, "direct_cross_provider_replay"); assert.equal(requests.length, 0);
    mock(aEvents(undefined, "tool_use", {})); assert.equal((await m.chat(opts())).error, "direct_usage_missing");
  });
});

describe("native OpenAI Responses", () => {
  it("uses direct endpoint and native model with unchanged medium/tool/replay semantics", async () => {
    enabled = "openai"; mock(oEvents()); const opt = opts({ toolChoice: { name: "submit_research_memo" } }); const r = await m.chat(opt);
    assert.equal(r.ok, true); assert.equal(requests[0].url, "https://api.openai.com/v1/responses"); assert.equal(requests[0].body.model, "gpt-6-astra");
    assert.deepEqual(requests[0].body.reasoning, { effort: "medium", summary: "auto" }); assert.equal(requests[0].body.store, false);
    assert.deepEqual(requests[0].body.include, ["reasoning.encrypted_content"]); assert.equal((requests[0].body.tool_choice as { name: string }).name, "submit_research_memo");
    assert(!keysRead.includes("LOVABLE_API_KEY")); assert.equal(r.reasoning_items![0].id, "rs_1"); assert(!JSON.stringify(r.reasoning_items).includes("plaintext"));
    assert.equal(opt.usage.direct_provider_attempts![0].estimated_usd, .00178); assert.equal(opt.usage.direct_provider_attempts![0].cache_write_input_tokens, 20);
    const input = m.toResponsesInput([{ role: "assistant", content: "", reasoning_items: r.reasoning_items, replay_seq: r.replay_seq,
      tool_calls: r.tool_calls.map(c => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })) }, { role: "tool", content: "done", tool_call_id: "call_1" }], true);
    assert.deepEqual(input.map(x => x.type), ["reasoning", "function_call", "function_call_output"]); assert.equal(input[2].call_id, "call_1");
  });
  for (const terminal of ["response.incomplete", "response.failed"]) it(`rejects ${terminal} without partial tools`, async () => {
    enabled = "openai"; const events = oEvents(); events[0].type = terminal; mock(events); const r = await m.chat(opts()); assert.equal(r.ok, false); assert.deepEqual(r.tool_calls, []); assert.equal(r.prompt_tokens, 100);
  });
  it("rejects model/effort mismatch and unsupported output blocks", async () => {
    enabled = "openai";
    for (const extra of [{ model: "gpt-6-sol" }, { reasoning: { effort: "high" } }, { output: [{ type: "web_search_call", id: "servertool" }] }]) {
      mock(oEvents(extra)); const r = await m.chat(opts()); assert.equal(r.ok, false); assert.deepEqual(r.tool_calls, []);
    }
  });
  it("rejects corrupted reasoning replay rather than silently omitting it", async () => {
    enabled = "openai"; mock(oEvents());
    const history = [...messages, { role: "assistant", content: "", reasoning_items: [{ type: "reasoning", id: "rs_1", encrypted_content: "opaque" }], replay_seq: ["r"],
      tool_calls: [{ id: "call_old", type: "function", function: { name: "fetch", arguments: "{}" } }] }, { role: "tool", tool_call_id: "call_old", content: "result" }];
    const r = await m.chat(opts({ messages: history })); assert.equal(r.error, "direct_invalid_reasoning_replay"); assert.equal(requests.length, 0);
  });
  it("preserves native output order even when no reasoning block was returned", async () => {
    enabled = "openai"; mock(oEvents({ output: [
      { type: "function_call", call_id: "call_1", name: "fetch", arguments: "{}" },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "progress" }] },
    ] }));
    const first = await m.chat(opts()); assert.equal(first.ok, true);
    const history = [...messages, { role: "assistant", content: first.content, reasoning_items: first.reasoning_items, replay_seq: first.replay_seq,
      tool_calls: first.tool_calls.map(c => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })) },
      { role: "tool", tool_call_id: "call_1", content: "result" }];
    mock(oEvents()); const second = await m.chat(opts({ messages: history })); assert.equal(second.ok, true);
    assert.deepEqual(requests.at(-1)!.body.input.slice(2).map((x: Record<string, unknown>) => x.type ?? x.role), ["function_call", "assistant", "function_call_output"]);
  });
  it("does not serialize native Anthropic blocks into Responses", async () => {
    enabled = "openai"; mock(oEvents()); const r = await m.chat(opts({ messages: [...messages, { role: "assistant", content: "", native_replay: { provider: "anthropic", model: "claude-opus-5-5", blocks: [], prefix_hash: "secret" } }] }));
    assert.equal(r.error, "direct_cross_provider_replay"); assert.equal(requests.length, 0);
  });
});

describe("provider-native list-price accounting", () => {
  it("counts Anthropic cache writes separately including 1h and output thinking once", () => {
    const u = usage.nativeUsage("anthropic", { ...aUsage, cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 30 } });
    assert.equal(u.input_tokens, 160); assert.equal(u.estimated_usd, .00099); assert.equal(u.reasoning_tokens, null);
  });
  it("never fabricates missing cache fields or invalid counts", () => {
    for (const raw of [{ input_tokens: 100, output_tokens: 20 }, { ...oUsage, input_tokens: -1 }, { ...oUsage, input_tokens: "100" },
      { ...oUsage, input_tokens_details: { cached_tokens: 120, cache_write_tokens: 20 } }]) assert.equal(usage.nativeUsage("openai", raw).estimated_usd, null);
    assert.equal(usage.nativeUsage("anthropic", { ...aUsage, cache_creation: undefined }).estimated_usd, null);
  });
  it("applies Astra long-context multiplier to full request", () => {
    const u = usage.nativeUsage("openai", { input_tokens: 300000, output_tokens: 1000, input_tokens_details: { cached_tokens: 100000, cache_write_tokens: 50000 } });
    assert.equal(u.estimated_usd, 4.525);
  });
  it("unknown service tier does not get an invented standard bill", () => {
    assert.equal(usage.nativeUsage("anthropic", { ...aUsage, service_tier: "priority" }).estimated_usd, null);
    assert.equal(usage.nativeUsage("openai", { ...oUsage, service_tier: "flex" }).estimated_usd, null);
  });
});


describe("single approved pilot identity", () => {
  const id = "12345678-1234-4234-8234-123456789abc";
  it("accepts only the exact server-approved UUID", () => {
    assert.equal(policy.directPilotRunError(id, id), null);
  });
  for (const value of [undefined, null, "", "r", 1, {}, "12345678-1234-4234-8234-123456789abd"]) {
    it(`rejects unapproved pilot identity ${JSON.stringify(value)}`, () => {
      assert.equal(policy.directPilotRunError(value, id), "direct_pilot_run_not_approved");
      assert.equal(policy.directPilotRunError(id, value), "direct_pilot_run_not_approved");
    });
  }
  it("recognizes even malformed pilot markers for recovery exclusion", () => {
    for (const marker of [null, false, {}, { provider: "anthropic" }]) {
      assert.equal(policy.isDirectPilotState({ intake: { agent_direct_provider: marker } }), true);
    }
    for (const state of [null, {}, { intake: {} }, { intake: null }]) assert.equal(policy.isDirectPilotState(state), false);
  });
  it("requires a persisted pause generation for pilot claims", () => {
    assert.equal(policy.directPilotPauseId({ direct_pause_id: "pause-1" }), "pause-1");
    for (const state of [null, {}, { direct_pause_id: "" }, { direct_pause_id: 12 }]) assert.equal(policy.directPilotPauseId(state), null);
  });
});

function jsonbKeyOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonbKeyOrder);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => [key, jsonbKeyOrder(item)]));
}
const jsonbTools = [{ name: "fetch", description: "Synthetic nested arguments", parameters: {
  type: "object", properties: { scope: { type: "string" }, query: { type: "string" }, filters: { type: "object" } },
  required: ["scope", "query", "filters"], additionalProperties: false,
} }];
async function eightTurnCheckpoint() {
  let checkpoint: { messages: m.ChatMessage[]; usage: m.UsageLedger } = { messages: structuredClone(messages), usage: m.newUsageLedger() };
  for (let i = 0; i < 8; i++) {
    const blocks: FixtureEvent[] = [{ type: "thinking", thinking: "", signature: `opaque-${i}` },
      { type: "tool_use", id: `toolu_roundtrip_${i}`, name: "fetch", input: {
        scope: "official", query: "fixture", filters: { kinds: ["first", "second"], nested: { zebra: 1, a: "1" } },
      } }];
    mock(aEvents(blocks));
    const result = await m.chat(opts({ ...checkpoint, tools: jsonbTools, allowedToolNames: ["fetch"] }));
    assert.equal(result.ok, true);
    checkpoint.messages.push({ role: "assistant", content: result.content,
      tool_calls: result.tool_calls.map(c => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })),
      native_replay: result.native_replay });
    checkpoint.messages.push({ role: "tool", tool_call_id: result.tool_calls[0].id, content: `Synthetic result ${i}` });
    if (i === 3) checkpoint = jsonbKeyOrder(JSON.parse(JSON.stringify(checkpoint))) as typeof checkpoint;
  }
  return jsonbKeyOrder(JSON.parse(JSON.stringify(checkpoint))) as typeof checkpoint;
}
function checkpointBody(checkpoint: { messages: m.ChatMessage[]; usage: m.UsageLedger }) {
  return direct.anthropicBody({ ...checkpoint, config: config(), model: "claude-opus-5-5", tools: jsonbTools,
    responsesInput: m.toResponsesInput });
}
describe("JSONB-safe native replay", () => {
  for (const [label, invalid] of [["undefined", undefined], ["NaN", NaN], ["infinity", Infinity],
    ["non-JSON object", new Date(0)], ["sparse array", new Array(1)]] as const) {
    it(`rejects invalid canonical JSON: ${label}`, async () => {
      await assert.rejects(() => direct.anthropicBody({ config: config(), model: "claude-opus-5-5", messages,
        tools: [{ name: "fixture", description: "fixture", parameters: { invalid } }], responsesInput: m.toResponsesInput }),
      /direct_invalid_json/);
      assert.equal(requests.length, 0);
    });
  }
  it("keeps eight turns and both argument and prefix checks across whole-checkpoint key reordering", async () => {
    const checkpoint = await eightTurnCheckpoint();
    await checkpointBody(checkpoint);
    assert.equal(checkpoint.usage.direct_provider_attempts?.length, 8);
    assert.equal(checkpoint.messages.filter(message => message.native_replay).length, 8);
    assert.equal(requests.length, 8);
  });
  const mutations: Array<{ name: string; change: (history: m.ChatMessage[]) => void }> = [
    { name: "user text", change: h => { h[1].content += " changed"; } },
    { name: "tool result text", change: h => { h[3].content += " changed"; } },
    { name: "argument value", change: h => { h[2].tool_calls![0].function.arguments = '{"scope":"changed"}'; } },
    { name: "invalid argument JSON", change: h => { h[2].tool_calls![0].function.arguments = "{"; } },
    { name: "tool name", change: h => { h[2].tool_calls![0].function.name = "changed"; } },
    { name: "tool identity", change: h => { h[2].tool_calls![0].id = "changed"; h[3].tool_call_id = "changed"; } },
    { name: "model identity", change: h => { h[2].native_replay!.model = "changed" as typeof policy.DIRECT_MODELS.anthropic; } },
    { name: "thinking signature", change: h => { h[2].native_replay!.blocks[0].signature = "changed"; } },
    { name: "native block order", change: h => { h[2].native_replay!.blocks.reverse(); } },
    { name: "nested array order", change: h => {
      const args = JSON.parse(h[2].tool_calls![0].function.arguments) as { filters: { kinds: string[] } };
      args.filters.kinds.reverse(); h[2].tool_calls![0].function.arguments = JSON.stringify(args);
    } },
  ];
  for (const { name, change } of mutations) it(`still rejects actual ${name} mutation`, async () => {
    const checkpoint = await eightTurnCheckpoint(); change(checkpoint.messages);
    await assert.rejects(() => checkpointBody(checkpoint), /direct_/);
    assert.equal(requests.length, 8, "mutation validation must not dispatch another request");
  });
});


describe("Sol 6.1 isolated native budget", () => {
  const solOpts = (overrides: Overrides = {}) => opts({ model: "openai/gpt-6.1-sol", ...overrides });
  const solMock = (count: unknown = 100, events = oEvents({ model: "gpt-6.1-sol" })) => {
    enabled = "openai";
    globalThis.fetch = async (url, request) => {
      const body = JSON.parse(String(request!.body));
      requests.push({ url: String(url), body, headers: request!.headers });
      if (String(url).endsWith("/input_tokens")) return Response.json({ object: "response.input_tokens", input_tokens: count });
      return response(events);
    };
  };
  it("allowlists 6.1 without changing either default", () => {
    assert.equal(policy.directProviderConfigError(config("openai"), "openai/gpt-6.1-sol", "medium"), null);
    assert.equal(policy.DIRECT_MODELS.openai, "openai/gpt-6-astra");
    assert.equal(m.DEFAULT_AGENT_MODEL, "openai/gpt-6-astra");
    assert.equal(policy.directProviderConfigError(config("openai"), "openai/unknown", "medium"), "direct_provider_model_mismatch");
  });
  it("counts exact input-affecting fields before durable reservation then generation", async () => {
    solMock(); const o = solOpts(); let saved = m.newUsageLedger();
    o.beforeDirectDispatch = async () => { assert.equal(requests.length, 1); saved = structuredClone(o.usage); return true; };
    const r = await m.chat(o);
    assert.equal(r.ok, true); assert.equal(requests.length, 2);
    assert.equal(requests[0].url, "https://api.openai.com/v1/responses/input_tokens");
    assert.equal(requests[1].url, "https://api.openai.com/v1/responses");
    for (const key of ["model", "input", "tools", "tool_choice", "reasoning"]) assert.deepEqual(requests[0].body[key], requests[1].body[key]);
    for (const key of ["stream", "store", "max_output_tokens", "include", "service_tier"]) assert.equal(requests[0].body[key], undefined);
    assert.equal(requests[1].body.model, "gpt-6.1-sol");
    assert.equal(requests[1].body.max_output_tokens, 16384);
    assert.equal(saved!.direct_provider_attempts![0].outcome, "pending");
    assert.equal(saved!.direct_provider_attempts![0].reserved_usd, 0.180499);
    assert.equal(r.direct_attempt!.settled_upper_usd, 0.000495);
    assert.equal(r.direct_attempt!.estimated_usd, 0.000353);
    assert.equal(r.direct_attempt!.price_version, "sol61-standard-2026-10-03");
  });
  it("counts encrypted replay unchanged across a checkpoint", async () => {
    solMock(); const a = solOpts(); const r = await m.chat(a);
    const history = [...a.messages, { role: "assistant", content: r.content, reasoning_items: r.reasoning_items,
      replay_seq: r.replay_seq, tool_calls: r.tool_calls.map(c => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })) },
      { role: "tool", content: "synthetic", tool_call_id: "call_1" }];
    const b = solOpts({ messages: jsonbKeyOrder(history), usage: jsonbKeyOrder(a.usage) as m.UsageLedger });
    assert.equal((await m.chat(b)).ok, true);
    assert.deepEqual(requests[2].body.input, requests[3].body.input);
    assert(requests[2].body.input!.some(x => x.encrypted_content === "opaque-encrypted-not-logged"));
  });
  for (const count of [null, -1, 1.1, "100"]) it(`rejects invalid exact count ${String(count)} without generation`, async () => {
    solMock(count); const r = await m.chat(solOpts());
    assert.equal(r.error, "direct_input_count_invalid"); assert.equal(requests.length, 1);
  });
  it("rejects long context before generation", async () => {
    solMock(272001); const r = await m.chat(solOpts()); assert.equal(r.error, "direct_input_count_limit"); assert.equal(requests.length, 1);
  });
  it("counts cache writes and output cap in worst case including long-context helper", () => {
    assert.equal(direct.sol61UpperUsd(272000, 16384), 0.928224);
    assert.equal(direct.sol61UpperUsd(272001, 16384), 1.7663415);
  });
  it("refuses to reserve beyond remaining two-dollar native allowance", async () => {
    solMock(); const ledger = m.newUsageLedger();
    ledger.direct_provider_attempts = [{ ...usage.emptyDirectUsage(), provider: "openai", requested_model: "gpt-6.1-sol", outcome: "ok", reserved_usd: 1.99, settled_upper_usd: 1.99 } as usage.DirectAttempt];
    const r = await m.chat(solOpts({ usage: ledger }));
    assert.equal(r.error, "direct_native_budget_exhausted"); assert.equal(requests.length, 1);
  });
  it("checkpoint failure never dispatches generation", async () => {
    solMock(); const r = await m.chat(solOpts({ beforeDirectDispatch: async () => false }));
    assert.equal(r.error, "direct_checkpoint_failed"); assert.equal(requests.length, 1);
  });
  it("count endpoint failure has no generation fallback", async () => {
    enabled = "openai"; globalThis.fetch = async (u) => { requests.push({ url: String(u), body: {} }); return new Response("not read", { status: 404 }); };
    assert.equal((await m.chat(solOpts())).error, "direct_input_count_unavailable"); assert.equal(requests.length, 1);
  });
  it("fails closed if receipt exceeds exact preflight", async () => {
    solMock(99); const o = solOpts(); const r = await m.chat(o);
    assert.equal(r.error, "direct_budget_receipt_mismatch"); assert.equal(r.direct_attempt!.settled_upper_usd, undefined);
    assert.equal(direct.sol61ReservedUsage(o.usage.direct_provider_attempts!), null);
  });
  it("unknown stream retains full reservation and blocks another count or generation", async () => {
    solMock(100, []); const o = solOpts(); const r = await m.chat(o);
    assert.equal(r.ok, false); assert.equal(r.direct_attempt!.reserved_usd, 0.180499);
    assert.equal((await m.chat(o)).error, "direct_attempt_reconciliation_required"); assert.equal(requests.length, 2);
  });
  it("cannot change direct OpenAI model across calls", async () => {
    solMock(); const o = solOpts(); assert.equal((await m.chat(o)).ok, true);
    assert.equal((await m.chat(opts({ usage: o.usage }))).error, "direct_provider_route_changed"); assert.equal(requests.length, 2);
  });
  it("unknown cache categories preserve a conservative bound without inventing exact price", async () => {
    solMock(100, oEvents({ model: "gpt-6.1-sol", usage: { input_tokens: 100, output_tokens: 20 } }));
    const r = await m.chat(solOpts()); assert.equal(r.ok, true); assert.equal(r.direct_attempt!.estimated_usd, null);
    assert.equal(r.direct_attempt!.settled_upper_usd, 0.000495);
  });
  it("concurrent count completions cannot both reserve a shared ledger", async () => {
    solMock(); const ledger = m.newUsageLedger(); let release: () => void = () => {};
    const wait = new Promise<void>(resolve => { release = resolve; });
    const a = m.chat(solOpts({ usage: ledger, beforeDirectDispatch: async () => { await wait; return true; } }));
    while (!ledger.direct_provider_attempts?.length) await Promise.resolve();
    const b = await m.chat(solOpts({ usage: ledger }));
    assert.equal(b.error, "direct_attempt_reconciliation_required"); release(); assert.equal((await a).ok, true);
    assert.equal(requests.length, 2);
  });
});


describe("Sol 6.1 price receipt fences", () => {
  for (const receipt of [{ service_tier: "priority" }, { inference_geo: "us" }, { service_tier: null }]) {
    it(`retains reservation and stops on incompatible price receipt ${JSON.stringify(receipt)}`, async () => {
      enabled = "openai";
      globalThis.fetch = async (u, req) => {
        requests.push({ url: String(u), body: JSON.parse(String(req!.body)) });
        return String(u).endsWith("/input_tokens") ? Response.json({ object: "response.input_tokens", input_tokens: 100 }) :
          response(oEvents({ model: "gpt-6.1-sol", ...receipt }));
      };
      const o = opts({ model: "openai/gpt-6.1-sol" }); const r = await m.chat(o);
      assert.equal(r.error, "direct_price_tier_or_geo_mismatch");
      assert.equal(r.direct_attempt!.settled_upper_usd, undefined);
      assert.equal(r.direct_attempt!.reserved_usd, 0.180499);
      assert.equal(direct.sol61ReservedUsage(o.usage.direct_provider_attempts!), null);
    });
  }
});
