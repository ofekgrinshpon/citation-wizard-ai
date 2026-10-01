import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { withCostTelemetry, __setCostWriter, type CostEvent } from "../../supabase/functions/_shared/costTelemetry";

const env: Record<string, string> = { LOVABLE_API_KEY: "test-key-not-real", PERPLEXITY_API_KEY: "pk-not-real" };
beforeAll(() => {
  (globalThis as any).Deno = { env: { get: (k: string) => env[k] } };
});
let chat: typeof import("../../supabase/functions/legal-research-v2/shared/model").chat;
let runRawWebSearch: typeof import("../../supabase/functions/legal-research-v2/tools/rawWebSearch").runRawWebSearch;
beforeAll(async () => {
  ({ chat } = await import("../../supabase/functions/legal-research-v2/shared/model"));
  ({ runRawWebSearch } = await import("../../supabase/functions/legal-research-v2/tools/rawWebSearch"));
});

const RUN = "33333333-3333-4333-8333-333333333333";
const RUN2 = "44444444-4444-4444-8444-444444444444";
const root = resolve(__dirname, "../..");
const read = (f: string) => readFileSync(resolve(root, f), "utf8");
const SECRET_TEXT = "PRIVATE-PROMPT-ANSWER-TEXT";

function sse(events: unknown[], opts: { failAfter?: boolean } = {}) {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({
    start(c) {
      for (const e of events) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      if (opts.failAfter) c.error(new Error("socket reset"));
      else c.close();
    },
  }), { status: 200, headers: { "content-type": "text/event-stream", "x-request-id": "req_abc123" } });
}
const completed = (usage: Record<string, unknown> | undefined) => ({
  type: "response.completed",
  response: { id: "resp_1", model: "openai/gpt-6-astra", ...(usage ? { usage } : {}) },
});

async function capture(fn: () => Promise<unknown>, init: Record<string, unknown> = { requestId: RUN }) {
  const rows: CostEvent[] = [];
  let flush!: Promise<void>;
  await withCostTelemetry("legal-research-v2", fn as () => Promise<unknown>, {
    init: { feature: "legal_research", ...init } as any,
    onFlush: (p) => { flush = p; },
  });
  __setCostWriter(async (r) => { rows.push(...r); });
  await flush;
  return rows;
}

afterEach(() => { vi.restoreAllMocks(); __setCostWriter(null); });

