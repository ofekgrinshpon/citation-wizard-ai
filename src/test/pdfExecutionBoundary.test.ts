import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { extractPdfPagesBounded } from "../../supabase/functions/legal-research-v2/shared/pdfExtractionBoundary";
import { createPdfHandler } from "../../supabase/functions/research-pdf-extract/handler";
import { readBoundedBody } from "../../supabase/functions/_shared/pdfExtractionProtocol";
import { decideAutoResume } from "../../supabase/functions/legal-research-v2/beta/resumePolicy";

const bytes = new TextEncoder().encode("%PDF-fixture");
const bounds = { maxPages: 24, maxChars: 200_000, deadlineMs: 1000 };
const env = (name: string) => ({ SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key" })[name];
const result = {
  text: "מדויק", total_pages: 2, pages_attempted: 2, pages_extracted: 1,
  first_page_extracted: 2, last_page_extracted: 2, chars_extracted: 5,
  stopped_reason: "document_end" as const, latency_ms: 1,
  pages: [{ page: 1, status: "empty" as const, start: 0, end: 0 }, { page: 2, status: "read" as const, start: 0, end: 5 }],
};

describe("isolated PDF boundary", () => {
  it("preserves exact Hebrew and physical page indices without sending a source URL", async () => {
    const value = await extractPdfPagesBounded(bytes, bounds, { env, fetch: async (input, init) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/functions/v1/research-pdf-extract");
      expect(url.searchParams.has("url")).toBe(false);
      expect(init?.body).toBe(bytes);
      const requestId = new Headers(init?.headers).get("x-pdf-request-id");
      return new Response(JSON.stringify({ version: 1, request_id: requestId, result }));
    } });
    expect(value.text).toBe("מדויק");
    expect(value.pages[1].page).toBe(2);
  });

  it.each([404, 408, 422, 429, 500, 546])("fails closed once for worker HTTP %s", async (status) => {
    let calls = 0;
    await expect(extractPdfPagesBounded(bytes, bounds, { env, fetch: async () => {
      calls++; return new Response("", { status });
    } })).rejects.toThrow(`pdf_boundary_worker_http_${status}`);
    expect(calls).toBe(1);
  });

  it("expired outer deadline starts no request", async () => {
    let calls = 0;
    await expect(extractPdfPagesBounded(bytes, { ...bounds, deadlineAt: 0 }, { env, fetch: async () => {
      calls++; throw new Error("unexpected request");
    } })).rejects.toThrow("deadline_exhausted");
    expect(calls).toBe(0);
  });

  it("bounds a hung remote parser and aborts the HTTP request", async () => {
    let signal: AbortSignal | null | undefined;
    await expect(extractPdfPagesBounded(bytes, { ...bounds, deadlineAt: Date.now() + 30 }, { env, fetch: async (_input, init) => {
      signal = init?.signal; return new Promise<Response>(() => {});
    } })).rejects.toThrow("deadline_exhausted");
    expect(signal?.aborted).toBe(true);
  });

  it("rejects malformed or uncorrelated worker output", async () => {
    await expect(extractPdfPagesBounded(bytes, bounds, { env, fetch: async () => new Response(JSON.stringify({ version: 1, request_id: "wrong", result })) })).rejects.toThrow("invalid_response");
  });

  it("cannot hang at an overflow while cancelling a broken body stream", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(2)); },
      cancel() { return new Promise(() => {}); },
    });
    await expect(readBoundedBody(stream, 1)).rejects.toThrow("body_too_large");
  });

  it("authenticates worker requests before parsing", async () => {
    let calls = 0;
    const handler = createPdfHandler(async () => { calls++; return result; }, "synthetic-service-key");
    const response = await handler(new Request("https://fixture/", { method: "POST", body: bytes }));
    expect(response.status).toBe(401);
    expect(calls).toBe(0);
  });

  it("reports stale direct pilots for review without replay or mutation", () => {
    const now = Date.now();
    const row = {
      run_id: "pinned", status: "running", agent_state: { intake: { agent_direct_provider: null }, resume: {} },
      last_beat_at: new Date(now - 240_000).toISOString(), created_at: new Date(now - 300_000).toISOString(),
      auto_resume_count: 0, watchdog_claimed_at: null,
    };
    const before = JSON.stringify(row);
    const decision = decideAutoResume(row, now);
    expect(decision.automatic_resume_triggered).toBe(false);
    expect(decision.automatic_resume_reason).toBe("direct_pilot_requires_review");
    expect(decision.manual_resume_required).toBe(true);
    expect(JSON.stringify(row)).toBe(before);
  });

  it("keeps all four V2 acquisition routes behind the boundary", () => {
    const read = (path: string) => readFileSync(`supabase/functions/${path}`, "utf8");
    expect(read("legal-research-v2/shared/primitives.ts")).toContain('from "./pdfExtractionBoundary.ts"');
    expect(read("legal-research-v2/evidence/userDocumentSources.ts")).toContain("extractPdfPages: async (bytes, deadlineAt)");
    expect(read("legal-research-v2/tools/fetch.ts")).toContain("await continuePdfRead(store, src, input, opts)");
    expect(read("legal-research-v2/tools/fetch.ts")).toContain("await extractByContentType(finalPdfUrl, pdfCt, pdfBuf, { signal: controller.signal, deadlineAt })");
  });
});
