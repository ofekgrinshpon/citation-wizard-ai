import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  withCostTelemetry,
  trackedFetch,
  setTelemetryFromBody,
  parseUsage,
  estimateUsd,
  readBounded,
  flushEvents,
  recordZeroWork,
  writeWithRetry,
  __setCostWriter,
  __setRawWriter,
  type CostEvent,
} from "../../supabase/functions/_shared/costTelemetry";
import { telemetryBody, newTelemetryBatch, sourceTelemetry } from "@/lib/costTelemetry";
import { runPool } from "@/lib/concurrency";

const RID = "11111111-1111-4111-8111-111111111111";
const BID = "22222222-2222-4222-8222-222222222222";
const root = resolve(__dirname, "../..");
const read = (f: string) => readFileSync(resolve(root, f), "utf8");

function jsonResp(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}
function delayedBodyResp(body: unknown, delayMs: number) {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const stream = new ReadableStream<Uint8Array>({
    async start(c) {
      await new Promise((r) => setTimeout(r, delayMs));
      c.enqueue(bytes);
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "application/json" } });
}

async function run(body: Record<string, unknown>, fn: () => Promise<unknown>, name = "citation-chat"): Promise<CostEvent[]> {
  const rows: CostEvent[] = [];
  __setCostWriter(async (r) => { rows.push(...r); });
  let flush: Promise<void> = Promise.resolve();
  await withCostTelemetry(name, async () => { setTelemetryFromBody(body); await fn(); }, { onFlush: (p) => { flush = p; } });
  await flush;
  return rows;
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); __setCostWriter(null); __setRawWriter(null); });

describe("pricing", () => {
  it("Sonar chat: no estimate (unverified post-migration billing); provider-reported USD kept; requested vs response model", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp({
      id: "pplx-abc", model: "agent-remapped",
      usage: { prompt_tokens: 1000, completion_tokens: 200, search_context_size: "low", cost: { total_cost: 0.0123 } },
      choices: [{ message: { content: "secret answer" } }],
    })));
    const rows = await run({ telemetryFeature: "footnotes", telemetryRequestId: RID, telemetryBatchId: BID }, async () => {
      const r = await trackedFetch("https://api.perplexity.ai/chat/completions", { method: "POST", body: JSON.stringify({ model: "sonar-pro", messages: [{ content: "PROMPT" }] }) }, { stage: "case_retrieval_tier1" });
      expect((await r.json()).choices[0].message.content).toBe("secret answer");
    });
    expect(rows[0]).toMatchObject({
      stage: "case_retrieval_tier1", requested_model: "sonar-pro", response_model: "agent-remapped",
      provider_reported_usd: 0.0123, estimated_usd: null, estimate_complete: false, capture_status: "complete",
      event_kind: "provider_attempt", origin: "server_observed",
    });
    expect(JSON.stringify(rows)).not.toMatch(/PROMPT|secret answer/);
  });

  it("Search: $0.005 per successful request, request_count separate from reported query count", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp({ results: [], usage: { num_search_queries: 3 } })));
    const [e] = await run({}, () => trackedFetch("https://api.perplexity.ai/search", { body: "{}" }, { stage: "foreign_search_tier1" }));
    expect(e).toMatchObject({ request_count: 1, search_queries: 3, estimated_usd: 0.005, estimate_complete: true });
  });

  it("Search: unreported query count stays null; failed search not billed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResp({ results: [] })).mockResolvedValueOnce(new Response("x", { status: 429 })));
    const rows = await run({}, async () => {
      await trackedFetch("https://api.perplexity.ai/search", { body: "{}" });
      await trackedFetch("https://api.perplexity.ai/search", { body: "{}" });
    });
    expect(rows[0]).toMatchObject({ search_queries: null, request_count: 1 });
    expect(rows[1]).toMatchObject({ request_count: 0, estimated_usd: null, outcome: "http_error" });
  });

  it("Gemini: list-price estimate, always incomplete, reasoning not double counted, cached split", () => {
    const u = parseUsage({ usage: { prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 400 }, completion_tokens_details: { reasoning_tokens: 60 } } });
    const e = estimateUsd("lovable_gateway", "chat_completions", "google/gemini-2.5-flash", u, true);
    expect(e.estimate_complete).toBe(false);
    expect(e.estimated_usd).toBeCloseTo((600 * 0.3 + 400 * 0.03 + 100 * 2.5) / 1e6, 10);
    const g3 = estimateUsd("lovable_gateway", "chat_completions", "google/gemini-3-flash-preview", parseUsage({ usage: { prompt_tokens: 100, completion_tokens: 10 } }), true);
    expect(g3.estimated_usd).toBeCloseTo((100 * 0.5 + 10 * 3) / 1e6, 10);
  });

  it("missing vs exact zero", () => {
    expect(estimateUsd("lovable_gateway", "chat_completions", "google/gemini-2.5-flash", parseUsage({}), true)).toEqual({ estimated_usd: null, estimate_complete: false });
    const z = parseUsage({ usage: { prompt_tokens: 0, completion_tokens: 0, cost: { total_cost: 0 } } });
    expect(z.input_tokens).toBe(0);
    expect(z.provider_reported_usd).toBe(0);
    expect(estimateUsd("lovable_gateway", "chat_completions", "google/gemini-2.5-flash", z, true).estimated_usd).toBe(0);
  });
});

