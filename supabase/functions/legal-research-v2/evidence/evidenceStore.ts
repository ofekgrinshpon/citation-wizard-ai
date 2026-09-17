/**
 * legal-research-v2 — append-only, per-run evidence store (in memory).
 *
 * Authoritative answer to exactly one question:
 *   "What did ReLex actually retrieve and read during this run?"
 *
 * Search snippets never enter this store. Only a completed fetch does.
 *
 * The store keeps the FULL extracted body server-side (verification needs it),
 * but exposes compact views — summary, excerpt windows — so the agent's
 * conversation context never carries whole judgments.
 */

import type { EvidenceSource, IdentityFields } from "../types.ts";
import {
  decodeHtmlEntities,
  detectDockets,
  detectStatuteSections,
  sha256Hex,
} from "../shared/primitives.ts";
import { cleanDisplayTitle, isMetadataLine, stripInternalIds } from "../shared/titleHygiene.ts";
import { cleanQuotableText, QUOTE_LIMITS, type ServedQuote, snapWindow } from "./quotable.ts";
import { userDocumentTitle } from "../../_shared/userDocumentsCore.ts";

/** Query-preserving URL key: strips only tracking noise and fragments. */
export function normalizeUrlKey(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    const drop: string[] = [];
    u.searchParams.forEach((_v, k) => {
      if (/^(utm_|fbclid|gclid|_ga)/i.test(k)) drop.push(k);
    });
    for (const k of drop) u.searchParams.delete(k);
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    u.pathname = u.pathname.replace(/\/+$/, "");
    return `${u.protocol}//${u.hostname}${u.pathname}${u.search}`;
  } catch {
    return (raw ?? "").trim();
  }
}

export function identityFieldsOf(text: string, title: string): IdentityFields {
  const head = `${title}\n${text.slice(0, 20_000)}`;
  const dockets = detectDockets(head).map((d) => d.number);
  const sections = detectStatuteSections(head);
  return {
    dockets: [...new Set(dockets)],
    statutes: [...new Set(sections.map((s) => s.statute_title_he))],
    sections: [...new Set(sections.map((s) => s.section).filter(Boolean) as string[])],
  };
}

/**
 * A citable display title. Discovery often hands us a URL or a filename; the
 * fetched body itself is the better source of a human title, so prefer a real
 * parsed title over the raw URL, and never lead with internal metadata ids.
 */
export function displayTitleFor(
  rawTitle: string,
  text: string,
  identity: IdentityFields,
  url?: string,
): string {
  const raw = decodeHtmlEntities(rawTitle ?? "").trim();
  return cleanDisplayTitle({
    raw_title: raw,
    body_text: text,
    url,
    identity: { dockets: identity.dockets, statutes: identity.statutes },
  }).replace(/\s+/g, " ");
}

/** A short, deterministic description of what a fetched document is. */
export function summarizeSource(text: string, identity: IdentityFields, maxChars = 700): string {
  const lines = (text ?? "")
    .split("\n")
    .map((l) => stripInternalIds(l.trim()))
    .filter((l) => !isMetadataLine(l) && l.length >= 20);
  const head = lines.slice(0, 6).join(" ").slice(0, maxChars);
  const idBits = [
    identity.dockets.length ? `תיקים: ${identity.dockets.slice(0, 3).join(", ")}` : "",
    identity.statutes.length ? `חקיקה: ${identity.statutes.slice(0, 3).join(", ")}` : "",
    identity.sections.length ? `סעיפים: ${identity.sections.slice(0, 4).join(", ")}` : "",
  ].filter(Boolean).join(" | ");
  return [idBits, head].filter(Boolean).join(" — ").slice(0, maxChars + 120);
}

