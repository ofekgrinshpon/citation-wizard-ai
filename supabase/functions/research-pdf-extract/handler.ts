import { PDF_BOUNDARY, hasPdfHeader, readBoundedBody, validPdfBounds, type PdfBounds } from "../_shared/pdfExtractionProtocol.ts";
import type { ChunkedPdfOptions, ChunkedPdfResult } from "../_shared/largePdfChunkedExtract.ts";

type Parser = (bytes: Uint8Array, options: ChunkedPdfOptions) => Promise<ChunkedPdfResult>;
export function createPdfHandler(parse: Parser, serviceKey: string | undefined) {
  const json = (body: unknown, status: number) => new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    if (!serviceKey || req.headers.get("authorization") !== `Bearer ${serviceKey}`) return json({ error: "unauthorized" }, 401);
    const requestId = req.headers.get("x-pdf-request-id");
    if (!requestId || !/^[0-9a-f-]{36}$/.test(requestId)) return json({ error: "invalid_request_id" }, 400);
    let bounds: PdfBounds;
    try { bounds = JSON.parse(new URL(req.url).searchParams.get("bounds") ?? "null"); }
    catch { return json({ error: "invalid_bounds" }, 400); }
    if (!validPdfBounds(bounds)) return json({ error: "invalid_bounds" }, 400);
    const size = Number(req.headers.get("content-length"));
    if (Number.isFinite(size) && size > PDF_BOUNDARY.maxInputBytes) return json({ error: "input_too_large" }, 413);
    const deadlineAt = Date.now() + bounds.deadlineMs;
    try {
      const bytes = await readBoundedBody(req.body, PDF_BOUNDARY.maxInputBytes, req.signal);
      if (!hasPdfHeader(bytes)) return json({ error: "invalid_pdf" }, 400);
      const remaining = deadlineAt - Date.now();
      if (req.signal.aborted || remaining <= 0) return json({ error: "deadline_exhausted" }, 408);
      const result = await parse(bytes, { ...bounds, deadlineMs: remaining, signal: req.signal });
      const response = { version: PDF_BOUNDARY.version, request_id: requestId, result };
      if (new TextEncoder().encode(JSON.stringify(response)).length > PDF_BOUNDARY.maxResponseBytes) return json({ error: "output_too_large" }, 413);
      return json(response, 200);
    } catch (error) {
      // Do not disclose exception text, input bytes or credentials. A platform
      // CPU termination cannot be caught here; the caller handles its 546/5xx.
      return json({ error: error instanceof Error && error.message === "pdf_boundary_body_too_large" ? "input_too_large" : "pdf_extraction_failed" },
        error instanceof Error && error.message === "pdf_boundary_body_too_large" ? 413 : 422);
    }
  };
}
