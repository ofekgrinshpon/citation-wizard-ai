import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { render } from "@testing-library/react";
import {
  withCostTelemetry, beginAttempt, __setCostWriter, __setDurableWriter, type CostEvent, type WriteMode,
} from "../../supabase/functions/_shared/costTelemetry";
import { guardProviderCall, withProviderLiveness } from "../../supabase/functions/legal-research-v2/shared/providerLiveness";
import { renderAnswerMarkdown } from "@/lib/legalQa/renderAnswerMarkdown";
import { decideAutoScroll } from "@/components/research-chat/ResearchConversationPanel";

const RUN = "11111111-1111-4111-8111-111111111111";
const RUN2 = "22222222-2222-4222-8222-222222222222";
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

beforeAll(() => {
  // deno-lint-ignore no-explicit-any
  (globalThis as any).Deno = { env: { get: () => undefined } };
});
afterEach(() => { __setDurableWriter(null); __setCostWriter(null); vi.useRealTimers(); });

function store() {
  const rows = new Map<string, CostEvent>();
  const log: { id: string; mode: WriteMode; status: string }[] = [];
  const w = async (rs: CostEvent[], mode: WriteMode) => {
    for (const r of rs) {
      log.push({ id: r.id, mode, status: r.capture_status });
      if (mode === "merge" || !rows.has(r.id)) rows.set(r.id, { ...r });
    }
  };
  return { rows, log, w };
}

describe("durable per-attempt telemetry", () => {
  it("persists a completed attempt before the chunk exits, start then final on the same id", async () => {
    const s = store();
    __setDurableWriter(s.w);
    __setCostWriter(async () => {});
    let seenInside = 0;
    await withCostTelemetry("legal-research-v2", async () => {
      const rec = beginAttempt({ provider: "lovable_gateway", endpoint: "responses", requestedModel: "openai/gpt-x", stage: "v2_research_agent" })!;
      rec.headers(200, new Headers());
      rec.finish({ outcome: "ok", capture_status: "complete", complete: true, usage: { input_tokens: 10, output_tokens: 2 } as never });
      await tick(5);
      seenInside = [...s.rows.values()].filter((r) => r.capture_status === "complete").length;
    }, { onFlush: () => {}, init: { feature: "legal_research", requestId: RUN } });
    expect(seenInside).toBe(1);
    expect(s.log.map((l) => l.mode)).toEqual(["ignore", "merge"]);
    expect(new Set(s.log.map((l) => l.id)).size).toBe(1);
  });

  it("simulated restart: chunk never flushes, prior completed events survive; unfinished one leaves a start row", async () => {
    const s = store();
    __setDurableWriter(s.w);
    await withCostTelemetry("legal-research-v2", async () => {
      const a = beginAttempt({ provider: "lovable_gateway", endpoint: "responses", requestedModel: "m", stage: "v2_research_agent" })!;
      a.finish({ outcome: "ok", capture_status: "complete", complete: true });
      beginAttempt({ provider: "lovable_gateway", endpoint: "responses", requestedModel: "m", stage: "v2_research_agent" });
      await tick(5);
    }, { onFlush: () => { /* worker killed: chunk flush never runs */ } });
    const st = [...s.rows.values()].map((r) => r.capture_status).sort();
    expect(st).toEqual(["complete", "flush_deadline"]);
  });

  it("a late fallback/start write never overwrites completed data", async () => {
    const s = store();
    __setDurableWriter(s.w);
    let flush: Promise<void> | null = null;
    __setCostWriter(async (rows) => { for (const r of rows) await s.w([r], r.capture_status === "complete" ? "merge" : "ignore"); });
    await withCostTelemetry("x", async () => {
      const a = beginAttempt({ provider: "perplexity", endpoint: "search", requestedModel: null, stage: "v2_sonar_search" })!;
      a.finish({ outcome: "ok", capture_status: "complete", complete: true });
      await tick(5);
      await s.w([{ ...[...s.rows.values()][0], capture_status: "flush_deadline" }], "ignore");
    }, { onFlush: (p) => { flush = p; } });
    await flush;
    expect([...s.rows.values()][0].capture_status).toBe("complete");
    expect(s.rows.size).toBe(1);
  });

  it("concurrent runs keep their own correlation", async () => {
    const s = store();
    __setDurableWriter(s.w);
    const run = (id: string) => withCostTelemetry("legal-research-v2", async () => {
      await tick(1);
      beginAttempt({ provider: "lovable_gateway", endpoint: "responses", requestedModel: "m", stage: "v2_research_agent" })!
        .finish({ outcome: "ok", capture_status: "complete", complete: true });
      await tick(5);
    }, { onFlush: () => {}, init: { requestId: id } });
    await Promise.all([run(RUN), run(RUN2)]);
    const ids = [...s.rows.values()].map((r) => r.telemetry_request_id).sort();
    expect(ids).toEqual([RUN, RUN2]);
  });
});

