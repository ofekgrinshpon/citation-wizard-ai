/**
 * large_scholarship_pdf_extraction_v1 — bounded, page-by-page PDF text extraction.
 *
 * Why this exists: `extractDocumentText` calls unpdf's `extractText` over the
 * WHOLE document in one synchronous, uninterruptible step. For a multi-megabyte
 * Israeli law-review PDF that either exhausts the edge CPU quota or is refused
 * outright by the inline-extraction size cap
 * (`secondary_binary_too_large_for_inline_extraction`), so strong scholarship
 * that was already found can never be read.
 *
 * Page and character ceilings are hard output bounds. Deadline/cancellation
 * checks are cooperative ONLY: document open or a single page can exceed the
 * hosted CPU limit before JavaScript regains control. V2 invokes this module
 * only in the separate research-pdf-extract function, never its research worker.
 *
 * Scope: text extraction only. No fetching, no network, no model calls.
 */

import { getDocumentProxy } from "npm:unpdf@0.12.1";

export type ChunkedStopReason =
  | "page_cap_reached"
  | "char_cap_reached"
  | "deadline_reached"
  | "document_end"
  | "enough_text"
  | "no_pages"
  | "page_error"
  | "cancelled";

export interface ChunkedPdfOptions {
  /** Hard page ceiling for this pass. */
  maxPages: number;
  /** Hard extracted-character ceiling. */
  maxChars: number;
  /** Wall-clock deadline in ms for the whole extraction. */
  deadlineMs: number;
  /** Stop early once this many chars are extracted (enough to classify/cite). */
  enoughChars?: number;
  /** 1-based first page to read. */
  startPage?: number;
  now?: () => number;
  signal?: AbortSignal;
}

export interface PdfPageRecord {
  page: number;
  status: "read" | "empty" | "error";
  /** True only when the output cap cut this page before its end. */
  truncated?: boolean;
  /** Offsets refer to the exact returned text, never flattened/re-numbered pages. */
  start: number;
  end: number;
}

export interface ChunkedPdfResult {
  pages: PdfPageRecord[];
  text: string;
  total_pages: number;
  pages_attempted: number;
  pages_extracted: number;
  first_page_extracted: number | null;
  last_page_extracted: number | null;
  chars_extracted: number;
  stopped_reason: ChunkedStopReason;
  latency_ms: number;
  /**
   * Embedded PDF document information (Title/Author/CreationDate…), when the
   * file carries any. Bibliographic identity only — never evidence.
   */
  info?: Record<string, unknown>;
}

interface TextItemLike {
  str?: unknown;
  hasEOL?: unknown;
}

/** Join one page's text items into a line-preserving string. */
export function joinPageItems(items: TextItemLike[]): string {
  let out = "";
  for (const it of items) {
    const s = typeof it?.str === "string" ? it.str : "";
    if (!s) {
      if (it?.hasEOL === true) out += "\n";
      continue;
    }
    out += s;
    out += it?.hasEOL === true ? "\n" : " ";
  }
  return out.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

/**
 * Read a PDF page range under page / char / time bounds.
 *
 * Deliberately tolerant: a single failing page is skipped, not fatal, because
 * scanned or malformed pages are common in Israeli journal archives.
 */
export async function extractPdfPagesBounded(
  bytes: Uint8Array,
  opts: ChunkedPdfOptions,
): Promise<ChunkedPdfResult> {
  const now = opts.now ?? Date.now;
  const started = now();
  const deadline = started + Math.max(0, opts.deadlineMs);
  const enough = Math.min(opts.enoughChars ?? opts.maxChars, opts.maxChars);
  const startPage = Math.max(1, opts.startPage ?? 1);
  let text = "";
  const pages: PdfPageRecord[] = [];
  let extracted = 0;
  let first: number | null = null;
  let last: number | null = null;
  let stopped: ChunkedStopReason = "document_end";
  let totalPages = 0;
  let info: Record<string, unknown> | undefined;
  // deno-lint-ignore no-explicit-any
  let pdf: any;
  const stop = () => {
    if (opts.signal?.aborted) { stopped = "cancelled"; return true; }
    if (now() >= deadline) { stopped = "deadline_reached"; return true; }
    return false;
  };
  const result = (): ChunkedPdfResult => ({
    text, pages, total_pages: totalPages, pages_attempted: pages.length,
    pages_extracted: extracted, first_page_extracted: first, last_page_extracted: last,
    chars_extracted: text.length, stopped_reason: stopped, latency_ms: now() - started, info,
  });
  if (stop()) return result();
  try {
    pdf = await getDocumentProxy(bytes);
    totalPages = Number(pdf.numPages ?? 0) || 0;
    if (stop()) return result();
    if (totalPages <= 0) { stopped = "no_pages"; return result(); }
    try {
      const raw = (await pdf.getMetadata?.())?.info;
      if (raw && typeof raw === "object") {
        info = {};
        for (const [k, v] of Object.entries(raw).slice(0, 32)) {
          if (k.length <= 80 && typeof v === "string") info[k] = v.slice(0, 2_000);
        }
      }
    } catch { /* bibliographic metadata is optional, never evidence */ }
    if (stop()) return result();
    const lastPage = Math.min(totalPages, startPage + opts.maxPages - 1);
    for (let p = startPage; p <= lastPage; p++) {
      if (stop()) break;
      const record: PdfPageRecord = { page: p, status: "error", start: text.length, end: text.length };
      pages.push(record);
      // deno-lint-ignore no-explicit-any
      let page: any;
      try {
        page = await pdf.getPage(p);
        if (stop()) break;
        const content = await page.getTextContent();
        if (stop()) break;
        const pageText = joinPageItems((content?.items ?? []) as TextItemLike[]);
        record.status = pageText ? "read" : "empty";
        if (pageText) {
          const separator = text ? "\n\n" : "";
          const remaining = Math.max(0, opts.maxChars - text.length - separator.length);
          const added = pageText.slice(0, remaining).trimEnd();
          if (!added) { stopped = "char_cap_reached"; record.status = "empty"; break; }
          record.start = text.length + separator.length;
          text += separator + added;
          record.end = text.length;
          if (added.length < pageText.length) record.truncated = true;
          extracted++;
          if (first === null) first = p;
          last = p;
          if (added.length < pageText.length || text.length >= opts.maxChars) { stopped = "char_cap_reached"; break; }
        }
      } catch {
        if (extracted === 0 && pages.length >= 3) { stopped = "page_error"; break; }
      } finally {
        try { page?.cleanup?.(); } catch { /* best effort */ }
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (stop()) break;
      if (text.length >= enough) { stopped = "enough_text"; break; }
      if (p === lastPage) stopped = lastPage < totalPages ? "page_cap_reached" : "document_end";
    }
    return result();
  } finally {
    // Covers zero-page, cancellation, metadata failure and page failure too.
    // A platform CPU kill cannot run finally; isolation is the safety boundary.
    try { await pdf?.destroy?.(); } catch { /* best effort */ }
  }
}
