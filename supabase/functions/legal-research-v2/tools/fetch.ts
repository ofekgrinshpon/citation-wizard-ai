/**
 * legal-research-v2 — `fetch` tool.
 *
 * Retrieve actual readable legal text and append it to the evidence store.
 * Reuses the proven low-level HTTP/extraction primitives (official fetch
 * profiles + court egress relay, bounded PDF page extraction, DOCX, HTML) and
 * nothing above them: no acquisition stage, no fallback hierarchy, no rescue.
 * If a fetch fails, the research agent decides what to do next.
 */

import type { EvidenceSource, SearchResult } from "../types.ts";
import type { EvidenceStore } from "../evidence/evidenceStore.ts";
import {
  extractDocumentText,
  extractPdfPagesBounded,
  htmlToText,
  looksLikeBlockPage,
  officialFetch,
} from "../shared/primitives.ts";

export const FETCH_LIMITS = {
  TIMEOUT_MS: 25_000,
  MAX_BYTES: 24 * 1024 * 1024,
  MAX_TEXT_CHARS: 200_000,
  PDF_MAX_PAGES: 40,
  PDF_DEADLINE_MS: 18_000,
  PDF_ENOUGH_CHARS: 80_000,
  MIN_DOCUMENT_CHARS: 400,
  HEAD_CHARS: 7_000,
  WINDOW_CHARS: 2_400,
  MAX_WINDOWS: 3,
};

/** Deterministic "this is not a document" signatures. One small set, no taxonomy. */
const LISTING_SIGNATURES = [
  "תוצאות חיפוש",
  "לא נמצאו תוצאות",
  "search results",
  "no results found",
  "מנוע חיפוש",
  "רשימת פסקי דין",
  "התחבר כדי לצפות",
  "נדרשת הרשמה",
  "subscribe to continue",
  "enable javascript",
  "דפדפן אינו נתמך",
];

export interface DocumentCheck {
  is_actual_document: boolean;
  reason?: string;
}

export function checkIsActualDocument(text: string): DocumentCheck {
  const t = (text ?? "").trim();
  if (t.length < FETCH_LIMITS.MIN_DOCUMENT_CHARS) {
    return { is_actual_document: false, reason: "too_short_for_a_document" };
  }
  if (looksLikeBlockPage(t)) {
    return { is_actual_document: false, reason: "block_page" };
  }
  const head = t.slice(0, 3_000).toLowerCase();
  const hit = LISTING_SIGNATURES.find((s) => head.includes(s.toLowerCase()));
  if (hit && t.length < 8_000) {
    return { is_actual_document: false, reason: `listing_or_portal_shell:${hit}` };
  }
  // A portal shell is mostly navigation: very little running prose.
  const sentences = (t.match(/[.!?׃:]\s/g) ?? []).length;
  if (t.length < 2_000 && sentences < 3) {
    return { is_actual_document: false, reason: "portal_shell_no_prose" };
  }
  return { is_actual_document: true };
}

