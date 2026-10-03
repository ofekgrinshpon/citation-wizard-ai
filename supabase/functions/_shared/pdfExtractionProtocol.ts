/** Internal binary PDF protocol. No URL fetch, model, billing or credentials in payloads. */
export const PDF_BOUNDARY = {
  version: 1,
  maxInputBytes: 24 * 1024 * 1024,
  maxResponseBytes: 1_250_000,
  maxPages: 24,
  maxChars: 200_000,
  maxDeadlineMs: 12_000,
} as const;

/** PDF.js accepts a short preamble/BOM before the header; keep that compatibility. */
export function hasPdfHeader(bytes: Uint8Array): boolean {
  return new TextDecoder().decode(bytes.subarray(0, 1_024)).includes("%PDF-");
}

export interface PdfBounds {
  maxPages: number;
  maxChars: number;
  deadlineMs: number;
  enoughChars?: number;
  startPage?: number;
}

export function validPdfBounds(o: PdfBounds): boolean {
  const integer = (v: number, low: number, high: number) => Number.isSafeInteger(v) && v >= low && v <= high;
  return !!o && integer(o.maxPages, 1, PDF_BOUNDARY.maxPages) &&
    integer(o.maxChars, 1, PDF_BOUNDARY.maxChars) &&
    integer(o.deadlineMs, 1, PDF_BOUNDARY.maxDeadlineMs) &&
    (o.enoughChars === undefined || integer(o.enoughChars, 1, o.maxChars)) &&
    (o.startPage === undefined || integer(o.startPage, 1, 1_000_000));
}

/** Stop at the limit while streaming, rather than allocating an unbounded body first. */
export async function readBoundedBody(body: ReadableStream<Uint8Array> | null, limit: number, signal?: AbortSignal): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  if (signal?.aborted) throw new Error("pdf_boundary_cancelled");
  const reader = body.getReader();
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new Error("pdf_boundary_cancelled"));
    signal?.addEventListener("abort", abort, { once: true });
  });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), cancelled]);
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new Error("pdf_boundary_body_too_large");
      chunks.push(value);
    }
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
    return result;
  } finally {
    signal?.removeEventListener("abort", abort);
    // A malicious/broken stream can return a never-resolving cancellation.
    // Resource release must never prevent a limit/deadline failure escaping.
    try { void reader.cancel().catch(() => {}); } catch { /* best effort */ }
    reader.releaseLock();
  }
}
