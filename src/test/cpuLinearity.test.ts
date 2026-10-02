import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import {
  matchSpan, createSpanMatcher, normalizeForMatch, denseForm, MIN_SPAN_CHARS,
} from "../../supabase/functions/legal-research-v2/verification/spanMatch";

/** Verbatim copy of the pre-change matchSpan, used as the equality oracle. */
function originalMatchSpan(body: string, span: string) {
  const raw = (span ?? "").trim();
  if (normalizeForMatch(raw).length < MIN_SPAN_CHARS) {
    return { status: "too_short", matched: false, verified_span: raw, detail: `span shorter than ${MIN_SPAN_CHARS} normalized chars` };
  }
  const text = body ?? "";
  if (text.includes(raw)) return { status: "exact", matched: true, verified_span: raw, detail: "exact substring" };
  if (normalizeForMatch(text).includes(normalizeForMatch(raw))) {
    return { status: "normalized", matched: true, verified_span: raw, detail: "matched after unicode/whitespace normalization" };
  }
  const dSpan = denseForm(raw);
  if (dSpan.length >= MIN_SPAN_CHARS && denseForm(text).includes(dSpan)) {
    return { status: "dense", matched: true, verified_span: raw, detail: "matched after punctuation-insensitive comparison (extraction noise)" };
  }
  return { status: "not_found", matched: false, verified_span: raw, detail: "span not present in the fetched body" };
}

const body = 'בית המשפט קבע כי "הלכת השיתוף חלה גם על נכסים שנרכשו לפני הנישואין", וזאת בכפוף\u200f לנסיבות. שָׁלוֹם   עולם — Café ﬁnal';
const spans = [
  "הלכת השיתוף חלה גם על נכסים שנרכשו לפני הנישואין", // exact
  "הלכת   השיתוף חלה גם על נכסים שנרכשו לפני הנישואין", // normalized
  "הלכת השיתוף, חלה גם על נכסים - שנרכשו לפני הנישואין", // dense
  "חזקת השיתוף חלה על כל הנכסים ללא יוצא מן הכלל", // missing
  "בית המשפט", // short
  "", // empty
  "  בכפוף לנסיבות. שלום עולם - Cafe\u0301 final  ", // mixed unicode/whitespace
];

describe("prepared span matcher equals the original", () => {
  it("matches every case, standalone and through one pass-scoped matcher", () => {
    const m = createSpanMatcher();
    for (const s of spans) {
      const want = originalMatchSpan(body, s);
      expect(matchSpan(body, s)).toEqual(want);
      expect(m(body, s)).toEqual(want);
      expect(m(body, s)).toEqual(want); // repeated source reuse
      expect(m("", s)).toEqual(originalMatchSpan("", s));
    }
  });

  it("changed text never reuses stale normalized forms", () => {
    const m = createSpanMatcher();
    const s = spans[2];
    expect(m(body, s).matched).toBe(true);
    const changed = body.replace("שנרכשו", "שנמכרו");
    expect(m(changed, s)).toEqual(originalMatchSpan(changed, s));
    expect(m(changed, s).matched).toBe(false);
  });

  it("verify.ts uses one matcher per verifyMemo pass", async () => {
    const src = (await import("node:fs")).readFileSync("supabase/functions/legal-research-v2/verification/verify.ts", "utf8");
    const fn = src.slice(src.indexOf("export async function verifyMemo"));
    expect(fn.indexOf("createSpanMatcher()")).toBeLessThan(fn.indexOf("for (const claim of opts.memo.claims)"));
  });
});

// ---------------- SSE framing ----------------
const env: Record<string, string> = { LOVABLE_API_KEY: "test-key-not-real" };
beforeAll(() => { (globalThis as any).Deno = { env: { get: (k: string) => env[k] } }; });
let model: typeof import("../../supabase/functions/legal-research-v2/shared/model");
beforeAll(async () => { model = await import("../../supabase/functions/legal-research-v2/shared/model"); });
afterEach(() => { vi.restoreAllMocks(); delete env.V2_REASONING_REPLAY; });

