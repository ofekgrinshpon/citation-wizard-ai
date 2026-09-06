// secondary_body_acquisition_timeout_guard_v1 — PDF extraction never uses the
// blocking whole-document extractor.
import { describe, expect, it, vi, beforeEach } from "vitest";

// jsdom lacks AbortSignal.timeout
if (typeof (AbortSignal as unknown as { timeout?: unknown }).timeout !== "function") {
  (AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout = () =>
    new AbortController().signal;
}

const extractDocumentText = vi.fn(async () => "WHOLE DOCUMENT TEXT ".repeat(200));
const extractPdfPagesBounded = vi.fn(async () => ({
  text: "טקסט מאמר אקדמי ".repeat(400),
  total_pages: 30,
  pages_attempted: 5,
  pages_extracted: 5,
  first_page_extracted: 1,
  last_page_extracted: 5,
  chars_extracted: 6400,
  stopped_reason: "enough_text" as const,
  latency_ms: 900,
}));

vi.mock("../../supabase/functions/legal-research-v1/lib/attachments.ts", () => ({
  extractDocumentText,
}));
vi.mock("../../supabase/functions/legal-research-v1/lib/largePdfChunkedExtract.ts", () => ({
  extractPdfPagesBounded,
}));

const officialFetch = vi.fn();
vi.mock("../../supabase/functions/legal-research-v1/lib/officialFetch.ts", async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, officialFetch };
});

const { fetchSecondaryBody } = await import(
  "../../supabase/functions/legal-research-v1/stages/secondaryBodyAcquisition.ts"
);

function response(bytes: Uint8Array, contentType: string, url: string) {
  let sent = false;
  return {
    ok: true,
    status: 200,
    url,
    headers: new Headers({ "content-type": contentType }),
    body: {
      getReader: () => ({
        read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: bytes })),
        cancel: async () => {},
      }),
      cancel: async () => {},
    },
  } as unknown as Response;
}

function pdfBytes(size: number): Uint8Array {
  const b = new Uint8Array(size);
  const head = new TextEncoder().encode("%PDF-1.7\n");
  b.set(head, 0);
  b.fill(65, head.length);
  return b;
}

const HUJI = "https://lawjournal.huji.ac.il/sites/default/files/article.pdf";

describe("secondary PDF extraction guard", () => {
  beforeEach(() => {
    extractDocumentText.mockClear();
    extractPdfPagesBounded.mockClear();
    officialFetch.mockReset();
  });

  it("routes a mid-size PDF below the old inline cap to the bounded extractor", async () => {
    officialFetch.mockResolvedValue(response(pdfBytes(819_000), "application/pdf", HUJI));
    const stages: Array<[string, Record<string, unknown> | undefined]> = [];
    const r = await fetchSecondaryBody(HUJI, () => false, (n, d) => { stages.push([n, d]); });
    expect(r.extraction_method).toBe("pdf");
    expect(extractPdfPagesBounded).toHaveBeenCalledTimes(1);
    expect(extractDocumentText).not.toHaveBeenCalled();
    const guard = stages.filter(([n]) => n === "secondary_pdf_extraction_guard");
    expect(guard.map(([, d]) => d?.phase)).toEqual(["start", "finish"]);
    expect(guard[0][1]?.old_path_would_have_been_inline).toBe(true);
    expect(guard[1][1]?.extractor_used).toBe("bounded_page_by_page");
    expect(guard[1][1]?.accepted).toBe(true);
    expect(guard[1][1]?.stop_reason).toBe("enough_text");
    expect(typeof guard[1][1]?.latency_ms).toBe("number");
  });

  it("routes a large PDF above the old inline cap to the bounded extractor too", async () => {
    officialFetch.mockResolvedValue(response(pdfBytes(1_800_000), "application/pdf", HUJI));
    const r = await fetchSecondaryBody(HUJI, () => false, () => {});
    expect(r.extraction_method).toBe("pdf");
    expect(extractPdfPagesBounded).toHaveBeenCalledTimes(1);
    expect(extractDocumentText).not.toHaveBeenCalled();
  });

  it("fails closed on a malformed PDF and still writes finish telemetry", async () => {
    extractPdfPagesBounded.mockRejectedValueOnce(new Error("InvalidPDFException"));
    officialFetch.mockResolvedValue(response(pdfBytes(400_000), "application/pdf", HUJI));
    const stages: Array<[string, Record<string, unknown> | undefined]> = [];
    await expect(
      fetchSecondaryBody(HUJI, () => false, (n, d) => { stages.push([n, d]); }),
    ).rejects.toThrow(/bounded_extraction_failed/);
    const guard = stages.filter(([n]) => n === "secondary_pdf_extraction_guard");
    expect(guard.map(([, d]) => d?.phase)).toEqual(["start", "failed"]);
    expect(guard[1][1]?.accepted).toBe(false);
    expect(extractDocumentText).not.toHaveBeenCalled();
  });

  it("fails closed when the bounded extractor yields no text", async () => {
    extractPdfPagesBounded.mockResolvedValueOnce({
      text: "",
      total_pages: 4,
      pages_attempted: 4,
      pages_extracted: 0,
      first_page_extracted: null,
      last_page_extracted: null,
      chars_extracted: 0,
      stopped_reason: "document_end" as never,
      latency_ms: 50,
    });
    officialFetch.mockResolvedValue(response(pdfBytes(120_000), "application/pdf", HUJI));
    await expect(fetchSecondaryBody(HUJI, () => false, () => {})).rejects.toThrow(
      /no_extractable_text/,
    );
  });

  it("leaves non-PDF HTML on the normal decode path", async () => {
    const html = new TextEncoder().encode(
      "<html><body><p>" + "מאמר אקדמי על עילת הסבירות ".repeat(200) + "</p></body></html>",
    );
    officialFetch.mockResolvedValue(
      response(html, "text/html; charset=utf-8", "https://example.ac.il/a"),
    );
    const stages: string[] = [];
    const r = await fetchSecondaryBody(
      "https://example.ac.il/a",
      () => false,
      (n) => { stages.push(n); },
    );
    expect(r.extraction_method).toBe("html");
    expect(extractPdfPagesBounded).not.toHaveBeenCalled();
    expect(extractDocumentText).not.toHaveBeenCalled();
    expect(stages).not.toContain("secondary_pdf_extraction_guard");
  });

  it("refuses before extraction when the extraction budget is spent", async () => {
    officialFetch.mockResolvedValue(response(pdfBytes(819_000), "application/pdf", HUJI));
    const stages: Array<[string, Record<string, unknown> | undefined]> = [];
    await expect(
      fetchSecondaryBody(HUJI, () => false, (n, d) => { stages.push([n, d]); }, () => false),
    ).rejects.toThrow(/budget_spent/);
    const guard = stages.filter(([n]) => n === "secondary_pdf_extraction_guard");
    expect(guard).toHaveLength(1);
    expect(guard[0][1]?.phase).toBe("refused");
    expect(extractPdfPagesBounded).not.toHaveBeenCalled();
  });
});

describe("literature completeness cannot reach the blocking extractor", () => {
  it("secondaryBodyAcquisition sends every PDF to the bounded extractor", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(
        "supabase/functions/legal-research-v1/stages/secondaryBodyAcquisition.ts",
        "utf8",
      )
    );
    // The only extractDocumentText call left is the DOCX branch.
    const calls = [...src.matchAll(/extractDocumentText\(([^)]*)\)/g)].map((m) => m[1]);
    expect(calls).toEqual(['bytes, "docx"']);
  });
});
