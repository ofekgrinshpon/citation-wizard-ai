import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { readFileSync } from "node:fs";

const env: Record<string, string> = { LOVABLE_API_KEY: "test-key-not-real" };
beforeAll(() => { (globalThis as any).Deno = { env: { get: (k: string) => env[k] } }; });
type M = typeof import("../../supabase/functions/legal-research-v2/shared/model");
let m: M;
let cw: typeof import("../../supabase/functions/legal-research-v2/agent/contextWindow");
beforeAll(async () => {
  m = await import("../../supabase/functions/legal-research-v2/shared/model");
  cw = await import("../../supabase/functions/legal-research-v2/agent/contextWindow");
});
afterEach(() => { vi.restoreAllMocks(); delete env.V2_REASONING_REPLAY; });

const ENC = "gAAAA-opaque-ciphertext";
function sse(events: unknown[]) {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({ start(c) { for (const e of events) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)); c.close(); } }), { status: 200 });
}
const done = (item: unknown) => ({ type: "response.output_item.done", item });
const completed = { type: "response.completed", response: { usage: { input_tokens: 10, output_tokens: 5 } } };
const reasoningItem = { type: "reasoning", id: "rs_1", encrypted_content: ENC, summary: [{ type: "summary_text", text: "PLAINTEXT-SUMMARY" }] };

function mockFetch(events: unknown[]) {
  const bodies: any[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, i) => { bodies.push(JSON.parse(String(i?.body))); return sse(events); });
  return bodies;
}
const base = [{ role: "system" as const, content: "s" }, { role: "user" as const, content: "q" }];

describe("reasoning capture", () => {
  it("captures only valid encrypted items, drops plaintext summary, adds include", async () => {
    const bodies = mockFetch([
      done(reasoningItem),
      done({ type: "reasoning", id: "rs_bad", summary: [] }),
      done({ type: "reasoning", encrypted_content: 42 }),
      done({ type: "function_call", call_id: "c1", name: "search", arguments: "{}" }),
      completed,
    ]);
    const res = await m.chat({ model: "openai/gpt-6-astra", messages: base, replayReasoning: true });
    expect(bodies[0].include).toEqual(["reasoning.encrypted_content"]);
    expect(res.reasoning_items).toEqual([{ type: "reasoning", id: "rs_1", encrypted_content: ENC }]);
    expect(JSON.stringify(res)).not.toContain("PLAINTEXT-SUMMARY");
    expect(res.tool_calls).toHaveLength(1);
  });

  it("replay off: request identical to old transport and nothing captured", async () => {
    const bodies = mockFetch([done(reasoningItem), completed]);
    const res = await m.chat({ model: "openai/gpt-6-astra", messages: base });
    expect(bodies[0].include).toBeUndefined();
    expect(Object.keys(bodies[0]).sort()).toEqual(["input", "model", "reasoning", "store", "stream"]);
    expect(res.reasoning_items).toBeUndefined();
  });

  it("no-tool answer with no reasoning returned: empty capture, request otherwise identical", async () => {
    const on = mockFetch([{ type: "response.output_text.delta", delta: "a" }, completed]);
    const r1 = await m.chat({ model: "openai/gpt-6-astra", messages: base, replayReasoning: true });
    vi.restoreAllMocks();
    const off = mockFetch([{ type: "response.output_text.delta", delta: "a" }, completed]);
    await m.chat({ model: "openai/gpt-6-astra", messages: base });
    expect(r1.reasoning_items).toEqual([]);
    const { include, ...rest } = on[0];
    expect(include).toBeDefined();
    expect(rest).toEqual(off[0]);
  });
});