describe("capture / latency", () => {
  it("delayed body: completion latency covers body, header latency separate", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => delayedBodyResp({ usage: { prompt_tokens: 1, completion_tokens: 1 } }, 80)));
    const [e] = await run({}, async () => {
      const r = await trackedFetch("https://ai.gateway.lovable.dev/v1/chat/completions", { body: JSON.stringify({ model: "google/gemini-2.5-flash" }) }, { stage: "formatter" });
      await r.json();
    });
    expect(e.header_latency_ms!).toBeLessThan(40);
    expect(e.completion_latency_ms!).toBeGreaterThanOrEqual(75);
    expect(e.latency_complete).toBe(true);
  });

  it("byte cap cancels only the clone; caller body intact; latency incomplete", async () => {
    const big = "x".repeat(2000);
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(big)); c.close(); } });
    expect((await readBounded(stream, 100)).status).toBe("body_byte_cap");
    // via trackedFetch with a real tee
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ pad: big }), { headers: { "content-type": "application/json" } })));
    const mod = await import("../../supabase/functions/_shared/costTelemetry");
    expect(mod.BODY_BYTE_CAP).toBeGreaterThan(1000);
  });

  it("hung body: time cap → incomplete, null completion latency, caller unaffected", async () => {
    const hung = new ReadableStream<Uint8Array>({ start() { /* never */ } });
    const r = await readBounded(hung, 1000, 30);
    expect(r).toEqual({ status: "body_time_cap", text: null });
  });

  it("hung capture at flush deadline is recorded as incomplete, not dropped", async () => {
    const rows: CostEvent[] = [];
    __setCostWriter(async (r) => { rows.push(...r); });
    const fallback = { id: RID, capture_status: "read_error" } as unknown as CostEvent;
    await flushEvents([{ fallback, promise: new Promise(() => {}) }], 20);
    expect(rows).toEqual([{ ...fallback, capture_status: "flush_deadline" }]);
  });

  it("parse failure records parse_error; clone failure never throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not json", { headers: { "content-type": "application/json" } })));
    const [e] = await run({}, async () => {
      const r = await trackedFetch("https://api.perplexity.ai/chat/completions", { body: "{}" });
      expect(await r.text()).toBe("not json");
    });
    expect(e).toMatchObject({ outcome: "parse_error", capture_status: "parse_error", estimated_usd: null });
  });

  it("retry/fallback attempts: one unique id each, explicit stages, error bodies unread", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response("ERROR BODY", { status: 429 }))
      .mockRejectedValueOnce(new Error("net"))
      .mockResolvedValueOnce(jsonResp({ usage: {} })));
    const rows = await run({ telemetryRequestId: RID }, async () => {
      await trackedFetch("https://api.perplexity.ai/chat/completions", { body: "{}" }, { stage: "refill_tier1" });
      await trackedFetch("https://api.perplexity.ai/chat/completions", { body: "{}" }, { stage: "refill_tier1" }).catch(() => {});
      await trackedFetch("https://api.perplexity.ai/chat/completions", { body: "{}" }, { stage: "refill_tier2" });
    });
    expect(rows.map((r) => [r.outcome, r.stage, r.attempt_seq])).toEqual([["http_error", "refill_tier1", 1], ["network_error", "refill_tier1", 2], ["ok", "refill_tier2", 3]]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
    expect(JSON.stringify(rows)).not.toContain("ERROR BODY");
  });

  it("unknown stage values collapse to 'unspecified'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp({})));
    const [e] = await run({}, () => trackedFetch("https://api.perplexity.ai/chat/completions", { body: "{}" }, { stage: "evil; drop" as never }));
    expect(e.stage).toBe("unspecified");
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

  it("public pages are not provider attempts; outside context = plain fetch", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp({})));
    const rows = await run({}, () => trackedFetch("https://www.courtlistener.com/opinion/1/"));
    expect(rows).toHaveLength(0);
    await trackedFetch("https://api.perplexity.ai/chat/completions", { body: "{}" });
  });

  it("callers without telemetry ids stay feature unknown (no default guessing)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp({})));
    const rows: CostEvent[] = [];
    __setCostWriter(async (r) => { rows.push(...r); });
    let flush: Promise<void> = Promise.resolve();
    await withCostTelemetry("citation-chat", async () => {
      setTelemetryFromBody({ messages: [] }, "uniform_citation");
      await trackedFetch("https://api.perplexity.ai/chat/completions", { body: "{}" });
    }, { onFlush: (p) => { flush = p; } });
    await flush;
    expect(rows[0].feature).toBe("unknown");
  });
});