describe("provider-pending liveness (heartbeat-only)", () => {
  const L = { KEEPALIVE_MS: 30, RENEWAL_WINDOW_MS: 300 };
  it("one beat per cadence, own run only, never aborts a long silent call", async () => {
    vi.useFakeTimers();
    const a = vi.fn(), b = vi.fn();
    const caller = new AbortController();
    let g: ReturnType<typeof guardProviderCall> | null = null;
    await withProviderLiveness(a, async () => { g = guardProviderCall(caller.signal); }, L);
    await withProviderLiveness(b, async () => {}, L);
    vi.advanceTimersByTime(150);
    expect(a.mock.calls.length).toBe(5);
    expect(b).not.toHaveBeenCalled();
    expect(caller.signal.aborted).toBe(false);
    expect(g).not.toHaveProperty("signal");
    g!.done();
  });

  it("deadline is per invocation and not reset by a new attempt; renewal stops without abort", async () => {
    vi.useFakeTimers();
    const beat = vi.fn();
    await withProviderLiveness(beat, async () => {
      const g1 = guardProviderCall();
      vi.advanceTimersByTime(200);
      g1.done();
      const g2 = guardProviderCall();
      vi.advanceTimersByTime(500);
      g2.done();
    }, L);
    expect(beat.mock.calls.length).toBe(9); // 6 + 3 (until t=300), none after
  });

  it("caller abort and done() clear the timer", async () => {
    vi.useFakeTimers();
    const beat = vi.fn();
    const c = new AbortController();
    await withProviderLiveness(beat, async () => { guardProviderCall(c.signal); }, L);
    vi.advanceTimersByTime(30);
    c.abort();
    vi.advanceTimersByTime(200);
    expect(beat.mock.calls.length).toBe(1);
  });

  it("active SSE through chat() is not cancelled by new code", async () => {
    const { chat } = await import("../../supabase/functions/legal-research-v2/shared/model");
    // deno-lint-ignore no-explicit-any
    (globalThis as any).Deno = { env: { get: (k: string) => (k === "LOVABLE_API_KEY" ? "k" : undefined) } };
    let seen: AbortSignal | undefined | null = null;
    const enc = new TextEncoder();
    const orig = globalThis.fetch;
    globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
      seen = init?.signal;
      const body = new ReadableStream({ async start(c) {
        for (let i = 0; i < 3; i++) { await tick(20); c.enqueue(enc.encode(`data: {"type":"response.output_text.delta","delta":"x"}\n\n`)); }
        c.enqueue(enc.encode(`data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1}}}\n\n`));
        c.close();
      } });
      return new Response(body, { status: 200 });
    }) as typeof fetch;
    try {
      const r = await withProviderLiveness(() => {}, () => chat({ model: "openai/gpt-6-astra", messages: [{ role: "user", content: "q" }] }), { KEEPALIVE_MS: 5, RENEWAL_WINDOW_MS: 10 });
      expect(r.ok).toBe(true);
      expect(r.content).toBe("xxx");
      expect(seen).toBeUndefined(); // no injected signal
    } finally { globalThis.fetch = orig; }
  });
});

describe("trackedFetch pre-header start", () => {
  it("start row persists before headers; final reuses the same id", async () => {
    const { trackedFetch } = await import("../../supabase/functions/_shared/costTelemetry");
    const s = store();
    __setDurableWriter(s.w);
    let release!: () => void;
    const orig = globalThis.fetch;
    globalThis.fetch = (() => new Promise<Response>((res) => { release = () => res(new Response("{}", { status: 200, headers: { "content-type": "application/json" } })); })) as typeof fetch;
    try {
      await withCostTelemetry("x", async () => {
        const p = trackedFetch("https://api.perplexity.ai/search", { method: "POST", body: "{}" }, { stage: "v2_sonar_search" });
        await tick(5);
        expect(s.rows.size).toBe(1);
        expect([...s.rows.values()][0].capture_status).toBe("flush_deadline");
        release();
        await p;
        await tick(20);
      }, { onFlush: () => {} });
    } finally { globalThis.fetch = orig; }
    expect(s.rows.size).toBe(1);
    const ids = new Set(s.log.map((l) => l.id));
    expect(ids.size).toBe(1);
    expect([...s.rows.values()][0].capture_status).toBe("complete");
  });
});

describe("completion focus", () => {
  it("uses preventScroll", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/components/research-chat/ResearchConversationPanel.tsx", "utf8")).toContain("focus({ preventScroll: true })");
    expect(readFileSync("src/components/research-chat/ConversationComposer.tsx", "utf8")).toContain("taRef.current?.focus(opts)");
  });
});

describe("answer headings", () => {
  it("renders headings without literal # and keeps text escaped", () => {
    const { container } = render(<div>{renderAnswerMarkdown("## מסגרת **נורמטיבית**\nפסקה <b>x</b>\n#לא כותרת")}</div>);
    const h = container.querySelector('[role="heading"]')!;
    expect(h.textContent).toBe("מסגרת נורמטיבית");
    expect(h.getAttribute("aria-level")).toBe("2");
    expect(container.textContent).not.toContain("## ");
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("#לא כותרת");
  });
});

describe("autoscroll policy", () => {
  const ans = { id: "a2", role: "assistant", kind: "research_answer" };
  it("new answer → its start", () => expect(decideAutoScroll({ seenLastId: "u1", last: ans, atBottom: true })).toBe("answer_start"));
  it("reader scrolled up → no move", () => expect(decideAutoScroll({ seenLastId: "u1", last: ans, atBottom: false })).toBe("none"));
  it("history/back (already seen) → bottom, not answer jump", () => expect(decideAutoScroll({ seenLastId: "a2", last: ans, atBottom: true })).toBe("bottom"));
  it("user message → bottom", () => expect(decideAutoScroll({ seenLastId: "a2", last: { id: "u3", role: "user" }, atBottom: true })).toBe("bottom"));
});
