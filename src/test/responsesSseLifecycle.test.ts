import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";

const env: Record<string, string> = { LOVABLE_API_KEY: "test-key-not-real" };
beforeAll(() => { (globalThis as any).Deno = { env: { get: (k: string) => env[k] } }; });
let m: typeof import("../../supabase/functions/legal-research-v2/shared/model");
beforeAll(async () => { m = await import("../../supabase/functions/legal-research-v2/shared/model"); });
afterEach(() => { vi.restoreAllMocks(); delete env.V2_REASONING_REPLAY; });

const enc = new TextEncoder();
const frame = (e: unknown) => `data: ${JSON.stringify(e)}\n\n`;
const done = (item: unknown) => ({ type: "response.output_item.done", item });
const completed = { type: "response.completed", response: { usage: { input_tokens: 100, output_tokens: 7, input_tokens_details: { cached_tokens: 40 } } } };
const base = [{ role: "system" as const, content: "s" }, { role: "user" as const, content: "q" }];
const call = (id: string) => done({ type: "function_call", call_id: id, name: "search", arguments: `{"q":"${id}"}` });

/** Stream of raw string chunks; optionally never closes (simulates no EOF). */
function stream(chunks: string[], close = true) {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(c) { for (const s of chunks) c.enqueue(enc.encode(s)); if (close) c.close(); },
    cancel() { cancelled = true; },
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(body, { status: 200 }));
  return { wasCancelled: () => cancelled };
}

describe("Responses SSE lifecycle", () => {
  it("finalizes on terminal event without waiting for EOF and cancels the reader", async () => {
    const s = stream([frame(call("a")), frame(completed)], false);
    const res = await m.chat({ model: "openai/gpt-6-astra", messages: base, tools: [{ name: "search", description: "", parameters: {} } as any] });
    expect(res.ok).toBe(true);
    expect(res.tool_calls.map((t) => t.id)).toEqual(["a"]);
    expect(res.prompt_tokens).toBe(100);
    expect(res.completion_tokens).toBe(7);
    expect(s.wasCancelled()).toBe(true);
  });

  it("terminal followed by normal EOF succeeds", async () => {
    stream([frame({ type: "response.output_text.delta", delta: "hi" }), frame(completed)]);
    const res = await m.chat({ model: "openai/gpt-6-astra", messages: base });
    expect(res.ok).toBe(true);
    expect(res.content).toBe("hi");
    expect(res.finish_reason).toBe("stop");
  });

  it("premature EOF fails and exposes no partial tool calls", async () => {
    stream([frame(call("a"))]);
    const res = await m.chat({ model: "openai/gpt-6-astra", messages: base });
    expect(res.ok).toBe(false);
    expect(res.terminal).toBe(false);
    expect(res.tool_calls ?? []).toEqual([]);
    expect(res.error).toContain("eof_without_terminal_event");
  });

  it("response.failed is an explicit failure", async () => {
    stream([frame(call("a")), frame({ type: "response.failed", response: { error: { code: "server_error" } } })], false);
    const res = await m.chat({ model: "openai/gpt-6-astra", messages: base });
    expect(res.ok).toBe(false);
    expect(res.tool_calls ?? []).toEqual([]);
  });

  it("response.incomplete is non-success with no executable tool calls but truthful usage", async () => {
    stream([frame(call("a")), frame({ type: "response.output_text.delta", delta: "x" }), frame({ type: "response.incomplete", response: { usage: { input_tokens: 5, output_tokens: 1 } } })], false);
    const usage: any = { model_calls: 0, prompt_tokens: 0, completion_tokens: 0, prompt_tokens_per_call: [], max_prompt_tokens_single_call: 0 };
    const res = await m.chat({ model: "openai/gpt-6-astra", messages: base, usage });
    expect(res.ok).toBe(false);
    expect(res.tool_calls).toEqual([]);
    expect(res.content).toBe("");
    expect(res.finish_reason).toBe("length");
    expect(res.prompt_tokens).toBe(5);
    expect(usage.model_calls).toBe(1);
    expect(usage.completion_tokens).toBe(1);
  });

  function lockedBody(chunks: string[], opts: { cancel?: () => Promise<void>; readError?: Error }) {
    const st = { released: false };
    const reader: any = {
      i: 0,
      read: async () => {
        if (opts.readError) throw opts.readError;
        return reader.i < chunks.length ? { done: false, value: enc.encode(chunks[reader.i++]) } : new Promise(() => {});
      },
      cancel: opts.cancel ?? (async () => {}),
      releaseLock: () => { st.released = true; },
    };
    const resp: any = { ok: true, status: 200, headers: new Headers(), body: { getReader: () => reader } };
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => resp);
    return st;
  }

  it("never-settling cancel does not block a successful terminal result", async () => {
    const st = lockedBody([frame(completed)], { cancel: () => new Promise(() => {}) });
    const res = await m.chat({ model: "openai/gpt-6-astra", messages: base });
    expect(res.ok).toBe(true);
    expect(st.released).toBe(true);
  });

  it("rejected cancel is swallowed without unhandled rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const st = lockedBody([frame(completed)], { cancel: () => Promise.reject(new Error("cancel boom")) });
    const res = await m.chat({ model: "openai/gpt-6-astra", messages: base });
    await new Promise((r) => setTimeout(r, 10));
    process.off("unhandledRejection", unhandled);
    expect(res.ok).toBe(true);
    expect(st.released).toBe(true);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("read error rethrows original error and releases the lock", async () => {
    const err = new Error("read boom");
    const st = lockedBody([], { readError: err, cancel: () => Promise.reject(new Error("cleanup")) });
    await expect(m.chat({ model: "openai/gpt-6-astra", messages: base })).rejects.toBe(err);
    expect(st.released).toBe(true);
  });

  it("abort during read rethrows AbortError and releases the lock", async () => {
    const err = new DOMException("aborted", "AbortError");
    const st = lockedBody([], { readError: err as any });
    await expect(m.chat({ model: "openai/gpt-6-astra", messages: base })).rejects.toBe(err);
    expect(st.released).toBe(true);
  });

  it("parses frames split across chunks, CRLF and multi-line data", async () => {
    const f = frame(call("a"));
    const multi = `data: {"type":"response.output_text.delta",\r\ndata: "delta":"z"}\r\n\r\n`;
    const c = frame(completed);
    stream([f.slice(0, 7), f.slice(7, 30), f.slice(30), multi.slice(0, 20), multi.slice(20), c.slice(0, 11), c.slice(11)]);
    const res = await m.chat({ model: "openai/gpt-6-astra", messages: base });
    expect(res.ok).toBe(true);
    expect(res.tool_calls.map((t) => t.id)).toEqual(["a"]);
    expect(res.content).toBe("z");
  });

  it("preserves reasoning/function order when replay is on", async () => {
    env.V2_REASONING_REPLAY = "1";
    const r = (id: string) => done({ type: "reasoning", id, encrypted_content: `enc-${id}` });
    stream([frame(r("r1")), frame(call("a")), frame(r("r2")), frame(call("b")), frame(completed)], false);
    const res: any = await m.chat({ model: "openai/gpt-6-astra", messages: base, replayReasoning: true });
    expect(res.ok).toBe(true);
    expect(res.replay_seq).toEqual(["r", "c:a", "r", "c:b"]);
    expect(res.reasoning_items.map((x: any) => x.id)).toEqual(["r1", "r2"]);
  });
});