/** Verbatim windows around search terms inside a body. */
export function excerptWindows(
  text: string,
  terms: string[],
  opts: { window?: number; max?: number } = {},
): string[] {
  const windowChars = opts.window ?? 1_200;
  const max = opts.max ?? 3;
  const out: string[] = [];
  const used: number[] = [];
  for (const term of terms.slice(0, 6)) {
    const needle = String(term ?? "").trim();
    if (needle.length < 2) continue;
    let idx = text.indexOf(needle);
    if (idx < 0) {
      // second chance: whitespace-insensitive scan on the longest word
      const word = needle.split(/\s+/).sort((a, b) => b.length - a.length)[0] ?? "";
      if (word.length >= 3) idx = text.indexOf(word);
    }
    if (idx < 0) continue;
    if (used.some((u) => Math.abs(u - idx) < windowChars / 2)) continue;
    used.push(idx);
    const start = Math.max(0, idx - Math.floor(windowChars / 3));
    out.push(snapWindow(text, start, windowChars));
    if (out.length >= max) break;
  }
  return out;
}

export interface EvidenceStoreJson {
  seq: number;
  sources: EvidenceSource[];
  quotes?: ServedQuote[];
}

export class EvidenceStore {
  private sources = new Map<string, EvidenceSource>();
  private quotes: ServedQuote[] = [];
  private quoteSeq = 0;
  private byUrl = new Map<string, string>();
  private seq = 0;

  /** Append a fetched document. Re-fetching the same URL returns the first entry. */
  async append(input: {
    url?: string;
    title: string;
    origin: string;
    fetch_status: "ok" | "error";
    fetch_error?: string;
    extracted_text: string;
    is_actual_document: boolean;
    not_document_reason?: string;
  }): Promise<EvidenceSource> {
    if (input.url) {
      const existing = this.byUrl.get(normalizeUrlKey(input.url));
      if (existing) return this.sources.get(existing)!;
    }
    this.seq += 1;
    const source_id = `S${this.seq}`;
    const text = input.extracted_text ?? "";
    const identity_fields = identityFieldsOf(text, input.title);
    const entry: EvidenceSource = {
      source_id,
      url: input.url,
      title: displayTitleFor(input.title, text, identity_fields, input.url),
      summary: summarizeSource(text, identity_fields),
      sha256: await sha256Hex(text),
      fetch_status: input.fetch_status,
      fetch_error: input.fetch_error,
      extracted_text: text,
      text_length: text.length,
      identity_fields,
      is_actual_document: input.is_actual_document,
      not_document_reason: input.not_document_reason,
      origin: input.origin,
      fetched_at: new Date().toISOString(),
    };
    this.sources.set(source_id, entry);
    if (input.url) this.byUrl.set(normalizeUrlKey(input.url), source_id);
    return entry;
  }

  /**
   * Append a user-uploaded document as a first-class evidence source.
   *
   * It enters the SAME append-only store as fetched web/corpus bodies and is
   * subject to the same verification gates; the only difference is provenance
   * (`origin: "user_document"`) and the page map that lets a verified span be
   * attributed to a page/section.
   */
  async appendUserDocument(input: {
    file_name: string;
    mime_type: string;
    kind: "pdf" | "docx";
    storage_path: string;
    text: string;
    pages: Array<{ page: number; start: number; end: number }>;
    truncated: boolean;
    docket_match: boolean;
    matched_dockets: string[];
  }): Promise<EvidenceSource> {
    this.seq += 1;
    const source_id = `S${this.seq}`;
    const text = input.text ?? "";
    const identity_fields = identityFieldsOf(text, input.file_name);
    const title = userDocumentTitle(input.file_name);
    const entry: EvidenceSource = {
      source_id,
      title,
      summary: summarizeSource(text, identity_fields),
      sha256: await sha256Hex(text),
      fetch_status: "ok",
      extracted_text: text,
      text_length: text.length,
      identity_fields,
      is_actual_document: text.trim().length >= 400,
      not_document_reason: text.trim().length >= 400 ? undefined : "attachment_text_too_short",
      origin: "user_document",
      fetched_at: new Date().toISOString(),
      user_document: {
        file_name: input.file_name,
        mime_type: input.mime_type,
        kind: input.kind,
        storage_path: input.storage_path,
        page_count: input.pages.length,
        truncated: input.truncated,
        docket_match: input.docket_match,
        matched_dockets: input.matched_dockets,
        page_map: input.pages.map((p) => ({ page: p.page, start: p.start, end: p.end })),
      },
    };
    this.sources.set(source_id, entry);
    return entry;
  }