describe("replay ordering", () => {
  const conv = (): any[] => [
    ...base,
    { role: "assistant", content: "", reasoning_items: [{ type: "reasoning", id: "rs_1", encrypted_content: "E1" }], replay_seq: ["r", "c:a", "c:b"],
      tool_calls: [{ id: "a", type: "function", function: { name: "t", arguments: "{}" } }, { id: "b", type: "function", function: { name: "t", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "a", content: "ra" },
    { role: "tool", tool_call_id: "b", content: "rb" },
    { role: "assistant", content: "", reasoning_items: [{ type: "reasoning", encrypted_content: "E2" }], replay_seq: ["r", "c:c"],
      tool_calls: [{ id: "c", type: "function", function: { name: "t", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "c", content: "rc" },
  ];

  it("reasoning precedes its function calls and their outputs; no duplicates or orphans", () => {
    const types = m.toResponsesInput(conv(), true).map((i: any) => i.type ?? i.role);
    expect(types).toEqual(["system", "user", "reasoning", "function_call", "function_call", "function_call_output", "function_call_output", "reasoning", "function_call", "function_call_output"]);
    const items = m.toResponsesInput(conv(), true) as any[];
    expect(items[2]).toEqual({ type: "reasoning", id: "rs_1", encrypted_content: "E1", summary: [] });
    expect(items[7]).toEqual({ type: "reasoning", encrypted_content: "E2", summary: [] });
  });

  it("without replay the input equals the input minus reasoning items", () => {
    const withR = m.toResponsesInput(conv(), true).filter((i: any) => i.type !== "reasoning");
    expect(m.toResponsesInput(conv(), false)).toEqual(withR);
  });

  it("forwarded count is reported and replayed request carries include", async () => {
    const bodies = mockFetch([completed]);
    const res = await m.chat({ model: "openai/gpt-6-astra", messages: conv(), replayReasoning: true });
    expect(res.reasoning_items_forwarded).toBe(2);
    expect(bodies[0].input.filter((i: any) => i.type === "reasoning")).toHaveLength(2);
  });

  it("Gemini/chat-completions never receives reasoning fields", async () => {
    const bodies: any[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, i) => {
      bodies.push(JSON.parse(String(i?.body)));
      return new Response(JSON.stringify({ choices: [{ message: { content: "x" }, finish_reason: "stop" }], usage: {} }), { status: 200 });
    });
    await m.chat({ model: "google/gemini-3.7-flash", messages: conv(), replayReasoning: true });
    const s = JSON.stringify(bodies[0]);
    expect(s).not.toContain("reasoning_items");
    expect(s).not.toContain("E1");
    expect(bodies[0].include).toBeUndefined();
  });

  it("checkpoint JSON round-trip preserves replay", () => {
    const restored = JSON.parse(JSON.stringify(conv()));
    expect(m.toResponsesInput(restored, true)).toEqual(m.toResponsesInput(conv(), true));
  });

  it("compaction keeps reasoning with its assistant turn and coherent call/result groups", () => {
    const big = conv();
    big[3].content = "x".repeat(20000);
    const out = cw.compactAgentMessages(big as any).messages as any[];
    expect(out[2].reasoning_items).toEqual(big[2].reasoning_items);
    const items = m.toResponsesInput(out, true) as any[];
    const calls = items.filter((i) => i.type === "function_call").map((i) => i.call_id);
    const outs = items.filter((i) => i.type === "function_call_output").map((i) => i.call_id);
    expect(outs).toEqual(calls);
  });
});

describe("interleaving, fallback and budget", () => {
  it("preserves interleaved provider order r1,a,r2,b and text position", async () => {
    mockFetch([
      done({ type: "reasoning", id: "r1", encrypted_content: "X1" }),
      done({ type: "message" }),
      { type: "response.output_text.delta", delta: "hi" },
      done({ type: "function_call", call_id: "a", name: "t", arguments: '{"q":1}' }),
      done({ type: "reasoning", id: "r2", encrypted_content: "X2" }),
      done({ type: "function_call", call_id: "b", name: "t", arguments: '{"q":2}' }),
      completed,
    ]);
    const res: any = await m.chat({ model: "openai/gpt-6-astra", messages: base, replayReasoning: true });
    expect(res.replay_seq).toEqual(["r", "t", "c:a", "r", "c:b"]);
    const turn: any = { role: "assistant", content: res.content, reasoning_items: res.reasoning_items, replay_seq: res.replay_seq,
      tool_calls: res.tool_calls.map((c: any) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })) };
    const hist: any[] = [...base, turn, { role: "tool", tool_call_id: "a", content: "ra" }, { role: "tool", tool_call_id: "b", content: "rb" }];
    const items = m.toResponsesInput(JSON.parse(JSON.stringify(hist)), true) as any[];
    expect(items.slice(2).map((i) => i.type === "reasoning" ? i.id : i.type === "function_call" ? `${i.call_id}${i.arguments}` : i.role ?? i.call_id))
      .toEqual(["r1", "assistant", 'a{"q":1}', "r2", 'b{"q":2}', "function_call_output", "function_call_output"]);
    expect(items.filter((i) => i.type === "function_call")).toHaveLength(2);
  });

  it("malformed reasoning mid-turn => no replay for that turn (fallback flagged), visible output intact", async () => {
    mockFetch([done({ type: "reasoning", encrypted_content: "X1" }), done({ type: "reasoning", summary: [] }),
      done({ type: "function_call", call_id: "a", name: "t", arguments: "{}" }), completed]);
    const res: any = await m.chat({ model: "openai/gpt-6-astra", messages: base, replayReasoning: true });
    expect(res.replay_fallback).toBe(true);
    expect(res.reasoning_items).toEqual([]);
    expect(res.tool_calls).toHaveLength(1);
  });

  it("inconsistent or legacy (no seq) turn replays without reasoning in original order", () => {
    const t: any = { role: "assistant", content: "", reasoning_items: [{ type: "reasoning", encrypted_content: "E" }],
      tool_calls: [{ id: "a", type: "function", function: { name: "t", arguments: "{}" } }] };
    const off = m.toResponsesInput([t], false);
    expect(m.toResponsesInput([t], true)).toEqual(off);
    expect(m.toResponsesInput([{ ...t, replay_seq: ["r", "c:zzz"] }], true)).toEqual(off);
    expect(m.toResponsesInput([{ ...t, replay_seq: ["r", "c:a", "c:a"] }], true)).toEqual(off);
  });

  it("total budget drops oldest turns' replay whole, never truncates, keeps tool pairs", () => {
    const big = "Z".repeat(500_000);
    const hist: any[] = [];
    for (let i = 0; i < 6; i++) {
      hist.push({ role: "assistant", content: "", reasoning_items: [{ type: "reasoning", encrypted_content: big }], replay_seq: ["r", `c:k${i}`],
        tool_calls: [{ id: `k${i}`, type: "function", function: { name: "t", arguments: "{}" } }] });
      hist.push({ role: "tool", tool_call_id: `k${i}`, content: "r" });
    }
    const { dropped_items } = m.enforceReplayBudget(hist);
    expect(dropped_items).toBe(2);
    const kept = hist.filter((h) => h.reasoning_items);
    expect(kept).toHaveLength(4);
    expect(hist[0].reasoning_items).toBeUndefined();
    expect(hist[0].replay_seq).toBeUndefined();
    expect(kept.every((h) => h.reasoning_items[0].encrypted_content.length === 500_000)).toBe(true);
    expect(hist.filter((h) => h.tool_calls)).toHaveLength(6);
    expect(hist.filter((h) => h.role === "tool")).toHaveLength(6);
  });

  it("one provider attempt per call — no fallback retry", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("bad", { status: 400 }));
    const res = await m.chat({ model: "openai/gpt-6-astra", messages: base, replayReasoning: true });
    expect(res.ok).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("switch, privacy and call sites", () => {
  it("V2_REASONING_REPLAY=off disables; default on", () => {
    expect(m.reasoningReplayEnabled()).toBe(true);
    env.V2_REASONING_REPLAY = "off";
    expect(m.reasoningReplayEnabled()).toBe(false);
  });
  it("only the research agent opts in; telemetry/logs never mention encrypted content", () => {
    const fns = "supabase/functions";
    const files = ["legal-research-v2/beta/modelRouter.ts", "legal-research-v2/verification/supportVerifier.ts", "legal-research-v2/drafting/draft.ts", "legal-research-v2/verification/temporalValidity.ts", "_shared/costTelemetry.ts", "legal-research-v2/index.ts"];
    for (const f of files) {
      const s = readFileSync(`${fns}/${f}`, "utf8");
      expect(s).not.toMatch(/replayReasoning|encrypted_content|reasoning_items\b|replay_seq/);
    }
    expect(readFileSync(`${fns}/legal-research-v2/agent/researchAgent.ts`, "utf8")).toMatch(/replayReasoning: true/);
  });
});