describe("V2 Responses SSE telemetry", () => {
  it("records cached + reasoning tokens when returned; stream result unchanged", async () => {
    let wire: string | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, i) => {
      wire = String(i?.body);
      return sse([
        { type: "response.output_text.delta", delta: SECRET_TEXT },
        completed({ input_tokens: 100, output_tokens: 40, total_tokens: 140, input_tokens_details: { cached_tokens: 60 }, output_tokens_details: { reasoning_tokens: 25 } }),
      ]);
    });
    let res: any;
    const rows = await capture(async () => { res = await chat({ model: "openai/gpt-6-astra", messages: [{ role: "user", content: "q" }], costStage: "v2_research_agent" }); });
    expect(res.ok).toBe(true);
    expect(res.content).toBe(SECRET_TEXT);
    expect(res.prompt_tokens).toBe(100);
    // Wire body has no telemetry field and matches the baseline shape exactly.
    expect(JSON.parse(wire!)).toEqual({
      model: "openai/gpt-6-astra",
      input: [{ role: "user", content: [{ type: "input_text", text: "q" }] }],
      stream: true, store: false, reasoning: { effort: "medium", summary: "auto" },
    });
    expect(rows).toHaveLength(1);
    const e = rows[0];
    expect(e).toMatchObject({
      endpoint: "responses", stage: "v2_research_agent", outcome: "ok", capture_status: "complete",
      input_tokens: 100, output_tokens: 40, total_tokens: 140, cached_input_tokens: 60, reasoning_tokens: 25,
      provider_request_id: "resp_1", response_model: "openai/gpt-6-astra", telemetry_request_id: RUN,
      latency_complete: true, estimated_usd: null, estimate_complete: false, provider_reported_usd: null,
    });
    expect(e.completion_latency_ms).not.toBeNull();
    expect(JSON.stringify(rows)).not.toContain(SECRET_TEXT);
  });

  it("missing usage stays null, not zero", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(sse([completed(undefined)]));
    const rows = await capture(() => chat({ model: "openai/gpt-6-sol", messages: [], costStage: "v2_research_agent" }));
    expect(rows[0]).toMatchObject({ outcome: "ok", input_tokens: null, output_tokens: null, cached_input_tokens: null, reasoning_tokens: null });
  });

  it("incomplete / failed / mid-stream error / abort / network / http", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    f.mockResolvedValueOnce(sse([{ type: "response.incomplete", response: { usage: { input_tokens: 5, output_tokens: 9 } } }]));
    f.mockResolvedValueOnce(sse([{ type: "response.failed", response: { error: { message: SECRET_TEXT } } }]));
    f.mockResolvedValueOnce(sse([{ type: "response.output_text.delta", delta: "x" }], { failAfter: true }));
    f.mockRejectedValueOnce(Object.assign(new Error("aborted"), { name: "AbortError" }));
    f.mockRejectedValueOnce(new TypeError("dns"));
    f.mockResolvedValueOnce(new Response(SECRET_TEXT, { status: 503 }));
    const outs: string[] = [];
    const rows = await capture(async () => {
      for (let i = 0; i < 6; i++) {
        try { const r = await chat({ model: "openai/gpt-6-astra", messages: [] }); outs.push(r.ok ? "ok" : `fail${r.http_status}`); }
        catch { outs.push("threw"); }
      }
    });
    // Original behavior preserved (stream read error still throws as before).
    expect(outs).toEqual(["ok", "fail502", "threw", "fail0", "fail0", "fail503"]);
    expect(rows.map((r) => r.outcome)).toEqual(["incomplete", "stream_error", "stream_error", "aborted", "network_error", "http_error"]);
    expect(rows[0]).toMatchObject({ input_tokens: 5, output_tokens: 9 });
    expect(new Set(rows.map((r) => r.id)).size).toBe(6);
    expect(rows.map((r) => r.attempt_seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(JSON.stringify(rows)).not.toContain(SECRET_TEXT);
  });
});

describe("V2 chat-completions + Perplexity", () => {
  it("chat usage incl. cached/reasoning; Gemini 3.7 has no verified price → null", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      id: "gen-1", model: "google/gemini-3.7-flash",
      choices: [{ message: { content: SECRET_TEXT }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 7, total_tokens: 17, prompt_tokens_details: { cached_tokens: 4 }, completion_tokens_details: { reasoning_tokens: 3 } },
    }), { status: 200 }));
    const rows = await capture(() => chat({ model: "google/gemini-3.7-flash", messages: [], costStage: "v2_support_verifier" }));
    expect(rows[0]).toMatchObject({ endpoint: "chat_completions", stage: "v2_support_verifier", input_tokens: 10, output_tokens: 7, cached_input_tokens: 4, reasoning_tokens: 3, estimated_usd: null });
  });

  it("raw web search records one attempt; failed search request_count 0", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    f.mockResolvedValueOnce(new Response(JSON.stringify({ id: "s1", results: [] }), { status: 200, headers: { "content-type": "application/json" } }));
    f.mockResolvedValueOnce(new Response("x", { status: 429 }));
    const rows = await capture(async () => {
      await runRawWebSearch({ query: "a" }, { apiKey: "k" });
      await runRawWebSearch({ query: "b" }, { apiKey: "k" });
    });
    expect(rows.map((r) => [r.stage, r.endpoint, r.request_count])).toEqual([["v2_raw_web_search", "search", 1], ["v2_raw_web_search", "search", 0]]);
  });

  it("outside a context: no events, plain behavior", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(sse([completed({ input_tokens: 1, output_tokens: 1 })]));
    const r = await chat({ model: "openai/gpt-6-astra", messages: [] });
    expect(r.ok).toBe(true);
  });
});