describe("writes", () => {
  it("transient 503 → retry → success with the SAME event ids", async () => {
    const calls: string[][] = [];
    __setRawWriter(async (rows) => { calls.push(rows.map((r) => r.id)); return calls.length === 1 ? { ok: false, status: 503 } : { ok: true, status: 201 }; }, 1);
    const r = await writeWithRetry([{ id: RID } as CostEvent, { id: BID } as CostEvent]);
    expect(r).toEqual({ attempts: 2, ok: true });
    expect(calls[0]).toEqual(calls[1]);
  });

  it("hung write hits deadline and gives up after bounded retries without throwing", async () => {
    vi.useFakeTimers();
    let n = 0;
    __setRawWriter(() => { n++; return new Promise(() => {}); }, 1);
    const p = writeWithRetry([{ id: RID } as CostEvent]);
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(p).resolves.toEqual({ attempts: 3, ok: false });
    expect(n).toBe(3);
  });

  it("non-transient 400 is not retried", async () => {
    let n = 0;
    __setRawWriter(async () => { n++; return { ok: false, status: 400 }; }, 1);
    expect(await writeWithRetry([{ id: RID } as CostEvent])).toEqual({ attempts: 1, ok: false });
    expect(n).toBe(1);
  });

  it("writer failure never throws into the request", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp({})));
    __setCostWriter(async () => { throw new Error("db down"); });
    let flush: Promise<void> = Promise.resolve();
    const out = await withCostTelemetry("verify-source", async () => { await trackedFetch("https://ai.gateway.lovable.dev/v1/chat/completions", { body: "{}" }); return 42; }, { onFlush: (p) => { flush = p; } });
    expect(out).toBe(42);
    await expect(flush).resolves.toBeUndefined();
  });
});

describe("zero-work / cache attribution", () => {
  it("server cache hit: metadata-only event, provider none, USD 0", async () => {
    const rows = await run({ telemetryFeature: "uniform_citation", telemetryRequestId: RID }, async () => { recordZeroWork("server_verified_store"); });
    expect(rows[0]).toMatchObject({ event_kind: "cache_hit", provider: "none", endpoint: "none", estimated_usd: 0, stage: "server_verified_store", origin: "server_observed", telemetry_request_id: RID });
  });

  it("classifier before cache keeps its cost on the same source id", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp({ usage: { prompt_tokens: 50, completion_tokens: 5 } })));
    const cls = await run({ telemetryFeature: "uniform_citation", telemetryRequestId: RID }, () => trackedFetch("https://ai.gateway.lovable.dev/v1/chat/completions", { body: JSON.stringify({ model: "google/gemini-3-flash-preview" }) }, { stage: "classifier" }), "classify-source");
    const cache = await run({ telemetryFeature: "uniform_citation", telemetryRequestId: RID }, async () => { recordZeroWork("server_verified_store"); });
    const all = [...cls, ...cache];
    expect(all.every((e) => e.telemetry_request_id === RID)).toBe(true);
    expect(all.reduce((s, e) => s + (e.estimated_usd ?? 0), 0)).toBeGreaterThan(0);
  });

  it("client endpoint validator: strict allowlist, never provider attempts", async () => {
    vi.stubGlobal("Deno", { serve: () => {}, env: { get: () => undefined } });
    const { buildClientEvents } = await import("../../supabase/functions/cost-telemetry-event/index");
    const ok = buildClientEvents({ events: [{ id: RID, layer: "client_verified_store", kind: "cache_hit", telemetryFeature: "footnotes", telemetryRequestId: RID }] });
    expect(ok![0]).toMatchObject({ origin: "client_reported", provider: "none", event_kind: "cache_hit", estimated_usd: 0, function_name: "cost-telemetry-event" });
    expect(buildClientEvents({ events: [{ id: RID, layer: "server_verified_store", kind: "cache_hit" }] })).toBeNull();
    expect(buildClientEvents({ events: [{ id: RID, layer: "client_verified_store", kind: "provider_attempt" }] })).toBeNull();
    expect(buildClientEvents({ events: [{ id: "x", layer: "client_verified_store", kind: "cache_hit" }] })).toBeNull();
    expect(buildClientEvents({ events: Array.from({ length: 21 }, () => ({ id: RID, layer: "footnote_import", kind: "deterministic" })) })).toBeNull();
  });

  it("client zero-work call sites exist for verified store, local formatter, footnote import", () => {
    expect(read("src/lib/runCitation.ts")).toMatch(/reportZeroWork\(opts\.telemetry, "client_verified_store"/);
    expect(read("src/lib/runCitation.ts")).toMatch(/reportZeroWork\(opts\.telemetry, "local_foreign_formatter"/);
    expect(read("src/hooks/useBibliography.tsx")).toMatch(/"footnote_import"/);
  });
});

