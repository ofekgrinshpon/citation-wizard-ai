import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  withCostTelemetry,
  trackedFetch,
  setTelemetryFromBody,
  parseUsage,
  estimateUsd,
  __setCostWriter,
  type CostEvent,
} from "../../supabase/functions/_shared/costTelemetry";
import { telemetryBody, newTelemetryBatch, sourceTelemetry } from "@/lib/costTelemetry";

const RID = "11111111-1111-4111-8111-111111111111";
const BID = "22222222-2222-4222-8222-222222222222";

function jsonResp(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

async function run(
  body: Record<string, unknown>,
  fn: () => Promise<unknown>,
  name = "citation-chat",
): Promise<CostEvent[]> {
  const rows: CostEvent[] = [];
  __setCostWriter(async (r) => { rows.push(...r); });
  let flush: Promise<void> = Promise.resolve();
  await withCostTelemetry(name, async () => { setTelemetryFromBody(body); await fn(); }, { onFlush: (p) => { flush = p; } });
  await flush;
  return rows;
}

afterEach(() => { vi.unstubAllGlobals(); __setCostWriter(null); });

describe("cost telemetry", () => {
  it("parses Perplexity usage incl. provider-reported cost and complete estimate", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp({
      id: "pplx-abc", usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, search_context_size: "low", citation_tokens: 5, num_search_queries: 1, cost: { total_cost: 0.0123 } },
      choices: [{ message: { content: "secret answer" } }],
    })));
    const rows = await run({ telemetryFeature: "footnotes", telemetryRequestId: RID, telemetryBatchId: BID }, async () => {
      const r = await trackedFetch("https://api.perplexity.ai/chat/completions", { method: "POST", body: JSON.stringify({ model: "sonar-pro", messages: [{ content: "PROMPT" }] }) });
      expect((await r.json()).choices[0].message.content).toBe("secret answer"); // caller body intact
    });
    expect(rows).toHaveLength(1);
    const e = rows[0];
    expect(e).toMatchObject({ feature: "footnotes", telemetry_request_id: RID, telemetry_batch_id: BID, provider: "perplexity", model: "sonar-pro", outcome: "ok", input_tokens: 1000, output_tokens: 200, provider_reported_usd: 0.0123, estimate_complete: true, provider_request_id: "pplx-abc" });
    expect(e.estimated_usd).toBeCloseTo((1000 * 3 + 200 * 15) / 1e6 + 0.006, 8);
    expect(JSON.stringify(rows)).not.toMatch(/PROMPT|secret answer/);
  });

  it("missing usage stays null, never zero; estimate incomplete", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp({ choices: [] })));
    const [e] = await run({}, () => trackedFetch("https://ai.gateway.lovable.dev/v1/chat/completions", { body: JSON.stringify({ model: "google/gemini-2.5-flash" }) }));
    expect(e.input_tokens).toBeNull();
    expect(e.estimated_usd).toBeNull();
    expect(e.provider_reported_usd).toBeNull();
    expect(e.estimate_complete).toBe(false);
    expect(e.feature).toBe("unknown");
  });

  it("exact zero is preserved distinct from missing", () => {
    const u = parseUsage({ usage: { prompt_tokens: 0, completion_tokens: 0, cost: { total_cost: 0 } } });
    expect(u.input_tokens).toBe(0);
    expect(u.provider_reported_usd).toBe(0);
    expect(estimateUsd("perplexity", "chat_completions", "sonar", u, true)).toEqual({ estimated_usd: 0, estimate_complete: false });
  });

  it("unknown request-fee tier marks estimate incomplete; gateway price unknown", () => {
    const u = parseUsage({ usage: { prompt_tokens: 10, completion_tokens: 10 } });
    expect(estimateUsd("perplexity", "chat_completions", "sonar", u, true).estimate_complete).toBe(false);
    expect(estimateUsd("lovable_gateway", "chat_completions", "google/gemini-2.5-flash", u, true)).toEqual({ estimated_usd: null, estimate_complete: false });
  });

  it("every retry/fallback attempt is its own event with unique id and sequence; errors bodies unread", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response("ERROR BODY", { status: 429 }))
      .mockRejectedValueOnce(new Error("net"))
      .mockResolvedValueOnce(jsonResp({ usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    vi.stubGlobal("fetch", f);
    const rows = await run({ telemetryRequestId: RID }, async () => {
      await trackedFetch("https://api.perplexity.ai/chat/completions", { body: JSON.stringify({ model: "sonar" }) });
      await trackedFetch("https://api.perplexity.ai/chat/completions", { body: JSON.stringify({ model: "sonar" }) }).catch(() => {});
      await trackedFetch("https://api.perplexity.ai/chat/completions", { body: JSON.stringify({ model: "sonar-pro" }) });
    });
    expect(rows.map((r) => r.outcome)).toEqual(["http_error", "network_error", "ok"]);
    expect(rows.map((r) => r.attempt_seq)).toEqual([1, 2, 3]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
    expect(rows[0].http_status).toBe(429);
    expect(JSON.stringify(rows)).not.toContain("ERROR BODY");
  });

  it("search endpoint counted; public pages are not provider attempts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp({ results: [] })));
    const rows = await run({}, async () => {
      await trackedFetch("https://api.perplexity.ai/search", { body: "{}" });
      await trackedFetch("https://www.courtlistener.com/opinion/1/");
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ endpoint: "search", search_queries: 1, estimate_complete: true });
  });

  it("concurrent requests never mix context", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { await new Promise((r) => setTimeout(r, Math.random() * 10)); return jsonResp({}); }));
    const ids = Array.from({ length: 6 }, (_, i) => `3333333${i}-3333-4333-8333-333333333333`);
    const rows: CostEvent[] = [];
    __setCostWriter(async (r) => { rows.push(...r); });
    const flushes: Promise<void>[] = [];
    await Promise.all(ids.map((id) => withCostTelemetry("citation-chat", async () => {
      setTelemetryFromBody({ telemetryRequestId: id });
      await Promise.all([1, 2].map(() => trackedFetch("https://api.perplexity.ai/chat/completions", { body: "{}" })));
    }, { onFlush: (p) => { flushes.push(p); } })));
    await Promise.all(flushes);
    expect(rows).toHaveLength(12);
    for (const id of ids) expect(rows.filter((r) => r.telemetry_request_id === id).map((r) => r.attempt_seq).sort()).toEqual([1, 2]);
  });

  it("outside a context trackedFetch is plain fetch (no events)", async () => {
    const rows: CostEvent[] = [];
    __setCostWriter(async (r) => { rows.push(...r); });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp({})));
    await trackedFetch("https://api.perplexity.ai/chat/completions", { body: "{}" });
    expect(rows).toHaveLength(0);
  });

  it("writer failure never throws into the request", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp({})));
    __setCostWriter(async () => { throw new Error("db down"); });
    let flush: Promise<void> = Promise.resolve();
    const out = await withCostTelemetry("verify-source", async () => { await trackedFetch("https://ai.gateway.lovable.dev/v1/chat/completions", { body: "{}" }); return 42; }, { onFlush: (p) => { flush = p; } });
    expect(out).toBe(42);
    await expect(flush).resolves.toBeUndefined();
  });

  it("invalid ids/feature are dropped", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp({})));
    const [e] = await run({ telemetryFeature: "evil", telemetryRequestId: "x@y.com", telemetryBatchId: "<script>" }, () => trackedFetch("https://api.perplexity.ai/chat/completions", { body: "{}" }));
    expect(e).toMatchObject({ feature: "unknown", telemetry_request_id: null, telemetry_batch_id: null });
  });

  it("cache hit with classifier: classifier cost is captured even without an engine call", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp({ usage: { prompt_tokens: 50, completion_tokens: 5 } })));
    const rows = await run({ telemetryFeature: "uniform_citation", telemetryRequestId: RID }, () => trackedFetch("https://ai.gateway.lovable.dev/v1/chat/completions", { body: JSON.stringify({ model: "google/gemini-3-flash-preview" }) }), "classify-source");
    expect(rows[0]).toMatchObject({ function_name: "classify-source", telemetry_request_id: RID, input_tokens: 50 });
  });
});

describe("billing batch-id separation", () => {
  it("client telemetry body never contains batchId/requestId", () => {
    const body = telemetryBody(sourceTelemetry(newTelemetryBatch("footnotes")));
    expect(Object.keys(body).sort()).toEqual(["telemetryBatchId", "telemetryFeature", "telemetryRequestId"]);
  });

  it("no client caller sends the legacy billing batchId field", () => {
    for (const f of ["src/lib/runCitation.ts", "src/pages/Index.tsx", "src/components/BatchFootnoteBuilder.tsx", "src/components/BibliographyGenerator.tsx"]) {
      const src = readFileSync(resolve(__dirname, "../..", f), "utf8");
      expect(src).not.toMatch(/[^a-zA-Z]batchId\s*:/);
    }
  });

  it("server billing batch id is derived only from the legacy batchId field", () => {
    const src = readFileSync(resolve(__dirname, "../../supabase/functions/citation-chat/index.ts"), "utf8");
    expect(src).toMatch(/batchId: clientBatchId/);
    expect(src).toMatch(/const usageBatchId = typeof clientBatchId === "string"/);
    expect(src).not.toMatch(/usageBatchId\s*=.*telemetry/i);
  });
});