  /** Existing entry for the same normalized URL, if any. */
  findByUrl(url: string): EvidenceSource | null {
    const id = this.byUrl.get(normalizeUrlKey(url));
    return id ? this.sources.get(id) ?? null : null;
  }

  get(source_id: string): EvidenceSource | null {
    return this.sources.get(source_id) ?? null;
  }

  has(source_id: string): boolean {
    return this.sources.has(source_id);
  }

  all(): EvidenceSource[] {
    return [...this.sources.values()];
  }

  readable(): EvidenceSource[] {
    return this.all().filter((s) => s.fetch_status === "ok" && s.is_actual_document);
  }

  /**
   * Targeted re-read of an already-stored body. Full text stays server-side;
   * the caller receives only the requested windows.
   */
  excerpt(
    source_id: string,
    opts: { query?: string; locator?: string; find?: string[]; maxChars?: number } = {},
  ): { source_id: string; windows: string[]; from: "query" | "locator" | "head" } | null {
    const src = this.sources.get(source_id);
    if (!src) return null;
    const maxChars = opts.maxChars ?? 1_200;
    const terms = [
      ...(opts.find ?? []),
      ...(opts.query ? [opts.query, ...opts.query.split(/\s+/).filter((w) => w.length >= 4)] : []),
      ...(opts.locator ? [opts.locator] : []),
    ];
    if (terms.length) {
      const windows = excerptWindows(src.extracted_text, terms, { window: maxChars, max: 3 });
      if (windows.length) {
        return { source_id, windows, from: opts.query ? "query" : "locator" };
      }
    }
    return { source_id, windows: [src.extracted_text.slice(0, maxChars)], from: "head" };
  }

  /**
   * Record the literal excerpts handed to the agent, so they can be
   * re-surfaced later in the run. Context compaction removes old tool
   * payloads; without this the agent would lose the only text it is allowed
   * to quote verbatim, and would reconstruct spans from memory.
   */
  serveQuotes(source_id: string, windows: string[], issue?: string): ServedQuote[] {
    return this.serveQuotesWithNovelty(source_id, windows, issue).quotes;
  }

  /**
   * Same serving path, but the caller also learns how many of the returned
   * quotes were NEW (not already served earlier in this run). Quote ids, text
   * and dedupe semantics are identical to `serveQuotes` — only the novelty
   * count is additional. It is what lets the run tell a productive targeted
   * re-read from paraphrased span hunting over text already in hand.
   */
  serveQuotesWithNovelty(
    source_id: string,
    windows: string[],
    issue?: string,
  ): { quotes: ServedQuote[]; new_count: number } {
    const served: ServedQuote[] = [];
    let new_count = 0;
    for (const w of windows) {
      const text = cleanQuotableText(w).slice(0, QUOTE_LIMITS.MAX_CHARS);
      if (text.length < 40) continue;
      const existing = this.quotes.find((q) => q.source_id === source_id && q.text === text);
      if (existing) {
        served.push(existing);
        continue;
      }
      this.quoteSeq += 1;
      const q: ServedQuote = { quote_id: `${source_id}-q${this.quoteSeq}`, source_id, issue, text };
      this.quotes.push(q);
      served.push(q);
      new_count += 1;
    }
    if (this.quotes.length > QUOTE_LIMITS.MAX_KEPT) {
      this.quotes = this.quotes.slice(this.quotes.length - QUOTE_LIMITS.MAX_KEPT);
    }
    return { quotes: served, new_count };
  }

  /** Literal excerpts already served in this run (most recent last). */
  servedQuotes(source_id?: string): ServedQuote[] {
    return source_id ? this.quotes.filter((q) => q.source_id === source_id) : [...this.quotes];
  }

  toJSON(): EvidenceStoreJson {
    return { seq: this.seq, sources: this.all(), quotes: this.quotes };
  }

  static fromJSON(json: EvidenceStoreJson | null | undefined): EvidenceStore {
    const store = new EvidenceStore();
    store.seq = json?.seq ?? 0;
    store.quotes = json?.quotes ?? [];
    store.quoteSeq = store.quotes.length;
    for (const s of json?.sources ?? []) {
      store.sources.set(s.source_id, s);
      if (s.url) store.byUrl.set(normalizeUrlKey(s.url), s.source_id);
    }
    return store;
  }
}
