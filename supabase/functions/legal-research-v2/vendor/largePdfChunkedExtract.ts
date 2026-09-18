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
 * This module reads a PDF *page by page* under three hard bounds — page count,
 * extracted characters and wall-clock deadline — yielding to the event loop
 * between pages so the isolate stays responsive and the caller's budget can
 * actually stop the work. It never reads the whole document when the first N
 * pages already carry enough article text.
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
  | "page_error";

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
}

export interface ChunkedPdfResult {
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
  const now = opts.now ?? (() => Date.now());
  const started = now();
  const deadline = started + Math.max(1_000, opts.deadlineMs);
  const enough = opts.enoughChars ?? opts.maxChars;
  const startPage = Math.max(1, opts.startPage ?? 1);

  const parts: string[] = [];
  let chars = 0;
  let attempted = 0;
  let extracted = 0;
  let first: number | null = null;
  let last: number | null = null;
  let stopped: ChunkedStopReason = "document_end";
  let totalPages = 0;

  const pdf = await getDocumentProxy(bytes);
  totalPages = Number((pdf as { numPages?: number }).numPages ?? 0) || 0;
  if (totalPages <= 0) {
    return {
      text: "",
      total_pages: 0,
      pages_attempted: 0,
      pages_extracted: 0,
      first_page_extracted: null,
      last_page_extracted: null,
      chars_extracted: 0,
      stopped_reason: "no_pages",
      latency_ms: now() - started,
    };
  }

  // Embedded document information, read once and never trusted as evidence.
  let info: Record<string, unknown> | undefined;
  try {
    // deno-lint-ignore no-explicit-any
    const meta = await (pdf as any).getMetadata?.();
    const raw = meta?.info;
    if (raw && typeof raw === "object") info = raw as Record<string, unknown>;
  } catch { /* metadata is optional */ }

  const lastPage = Math.min(totalPages, startPage + opts.maxPages - 1);
  for (let p = startPage; p <= lastPage; p++) {
    if (now() >= deadline) {
      stopped = "deadline_reached";
      break;
    }
    attempted += 1;
    try {
      // deno-lint-ignore no-explicit-any
      const page = await (pdf as any).getPage(p);
      const content = await page.getTextContent();
      const pageText = joinPageItems((content?.items ?? []) as TextItemLike[]);
      if (pageText.length > 0) {
        extracted += 1;
        if (first === null) first = p;
        last = p;
        parts.push(pageText);
        chars += pageText.length;
      }
      // Release page resources eagerly; large journal PDFs otherwise pin memory.
      try {
        page.cleanup?.();
      } catch { /* best effort */ }
    } catch {
      // A bad page never kills the pass.
      if (extracted === 0 && attempted >= 3) {
        stopped = "page_error";
        break;
      }
    }
    // Yield so the isolate stays responsive between pages.
    await new Promise((r) => setTimeout(r, 0));

    if (chars >= opts.maxChars) {
      stopped = "char_cap_reached";
      break;
    }
    if (chars >= enough) {
      stopped = "enough_text";
      break;
    }
    if (p === lastPage) {
      stopped = lastPage < totalPages ? "page_cap_reached" : "document_end";
    }
  }

  try {
    // deno-lint-ignore no-explicit-any
    await (pdf as any).destroy?.();
  } catch { /* best effort */ }

  const text = parts.join("\n\n").slice(0, opts.maxChars).trim();
  return {
    text,
    total_pages: totalPages,
    pages_attempted: attempted,
    pages_extracted: extracted,
    first_page_extracted: first,
    last_page_extracted: last,
    chars_extracted: text.length,
    stopped_reason: stopped,
    latency_ms: now() - started,
    info,
  };
}
