import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { pdfBoundaryFixture, runPdfBoundaryCheck } from "../../supabase/functions/legal-research-v2/shared/pdfBoundaryCheck";
import type { ChunkedPdfResult } from "../../supabase/functions/_shared/largePdfChunkedExtract";
const env = (key: string): string | undefined => key === "SUPABASE_URL" ? "https://same-project.test" : undefined;
const denied = async () => new Response("", { status: 401 });
const text = "ReLex PDF boundary check";
const result: ChunkedPdfResult = { text, total_pages: 1, pages_attempted: 1, pages_extracted: 1,
  first_page_extracted: 1, last_page_extracted: 1, chars_extracted: text.length,
  stopped_reason: "document_end", latency_ms: 1, pages: [{ page: 1, status: "read", start: 0, end: text.length }] };
describe("fixed internal PDF boundary diagnostic", () => {
  it("builds a fixed small PDF without any input URL or private content", () => {
    const pdf = new TextDecoder().decode(pdfBoundaryFixture());
    expect(pdf.startsWith("%PDF-1.4")).toBe(true); expect(pdf).toContain(text);
    expect(pdf.length).toBeLessThan(1_000); expect(pdf).toContain("startxref");
  });
  it("runs two auth failures, valid PDF, malformed PDF, then valid PDF in the same caller", async () => {
    let calls = 0;
    const out = await runPdfBoundaryCheck({ env, fetch: denied, extract: async () => {
      calls++; if (calls === 2) throw new Error("pdf_boundary_worker_http_422"); return result;
    } });
    expect(out.ok).toBe(true); expect(out.checks).toHaveLength(5); expect(calls).toBe(3);
  });
  it("stops immediately if extraction is unexpectedly public", async () => {
    let calls = 0;
    const out = await runPdfBoundaryCheck({ env, fetch: async () => new Response(""), extract: async () => { calls++; return result; } });
    expect(out.ok).toBe(false); expect(calls).toBe(0);
  });
  it("reports service gateway rejection without a workaround", async () => {
    const out = await runPdfBoundaryCheck({ env, fetch: denied, extract: async () => { throw new Error("pdf_boundary_worker_http_401"); } });
    expect(out.ok).toBe(false); expect(out.checks.at(-1)?.error).toBe("pdf_boundary_worker_http_401");
  });
  it("sanitizes unexpected errors instead of exposing their message", async () => {
    const out = await runPdfBoundaryCheck({ env, fetch: denied, extract: async () => { throw new Error("secret fixture value"); } });
    expect(JSON.stringify(out)).not.toContain("secret fixture value"); expect(out.checks.at(-1)?.error).toBe("boundary_check_failed");
  });
  it("cannot enter provider/DB setup and rejects every extra request field", () => {
    const src = readFileSync("supabase/functions/legal-research-v2/index.ts", "utf8");
    const block = src.slice(src.indexOf("  if (pdfBoundaryCheck) {"), src.indexOf("  const directProvider = parseDirectProvider({"));
    expect(block).toContain('if (!isSmoke) return json({ error: "unauthorized" }, 401)');
    expect(block).toContain('Object.keys(body).some((key) => key !== "action")');
    expect(block).toContain("return json(result, result.ok ? 200 : 502)"); expect(block).not.toContain("createClient");
  });
});