const enc = new TextEncoder();
const frame = (e: unknown, nl = "\n") => `data: ${JSON.stringify(e)}${nl}${nl}`;
const done = (item: unknown) => ({ type: "response.output_item.done", item });
const completed = { type: "response.completed", response: { usage: { input_tokens: 9, output_tokens: 3 } } };
const base = [{ role: "system" as const, content: "s" }, { role: "user" as const, content: "q" }];

function byteStream(text: string, size: number) {
  const bytes = enc.encode(text);
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new ReadableStream<Uint8Array>({
    start(c) { for (let i = 0; i < bytes.length; i += size) c.enqueue(bytes.slice(i, i + size)); c.close(); },
  }), { status: 200 }));
}

describe("incremental SSE framing", () => {
  it("512k newline-free reasoning frame in 256-byte chunks keeps order and payload", async () => {
    env.V2_REASONING_REPLAY = "1";
    const blob = "x".repeat(512_000);
    const s = frame(done({ type: "reasoning", id: "r1", encrypted_content: blob })) +
      frame(done({ type: "function_call", call_id: "a", name: "search", arguments: '{"q":"א"}' })) +
      ": comment\nevent: ignored\n" + frame(completed);
    byteStream(s, 256);
    const res: any = await model.chat({ model: "openai/gpt-6-astra", messages: base, replayReasoning: true });
    expect(res.ok).toBe(true);
    expect(res.reasoning_items[0].encrypted_content.length).toBe(512_000);
    expect(res.replay_seq).toEqual(["r", "c:a"]);
    expect(res.tool_calls[0].arguments).toBe('{"q":"א"}');
    expect(res.prompt_tokens).toBe(9);
  });

  it("CRLF + split UTF-8 + multiline data at every chunk size equals whole-stream output", async () => {
    const s = frame({ type: "response.output_text.delta", delta: "שלום 😀" }, "\r\n") +
      `data: {"type":"response.output_text.delta",\r\ndata: "delta":"ב"}\r\n\r\n` + frame(completed, "\r\n");
    byteStream(s, 1 << 20);
    const want = await model.chat({ model: "openai/gpt-6-astra", messages: base });
    for (const size of [1, 2, 3, 5, 7, 64]) {
      vi.restoreAllMocks();
      byteStream(s, size);
      const got = await model.chat({ model: "openai/gpt-6-astra", messages: base });
      expect(got.content).toBe(want.content);
      expect(got.ok).toBe(true);
    }
    expect(want.content).toBe("שלום 😀ב");
  });

  it("EOF tail without blank line still dispatches; no terminal stays non-success", async () => {
    byteStream(`data: ${JSON.stringify(completed)}`, 5);
    expect((await model.chat({ model: "openai/gpt-6-astra", messages: base })).ok).toBe(true);
    vi.restoreAllMocks();
    byteStream(frame(done({ type: "function_call", call_id: "a", name: "s", arguments: "{}" })), 3);
    const r = await model.chat({ model: "openai/gpt-6-astra", messages: base });
    expect(r.ok).toBe(false);
    expect(r.tool_calls ?? []).toEqual([]);
  });

  it("scaling is roughly linear (4x data, well under 16x time)", async () => {
    const run = async (n: number) => {
      const s = frame(done({ type: "reasoning", id: "r", encrypted_content: "y".repeat(n) })) + frame(completed);
      vi.restoreAllMocks();
      byteStream(s, 256);
      const t = performance.now();
      await model.chat({ model: "openai/gpt-6-astra", messages: base });
      return performance.now() - t;
    };
    await run(64_000);
    const small = await run(128_000);
    const big = await run(512_000);
    console.log(`[bench] sse 128k=${small.toFixed(1)}ms 512k=${big.toFixed(1)}ms ratio=${(big / small).toFixed(2)}`);
    expect(big / small).toBeLessThan(10);
  });
});
