import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import * as m from "../../supabase/functions/legal-research-v2/shared/model.ts";
import * as od from "../../supabase/functions/legal-research-v2/shared/ordinaryDirect.ts";
import * as rp from "../../supabase/functions/legal-research-v2/shared/ordinaryRepair.ts";
import * as rc from "../../supabase/functions/legal-research-v2/shared/ordinaryReceipts.ts";
import { ORDINARY_RESEARCH_MODEL } from "../../supabase/functions/legal-research-v2/shared/ordinaryResearchPolicy.ts";

const globals = globalThis as unknown as { Deno?: unknown };
const originalFetch = globalThis.fetch;
let fetches: string[] = [];
let ledger: ReturnType<typeof od.createMemorySpendLedger>;
const SRC = readFileSync("supabase/functions/legal-research-v2/index.ts", "utf8");

const response = (model: unknown) => ({ id: "resp_1", ...(model === undefined ? {} : { model }), status: "completed",
  usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } },
  reasoning: { effort: "medium" }, service_tier: "default",
  output: [{ type: "function_call", call_id: "c1", name: "submit_research_memo", arguments: '{"answer":"x"}' }] });
function script(model: unknown) {
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url); fetches.push(u);
    if (u.endsWith("/input_tokens")) return new Response(JSON.stringify({ object: "response.input_tokens", input_tokens: 100 }));
    const ev = { type: "response.completed", response: response(model) };
    return new Response(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`, { status: 200 });
  }) as typeof fetch;
}
const tools = [{ name: "submit_research_memo", description: "m", parameters: { type: "object", properties: { answer: { type: "string" } } } }];
const call = (usage = m.newUsageLedger()) => m.chat({ model: ORDINARY_RESEARCH_MODEL, messages: [{ role: "user", content: "q" }], tools,
  usage, beforeDirectDispatch: async () => true, ordinaryTransport: "openai_direct",
  runId: "11111111-1111-4111-8111-111111111111", costStage: "v2_research_agent" } as Parameters<typeof m.chat>[0]);

beforeEach(() => {
  fetches = [];
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
  const env: Record<string, string> = { V2_ORDINARY_RUN_CAP_USD: "3", V2_ORDINARY_DAY_CAP_USD: "5", OPENAI_API_KEY: "synthetic" };
  globals.Deno = { env: { get: (k: string) => env[k] } };
  ledger = od.createMemorySpendLedger(); od.setOrdinarySpendLedgerForTests(ledger.ledger);
});
afterEach(() => { globalThis.fetch = originalFetch; od.setOrdinarySpendLedgerForTests(null); delete globals.Deno; });

describe("ordinary repair checkpointing", () => {
  it("all four repair/fallback calls use the shared checkpoint option (ordinary + pilot)", () => {
    assert.equal(SRC.match(/\.\.\.repairCheckpointOption\(intake, \(state: AgentStateJson\) => saveCheckpoint\(state, true\)\)/g)?.length, 4);
    assert.doesNotMatch(SRC, /intake\.agent_direct_provider \? \{ checkpoint: \(state: AgentStateJson\) => saveCheckpoint\(state, true\) \}/);
  });
  it("ordinary and pilot get a checkpoint; gateway stays without one", () => {
    const save = async () => true;
    assert.equal(rp.repairCheckpointOption({ agent_transport: "openai_direct" }, save).checkpoint, save);
    assert.equal(rp.repairCheckpointOption({ agent_direct_provider: {} }, save).checkpoint, save);
    assert.deepEqual(rp.repairCheckpointOption({}, save), {});
  });
  it("persists an explicit repair phase for ordinary; pilot fields unchanged", () => {
    assert.deepEqual(rp.repairCheckpointFields({ agent_transport: "openai_direct" }, true), { direct_repair_checkpoint: true, repair_phase: "repair_research" });
    assert.deepEqual(rp.repairCheckpointFields({ agent_direct_provider: {} }, true), { direct_repair_checkpoint: true });
    assert.deepEqual(rp.repairCheckpointFields({ agent_transport: "openai_direct" }, false), {});
    assert.match(SRC, /\.\.\.repairCheckpointFields\(intake, directRepair\)/);
  });
  it("interrupted ordinary repair fails closed, never resumes as initial research", () => {
    const i = { agent_transport: "openai_direct" };
    assert.equal(rp.ordinaryRepairResumeError(i, { repair_phase: "repair_research" }), "ordinary_repair_resume_requires_review");
    assert.equal(rp.ordinaryRepairResumeError(i, { direct_repair_checkpoint: true }), "ordinary_repair_resume_requires_review");
    assert.equal(rp.ordinaryRepairResumeError(i, { repair_phase: "anything" }), "ordinary_repair_resume_requires_review");
    assert.equal(rp.ordinaryRepairResumeError(i, {}), null);
    assert.equal(rp.ordinaryRepairResumeError({}, { direct_repair_checkpoint: true }), null);
    // Guard runs before any agent work; error is not "definitive" so no refund.
    assert.match(SRC, /const repairResumeError = ordinaryRepairResumeError\(intake, resume\);\n\s+if \(repairResumeError\) throw new Error\(repairResumeError\);/);
    assert.ok(!"ordinary_repair_resume_requires_review".startsWith("ordinary_direct_failed:definitive:"));
  });
  it("ordinary checkpoint writes are verified (missing row = failed checkpoint)", () => {
    assert.match(SRC, /const strictCheckpoint = !!intake\.agent_direct_provider \|\| intake\.agent_transport === "openai_direct";/);
  });
  it("failed checkpoint prevents dispatch on a repair-stage call", async () => {
    script("gpt-6.1-sol"); const usage = m.newUsageLedger();
    const r = await m.chat({ ...(await Promise.resolve({})), model: ORDINARY_RESEARCH_MODEL, messages: [{ role: "user", content: "q" }], tools,
      usage, beforeDirectDispatch: async () => false, ordinaryTransport: "openai_direct",
      runId: "11111111-1111-4111-8111-111111111111", costStage: "v2_research_agent" } as Parameters<typeof m.chat>[0]);
    assert.equal(r.ok, false);
    assert.ok(!fetches.includes("https://api.openai.com/v1/responses"));
  });
});

describe("returned model must match before settling", () => {
  for (const [name, model] of [["wrong", "gpt-4o"], ["missing", undefined], ["empty", ""]] as const) {
    it(`${name} response_model: no settle/release, held uncertain, answer rejected, next call blocked`, async () => {
      script(model); const usage = m.newUsageLedger();
      const r = await call(usage);
      assert.equal(r.ok, false);
      assert.equal(r.ordinary_dispatch, "uncertain");
      const a = usage.ordinary_direct_attempts![0];
      assert.equal(a.settled_upper_usd, undefined);
      assert.equal(a.estimated_usd, null);
      assert.equal(a.estimate_complete, false);
      const row = ledger.rows.get(a.attempt_id)!;
      assert.equal(row.state, "uncertain");
      assert.equal(row.reserved, a.reserved_usd);
      assert.equal(od.hasUncertainOrdinaryAttempt(usage), true);
      const n = fetches.length;
      const r2 = await call(usage);
      assert.equal(r2.error, "ordinary_reconciliation_required");
      assert.equal(fetches.length, n);
    });
  }
  it("exact matching model still settles", async () => {
    script("gpt-6.1-sol"); const usage = m.newUsageLedger();
    const r = await call(usage);
    assert.equal(r.ok, true);
    const a = usage.ordinary_direct_attempts![0];
    assert.equal(ledger.rows.get(a.attempt_id)!.state, "settled");
    assert.ok(typeof a.settled_upper_usd === "number");
  });
});

describe("durable ordinary receipts", () => {
  const full = { attempt_id: "22222222-2222-4222-8222-222222222222", provider: "openai", endpoint: "responses",
    requested_model: "gpt-6.1-sol", response_model: "gpt-6.1-sol", provider_request_id: "req_1", provider_response_id: "resp_1",
    http_status: 200, duration_ms: 1200, input_count_ms: 30, checkpoint_ms: 5, counted_input_tokens: 100, input_tokens: 100,
    uncached_input_tokens: 100, cache_read_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 20, reasoning_tokens: 5,
    reserved_usd: 0.18, settled_upper_usd: 0.0004, estimated_usd: 0.0004, estimate_complete: true, usage_complete: true,
    outcome: "ok", effort: "medium", effort_returned: "medium", effort_status: "matched", price_version: "sol61-standard-2026-10-03" };
  it("keeps every allowlisted reconciliation field", () => {
    const [r] = rc.ordinaryReceipts([full]);
    for (const k of Object.keys(full).filter(k => k !== "endpoint")) assert.deepEqual(r[k], (full as Record<string, unknown>)[k], k);
  });
  it("drops adversarial extra fields and invalid values", () => {
    const [r] = rc.ordinaryReceipts([{ ...full, prompt: "SECRET q", answer: "a", tool_args: "{}", reasoning: "enc", native_replay: [1],
      api_key: "sk-x", response_model: "bad model!\n", estimated_usd: Number.NaN, outcome: "hacked", reserved_usd: -1 }]);
    const s = JSON.stringify(r);
    for (const bad of ["SECRET", "sk-x", "enc", "native_replay", "prompt", "answer", "tool_args"]) assert.ok(!s.includes(bad), bad);
    assert.equal(r.response_model, null); assert.equal(r.estimated_usd, null); assert.equal(r.outcome, null); assert.equal(r.reserved_usd, null);
  });
  it("unknowns stay null; bounded count", () => {
    const [r] = rc.ordinaryReceipts([{ attempt_id: full.attempt_id, outcome: "stream_unknown" }]);
    assert.equal(r.input_tokens, null); assert.equal(r.settled_upper_usd, null); assert.equal(r.usage_complete, false);
    const many = rc.withOrdinaryReceipts({}, Array.from({ length: 70 }, () => full)) as Record<string, unknown>;
    assert.equal((many.ordinary_direct_receipts as unknown[]).length, 64);
    assert.equal(many.ordinary_direct_receipts_truncated, true);
    assert.deepEqual(rc.withOrdinaryReceipts({ a: 1 }, undefined), { a: 1 });
  });
  it("success and error terminal writes carry receipts from the live ledger; agent_state cleared only on verified success write", () => {
    assert.match(SRC, /result: withOrdinaryReceipts\(out as Record<string, unknown>, liveUsage\.current\?\.ordinary_direct_attempts\),\n\s+agent_state: null,/);
    assert.match(SRC, /status: "error",\n\s+error: message,\n\s+\.\.\.\(liveUsage\.current\?\.ordinary_direct_attempts\?\.length \? \{ result: withOrdinaryReceipts\(\{\}, liveUsage\.current\.ordinary_direct_attempts\) \} : \{\}\),/);
    assert.match(SRC, /opts\.liveUsage\.current = usage;/);
    assert.match(SRC, /v2_terminal_write_failed/);
  });
  it("cost-event writes stay disabled", () => assert.equal(od.ORDINARY_COST_EVENTS_ENABLED, false));
});