async function extractByContentType(
  url: string,
  contentType: string,
  bytes: Uint8Array,
): Promise<{ text: string; error?: string }> {
  const ct = contentType.toLowerCase();
  const isPdf = ct.includes("pdf") || /\.pdf(\?|$)/i.test(url) ||
    (bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50);
  if (isPdf) {
    try {
      const res = await extractPdfPagesBounded(bytes, {
        maxPages: FETCH_LIMITS.PDF_MAX_PAGES,
        maxChars: FETCH_LIMITS.MAX_TEXT_CHARS,
        deadlineMs: FETCH_LIMITS.PDF_DEADLINE_MS,
        enoughChars: FETCH_LIMITS.PDF_ENOUGH_CHARS,
      });
      return { text: res.text };
    } catch (e) {
      return { text: "", error: `pdf_extract_failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  if (ct.includes("wordprocessingml") || /\.docx(\?|$)/i.test(url)) {
    try {
      return { text: await extractDocumentText(bytes, "docx") };
    } catch (e) {
      return { text: "", error: `docx_extract_failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (ct.includes("html") || /<html[\s>]/i.test(raw.slice(0, 2_000))) {
    return { text: htmlToText(raw) };
  }
  return { text: raw.trim() };
}

/** Return reading windows around the agent's search terms (verbatim slices). */
export function readingWindows(text: string, find: string[]): string[] {
  const out: string[] = [];
  for (const term of find.slice(0, 5)) {
    const needle = String(term ?? "").trim();
    if (needle.length < 2) continue;
    const idx = text.indexOf(needle);
    if (idx < 0) continue;
    const start = Math.max(0, idx - Math.floor(FETCH_LIMITS.WINDOW_CHARS / 3));
    out.push(text.slice(start, start + FETCH_LIMITS.WINDOW_CHARS));
    if (out.length >= FETCH_LIMITS.MAX_WINDOWS) break;
  }
  return out;
}

export interface FetchInput {
  result_id?: string;
  url?: string;
  expected_identity?: { docket?: string; statute?: string; section?: string };
  /** Optional in-document search terms; returns verbatim windows around them. */
  find?: string[];
}

export interface FetchOutput {
  ok: boolean;
  source_id?: string;
  title?: string;
  text_length?: number;
  is_actual_document?: boolean;
  not_document_reason?: string;
  identity_found?: { dockets: string[]; statutes: string[]; sections: string[] };
  identity_hint?: string;
  text_head?: string;
  windows?: string[];
  error?: string;
}

export async function runFetch(
  store: EvidenceStore,
  discovered: Map<string, SearchResult>,
  input: FetchInput,
): Promise<FetchOutput> {
  const discovery = input.result_id ? discovered.get(input.result_id) ?? null : null;
  const url = input.url || discovery?.url;
  if (!url || !/^https?:\/\//i.test(url)) {
    return { ok: false, error: "no_usable_url" };
  }
  const title = discovery?.title || url;
  const origin = discovery?.origin ?? "direct_url";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_LIMITS.TIMEOUT_MS);
  let entry: EvidenceSource;
  try {
    const res = await officialFetch(url, { signal: controller.signal });
    if (!res.ok) {
      entry = await store.append({
        url,
        title,
        origin,
        fetch_status: "error",
        fetch_error: `http_${res.status}`,
        extracted_text: "",
        is_actual_document: false,
        not_document_reason: `http_${res.status}`,
      });
      return { ok: false, source_id: entry.source_id, error: `http_${res.status}` };
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > FETCH_LIMITS.MAX_BYTES) {
      entry = await store.append({
        url,
        title,
        origin,
        fetch_status: "error",
        fetch_error: "document_too_large",
        extracted_text: "",
        is_actual_document: false,
        not_document_reason: "document_too_large",
      });
      return { ok: false, source_id: entry.source_id, error: "document_too_large" };
    }
    const { text, error } = await extractByContentType(
      url,
      res.headers.get("content-type") ?? "",
      buf,
    );
    const clipped = text.slice(0, FETCH_LIMITS.MAX_TEXT_CHARS);
    const docCheck = checkIsActualDocument(clipped);
    entry = await store.append({
      url,
      title,
      origin,
      fetch_status: error ? "error" : "ok",
      fetch_error: error,
      extracted_text: clipped,
      is_actual_document: !error && docCheck.is_actual_document,
      not_document_reason: error ?? docCheck.reason,
    });
    if (error) return { ok: false, source_id: entry.source_id, error };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    entry = await store.append({
      url,
      title,
      origin,
      fetch_status: "error",
      fetch_error: msg.slice(0, 200),
      extracted_text: "",
      is_actual_document: false,
      not_document_reason: "fetch_exception",
    });
    return { ok: false, source_id: entry.source_id, error: msg.slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }

  const expectedDocket = input.expected_identity?.docket?.trim();
  let identity_hint: string | undefined;
  if (expectedDocket) {
    const found = entry.identity_fields.dockets.some((d) => d === expectedDocket) ||
      entry.extracted_text.includes(expectedDocket);
    identity_hint = found
      ? `התיק ${expectedDocket} מופיע בגוף המסמך שהובא.`
      : `אזהרה: התיק ${expectedDocket} לא נמצא בגוף המסמך שהובא — ככל הנראה זה אינו המסמך המבוקש.`;
  }

  return {
    ok: true,
    source_id: entry.source_id,
    title: entry.title,
    text_length: entry.text_length,
    is_actual_document: entry.is_actual_document,
    not_document_reason: entry.not_document_reason,
    identity_found: entry.identity_fields,
    identity_hint,
    text_head: entry.extracted_text.slice(0, FETCH_LIMITS.HEAD_CHARS),
    windows: input.find?.length ? readingWindows(entry.extracted_text, input.find) : undefined,
  };
}
