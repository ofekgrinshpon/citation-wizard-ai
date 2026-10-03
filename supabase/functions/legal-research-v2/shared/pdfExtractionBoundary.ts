/**
 * PDF parsing is intentionally NOT imported into the research isolate here.
 * A distinct Edge Function owns parsing. Its CPU kill becomes an explicit
 * acquisition failure; timeout never falls back to in-process parsing/retry.
 * This isolates CPU failure; it does not raise the extraction worker's CPU cap.
 */
import { PDF_BOUNDARY, hasPdfHeader, readBoundedBody, validPdfBounds, type PdfBounds } from "../../_shared/pdfExtractionProtocol.ts";
import type { ChunkedPdfResult } from "../vendor/largePdfChunkedExtract.ts";
declare const Deno: { env: { get(key: string): string | undefined } };

export interface IsolatedPdfOptions extends PdfBounds {
  deadlineAt?: number;
  signal?: AbortSignal;
}
interface Dependencies {
  fetch?: typeof fetch;
  env?: (name: string) => string | undefined;
  now?: () => number;
}

const STOP_REASONS = new Set(["page_cap_reached", "char_cap_reached", "deadline_reached", "document_end", "enough_text", "no_pages", "page_error", "cancelled"]);
export function validPdfResult(value: unknown, opts: PdfBounds): value is ChunkedPdfResult {
  if (!value || typeof value !== "object") return false;
  const r = value as ChunkedPdfResult;
  const count = (n: number) => Number.isSafeInteger(n) && n >= 0;
  const start = opts.startPage ?? 1;
  const end = Math.min(r.total_pages, start + opts.maxPages - 1);
  const page = (n: number | null) => n === null || (Number.isSafeInteger(n) && n >= start && n <= end);
  if (!Array.isArray(r.pages) || r.pages.length !== r.pages_attempted) return false;
  let endOffset = 0;
  let reads = 0;
  for (let i = 0; i < r.pages.length; i++) {
    const p = r.pages[i];
    if (!p || p.page !== start + i || p.page > r.total_pages || !count(p.start) || !count(p.end) ||
      (p.truncated !== undefined && (typeof p.truncated !== "boolean" || p.status !== "read")) ||
      p.start > p.end || p.end > (typeof r.text === "string" ? r.text.length : 0)) return false;
    if (p.status === "read") {
      if (p.start !== endOffset + (reads ? 2 : 0) || p.end <= p.start ||
        (reads && r.text.slice(endOffset, p.start) !== "\n\n")) return false;
      endOffset = p.end; reads++;
    } else if (!["empty", "error"].includes(p.status) || p.start !== endOffset || p.end !== endOffset) return false;
  }
  if (reads !== r.pages_extracted || endOffset !== r.text?.length) return false;
  const readPages = r.pages.filter((p) => p.status === "read");
  if (r.first_page_extracted !== (readPages[0]?.page ?? null) || r.last_page_extracted !== (readPages.at(-1)?.page ?? null)) return false;
  return typeof r.text === "string" && r.text.length <= opts.maxChars && r.chars_extracted === r.text.length &&
    count(r.total_pages) && count(r.pages_attempted) && count(r.pages_extracted) &&
    r.pages_attempted <= opts.maxPages && r.pages_extracted <= r.pages_attempted &&
    page(r.first_page_extracted) && page(r.last_page_extracted) &&
    (r.pages_extracted === 0 ? r.first_page_extracted === null && r.last_page_extracted === null && r.text === "" :
      r.first_page_extracted !== null && r.last_page_extracted !== null && r.first_page_extracted <= r.last_page_extracted) &&
    STOP_REASONS.has(r.stopped_reason) && Number.isFinite(r.latency_ms) && r.latency_ms >= 0;
}

export async function extractPdfPagesBounded(
  bytes: Uint8Array,
  opts: IsolatedPdfOptions,
  dependencies: Dependencies = {},
): Promise<ChunkedPdfResult> {
  const now = dependencies.now ?? Date.now;
  if (!validPdfBounds(opts)) throw new Error("pdf_boundary_invalid_bounds");
  if (bytes.byteLength > PDF_BOUNDARY.maxInputBytes) throw new Error("pdf_boundary_input_too_large");
  if (!hasPdfHeader(bytes)) throw new Error("pdf_boundary_invalid_pdf");
  const deadlineAt = Math.min(now() + opts.deadlineMs, opts.deadlineAt ?? Infinity);
  if (opts.signal?.aborted) throw new Error("pdf_boundary_cancelled");
  if (now() >= deadlineAt) throw new Error("pdf_boundary_deadline_exhausted");
  const env = dependencies.env ?? ((name: string) => Deno.env.get(name));
  const base = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !key) throw new Error("pdf_boundary_unconfigured");
  const url = new URL("/functions/v1/research-pdf-extract", base);
  const requestId = crypto.randomUUID();
  const bounds: PdfBounds = {
    maxPages: opts.maxPages, maxChars: opts.maxChars,
    deadlineMs: Math.max(1, Math.floor(deadlineAt - now())),
    ...(opts.enoughChars === undefined ? {} : { enoughChars: opts.enoughChars }),
    ...(opts.startPage === undefined ? {} : { startPage: opts.startPage }),
  };
  url.searchParams.set("bounds", JSON.stringify(bounds));
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => { controller.abort(); reject(new Error("pdf_boundary_cancelled")); };
    opts.signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => {
      controller.abort(); reject(new Error("pdf_boundary_deadline_exhausted"));
    }, Math.max(0, deadlineAt - now()));
  });
  try {
    // Promise.race is useful here ONLY because CPU parsing lives in ANOTHER
    // function isolate. Aborting this HTTP request does not claim to kill it.
    const work = async () => {
      const response = await (dependencies.fetch ?? fetch)(url, {
        method: "POST", signal: controller.signal,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/pdf", "x-pdf-request-id": requestId },
        body: bytes as BodyInit,
      });
      if (!response.ok) throw new Error(`pdf_boundary_worker_http_${response.status}`);
      const raw = await readBoundedBody(response.body, PDF_BOUNDARY.maxResponseBytes, controller.signal);
      let envelope;
      try { envelope = JSON.parse(new TextDecoder().decode(raw)); }
      catch { throw new Error("pdf_boundary_invalid_response"); }
      if (controller.signal.aborted || now() >= deadlineAt) throw new Error("pdf_boundary_deadline_exhausted");
      if (envelope?.version !== PDF_BOUNDARY.version || envelope?.request_id !== requestId || !validPdfResult(envelope.result, bounds)) {
        throw new Error("pdf_boundary_invalid_response");
      }
      // Optional embedded metadata is bibliographic only; never evidence. Keep
      // only bounded scalar fields, so a response cannot smuggle nested objects.
      const info = envelope.result.info;
      if (info !== undefined) {
        const clean: Record<string, unknown> = {};
        if (info && typeof info === "object" && !Array.isArray(info)) {
          for (const [k, v] of Object.entries(info).slice(0, 32)) {
            if (k.length <= 80 && typeof v === "string") clean[k] = v.slice(0, 2_000);
          }
        }
        envelope.result.info = clean;
      }
      return envelope.result as ChunkedPdfResult;
    };
    return await Promise.race([work(), cancelled]);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", abort);
    controller.abort();
  }
}
