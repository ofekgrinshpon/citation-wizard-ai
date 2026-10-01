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

describe("provider-pending liveness", () => {
  it("beats while a long call is active, only for its own run, and stops on done", async () => {
    vi.useFakeTimers();
    const a = vi.fn(), b = vi.fn();
    const limits = { KEEPALIVE_MS: 30, INACTIVITY_MS: 1000, ABSOLUTE_MS: 5000 };
    let ga: ReturnType<typeof guardProviderCall> | null = null;
    await withProviderLiveness(a, async () => { ga = guardProviderCall(undefined, limits); });
    await withProviderLiveness(b, async () => { /* other run idle */ });
    for (let i = 0; i < 5; i++) { vi.advanceTimersByTime(30); ga!.touch(); }
    expect(a.mock.calls.length).toBe(5);
    expect(b).not.toHaveBeenCalled();
    ga!.done();
    vi.advanceTimersByTime(300);
    expect(a.mock.calls.length).toBe(5);
  });

  it("a stuck call aborts on inactivity and stops renewing", async () => {
    vi.useFakeTimers();
    const beat = vi.fn();
    let g: ReturnType<typeof guardProviderCall> | null = null;
    await withProviderLiveness(beat, async () => { g = guardProviderCall(undefined, { KEEPALIVE_MS: 10, INACTIVITY_MS: 50, ABSOLUTE_MS: 1000 }); });
    vi.advanceTimersByTime(60);
    expect(g!.signal.aborted).toBe(true);
    const n = beat.mock.calls.length;
    vi.advanceTimersByTime(500);
    expect(beat.mock.calls.length).toBe(n);
  });

  it("absolute cap ends even an active stream", async () => {
    vi.useFakeTimers();
    const g = guardProviderCall(undefined, { KEEPALIVE_MS: 10, INACTIVITY_MS: 50, ABSOLUTE_MS: 200 });
    for (let i = 0; i < 30; i++) { vi.advanceTimersByTime(10); g.touch(); }
    expect(g.signal.aborted).toBe(true);
  });

  it("propagates outer abort", () => {
    const c = new AbortController();
    const g = guardProviderCall(c.signal);
    c.abort();
    expect(g.signal.aborted).toBe(true);
    g.done();
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