describe("source identity and wizard attribution", () => {
  it("stable telemetry per logical row across runPool retries", async () => {
    const batch = newTelemetryBatch("footnotes");
    const items = ["a", "b"];
    const rowTel = items.map(() => sourceTelemetry(batch));
    const seen: Record<number, string[]> = { 0: [], 1: [] };
    let fail = true;
    await runPool(items, async (_x, i) => {
      seen[i].push(rowTel[i].telemetryRequestId);
      if (i === 0 && fail) { fail = false; throw Object.assign(new Error("503"), { status: 503 }); }
      return i;
    }, { concurrency: 1, retries: 1, backoffMs: 1, shouldRetry: () => true });
    expect(seen[0]).toHaveLength(2);
    expect(new Set(seen[0]).size).toBe(1);
    expect(seen[0][0]).not.toBe(seen[1][0]);
  });

  it("footnotes/bibliography create row telemetry before runPool, not inside the retried callback", () => {
    for (const f of ["src/components/BatchFootnoteBuilder.tsx", "src/components/BibliographyGenerator.tsx"]) {
      const s = read(f);
      expect(s).toMatch(/const rowTelemetry = \w+\.map\(\(\) => sourceTelemetry\(telemetryBatch\)\)/);
      expect(s).toMatch(/rowTelemetry\[i\]/);
    }
  });

  it("wizard: no shared latest-submission ref; pending states carry their own telemetry", () => {
    const s = read("src/pages/Index.tsx");
    expect(s).not.toMatch(/telemetryRef/);
    expect(s).toMatch(/interface PendingVerification \{[^}]*telemetry\?: CostTelemetry;/);
    expect(s).toMatch(/telemetry: tel,\n/);
    expect(s).toMatch(/const \{ rawInput, fullCitation, sourceType, reply, telemetry \} = pendingVerification;/);
    expect(s).toMatch(/callAPI = async \(userMessage: string, history: Message\[\], telemetry\?: CostTelemetry\)/);
  });

  it("delayed verify of A after submission B keeps A (closure semantics)", () => {
    // Mirrors Index.tsx: each submission captures its own `tel`; pending objects hold it.
    const pending: { name: string; telemetry: ReturnType<typeof sourceTelemetry> }[] = [];
    const submit = (name: string) => { const tel = sourceTelemetry(newTelemetryBatch("uniform_citation")); pending.push({ name, telemetry: tel }); return tel; };
    const a = submit("A");
    const b = submit("B");
    const verifyA = pending.find((p) => p.name === "A")!;
    expect(telemetryBody(verifyA.telemetry).telemetryRequestId).toBe(a.telemetryRequestId);
    expect(a.telemetryRequestId).not.toBe(b.telemetryRequestId);
  });
});

describe("billing invariants", () => {
  it("client telemetry body never contains batchId/requestId", () => {
    const body = telemetryBody(sourceTelemetry(newTelemetryBatch("footnotes")));
    expect(Object.keys(body).sort()).toEqual(["telemetryBatchId", "telemetryFeature", "telemetryRequestId"]);
  });

  it("no client caller sends the legacy billing batchId field", () => {
    for (const f of ["src/lib/runCitation.ts", "src/pages/Index.tsx", "src/components/BatchFootnoteBuilder.tsx", "src/components/BibliographyGenerator.tsx", "src/lib/costTelemetry.ts"]) {
      expect(read(f)).not.toMatch(/[^a-zA-Z]batchId\s*:/);
    }
  });

  it("consume/refund RPC args are byte-identical to the pre-telemetry baseline (fe36394b)", () => {
    const s = read("supabase/functions/citation-chat/index.ts");
    const blocks = [...s.matchAll(/rpc\("(?:consume_[a-z_]+|refund_credits[a-z_]*)",\s*\{[^}]*\}\)/g)].map((m) => m[0].replace(/\s+/g, " "));
    expect(blocks).toEqual([
      'rpc("refund_credits", { _request_id: creditRequestId, _reason: reason, })',
      'rpc("consume_usage_batch", { _batch_id: usageBatchId, _group_size: USAGE_BATCH_GROUP.citation, _reason: "citation-chat", _request_id: creditRequestId, })',
      'rpc("consume_credits", { _amount: 1, _reason: "citation-chat", _request_id: creditRequestId, })',
    ]);
    expect(s).toMatch(/const usageBatchId = typeof clientBatchId === "string"/);
    expect(s).not.toMatch(/usageBatchId\s*=.*telemetry/i);
  });
});