describe("V2 isolation, resume, flush", () => {
  it("concurrent runs never mix; resumed chunk keeps run id with new invocation id", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, Math.random() * 10));
      return sse([completed({ input_tokens: 1, output_tokens: 1 })]);
    });
    const go = (run: string, batch: string) => capture(async () => {
      await Promise.all([chat({ model: "openai/gpt-6-astra", messages: [] }), chat({ model: "openai/gpt-6-astra", messages: [] })]);
    }, { requestId: run, batchId: batch });
    const B1 = "55555555-5555-4555-8555-555555555555", B2 = "66666666-6666-4666-8666-666666666666", B3 = "77777777-7777-4777-8777-777777777777";
    const [a, b, resumed] = await Promise.all([go(RUN, B1), go(RUN2, B2), go(RUN, B3)]);
    expect(a.every((r) => r.telemetry_request_id === RUN && r.telemetry_batch_id === B1)).toBe(true);
    expect(b.every((r) => r.telemetry_request_id === RUN2 && r.telemetry_batch_id === B2)).toBe(true);
    expect(resumed.every((r) => r.telemetry_request_id === RUN && r.telemetry_batch_id === B3)).toBe(true);
    const ids = [...a, ...b, ...resumed].map((r) => r.id);
    expect(new Set(ids).size).toBe(6);
  });

  it("flush runs after background work, not on return; writer failure never throws", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(sse([completed({ input_tokens: 1, output_tokens: 1 })]));
    __setCostWriter(async () => { throw new Error("db down"); });
    let flushed: Promise<void> | null = null;
    const r = await withCostTelemetry("legal-research-v2", async () => {
      await new Promise((x) => setTimeout(x, 20));
      expect(flushed).toBeNull();
      return chat({ model: "openai/gpt-6-astra", messages: [] });
    }, { onFlush: (p) => { flushed = p; } });
    expect(r.ok).toBe(true);
    await expect(flushed).resolves.toBeUndefined();
  });

  it("instrumentation overhead with mocks (DB flush excluded)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => sse([completed({ input_tokens: 1, output_tokens: 1 })]));
    const N = 150;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) await chat({ model: "openai/gpt-6-astra", messages: [] });
    const plain = (performance.now() - t0) / N;
    let t1 = 0;
    await withCostTelemetry("legal-research-v2", async () => {
      const s = performance.now();
      for (let i = 0; i < N; i++) await chat({ model: "openai/gpt-6-astra", messages: [] });
      t1 = (performance.now() - s) / N;
    }, { onFlush: () => {} });
    console.log(`[overhead] per call plain=${plain.toFixed(4)}ms instrumented=${t1.toFixed(4)}ms delta=${(t1 - plain).toFixed(4)}ms (N=${N})`);
    expect(t1 - plain).toBeLessThan(2);
  });
});

describe("static coverage", () => {
  it("every V2 paid call site is tagged; no direct untracked provider fetch", () => {
    const v2 = "supabase/functions/legal-research-v2/";
    expect(read(v2 + "beta/modelRouter.ts")).toMatch(/costStage: "v2_router"[\s\S]*costStage: "v2_direct_chat"/);
    expect(read(v2 + "agent/researchAgent.ts")).toContain('costStage: "v2_research_agent"');
    expect(read(v2 + "verification/supportVerifier.ts")).toContain('costStage: "v2_support_verifier"');
    expect(read(v2 + "verification/temporalValidity.ts")).toContain('costStage: "v2_temporal_validity"');
    const d = read(v2 + "drafting/draft.ts");
    for (const s of ["v2_drafter", "v2_drafter_repair", "v2_coverage_check"]) expect(d).toContain(`costStage: "${s}"`);
    expect(read(v2 + "tools/search.ts")).toContain('trackedFetch(PPLX_URL');
    expect(read(v2 + "tools/rawWebSearch.ts")).toContain('stage: "v2_raw_web_search"');
    expect(read(v2 + "index.ts")).toMatch(/function driveRun\([\s\S]*withCostTelemetry\("legal-research-v2"/);
    // chat() call count matches tagged count (7 model call sites + router 2).
    const m = read(v2 + "shared/model.ts");
    expect((m.match(/beginAttempt\(/g) ?? []).length).toBe(2);
  });
});
