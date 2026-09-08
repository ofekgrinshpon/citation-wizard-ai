/**
 * legal-research-v2 — `fetch` tool.
 *
 * Retrieve actual readable legal text and append it to the evidence store.
 * Reuses the proven low-level HTTP/extraction primitives (official fetch
 * profiles + court egress relay, bounded PDF page extraction, DOCX, HTML) and
 * nothing above them: no acquisition stage, no fallback hierarchy, no rescue.
 * If a fetch fails, the research agent decides what to do next.
 *
 * Context discipline: the full body is stored server-side; the tool response
 * carries only a summary plus bounded excerpts. An already-read source is
 * answered from the store, and `fetch({source_id, query})` re-reads a specific
 * part of it without re-injecting the document.
 */

import type { EvidenceSource, SearchResult } from "../types.ts";
import type { EvidenceStore } from "../evidence/evidenceStore.ts";
import { excerptWindows } from "../evidence/evidenceStore.ts";
import {
  extractDocumentText,
  extractPdfPagesBounded,
  htmlToText,
  looksLikeBlockPage,
  officialFetch,
} from "../shared/primitives.ts";
import { AcquisitionLedger, type AuthorityState, authorityKeyOf } from "./acquisitionLedger.ts";
import { normalizeUrlKey } from "../evidence/evidenceStore.ts";

export const FETCH_LIMITS = {
  TIMEOUT_MS: 25_000,
  MAX_BYTES: 24 * 1024 * 1024,
  MAX_TEXT_CHARS: 200_000,
  PDF_MAX_PAGES: 24,
  PDF_DEADLINE_MS: 12_000,
  PDF_ENOUGH_CHARS: 80_000,
  MIN_DOCUMENT_CHARS: 400,
  /** Context ceilings — the agent never receives a whole body. */
  HEAD_CHARS: 1_400,
  WINDOW_CHARS: 1_200,
  MAX_WINDOWS: 3,
  MAX_RESPONSE_CHARS: 6_500,
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
  return excerptWindows(text, find, {
    window: FETCH_LIMITS.WINDOW_CHARS,
    max: FETCH_LIMITS.MAX_WINDOWS,
  });
}

export interface FetchInput {
  result_id?: string;
  url?: string;
  /** Targeted re-read of a document already in the evidence store. */
  source_id?: string;
  query?: string;
  locator?: string;
  want?: string;
  expected_identity?: { docket?: string; statute?: string; section?: string };
  /** Optional in-document search terms; returns verbatim windows around them. */
  find?: string[];
  /** Explicit justification for re-fetching an already-read URL. */
  refetch_reason?: string;
}

export interface FetchOutput {
  ok: boolean;
  source_id?: string;
  title?: string;
  summary?: string;
  text_length?: number;
  is_actual_document?: boolean;
  not_document_reason?: string;
  identity_found?: { dockets: string[]; statutes: string[]; sections: string[] };
  identity_hint?: string;
  text_head?: string;
  windows?: string[];
  /** True when the body was already in the evidence store (no new HTTP call). */
  deduped?: boolean;
  already_read?: boolean;
  instruction?: string;
  acquisition_note?: string;
  /** Compact per-authority acquisition state (attempted hosts, usable body). */
  authority_state?: AuthorityState;
  /** True when a usable body for this authority already exists elsewhere. */
  authority_reuse?: boolean;
  /** True when this exact URL already failed for this authority. */
  dead_path?: boolean;
  error?: string;
}

function alreadyReadPayload(cached: EvidenceSource, input: FetchInput): FetchOutput {
  const terms = [
    ...(input.find ?? []),
    ...(input.query ? [input.query] : []),
    ...(input.locator ? [input.locator] : []),
  ];
  const windows = terms.length ? readingWindows(cached.extracted_text, terms) : undefined;
  return {
    ok: cached.fetch_status === "ok",
    already_read: true,
    deduped: true,
    source_id: cached.source_id,
    title: cached.title,
    summary: cached.summary,
    text_length: cached.text_length,
    is_actual_document: cached.is_actual_document,
    not_document_reason: cached.not_document_reason,
    identity_found: cached.identity_fields,
    windows: windows?.length ? windows : undefined,
    text_head: windows?.length ? undefined : cached.extracted_text.slice(0, FETCH_LIMITS.HEAD_CHARS),
    instruction:
      "מקור זה כבר נקרא בריצה זו. אל תביא אותו שוב אלא אם נדרשת הבאה שונה מהותית. לקריאה ממוקדת בתוכו: fetch({source_id, query}).",
    error: cached.fetch_status === "ok" ? undefined : cached.fetch_error,
  };
}

/** Clamp every string field so a single tool response can never blow up context. */
export function clampFetchOutput(out: FetchOutput): FetchOutput {
  const clamped: FetchOutput = { ...out };
  if (clamped.text_head) clamped.text_head = clamped.text_head.slice(0, FETCH_LIMITS.HEAD_CHARS);
  if (clamped.summary) clamped.summary = clamped.summary.slice(0, 900);
  if (clamped.windows) {
    clamped.windows = clamped.windows
      .slice(0, FETCH_LIMITS.MAX_WINDOWS)
      .map((w) => w.slice(0, FETCH_LIMITS.WINDOW_CHARS));
  }
  // Last-resort ceiling on the serialized payload.
  let json = JSON.stringify(clamped);
  while (json.length > FETCH_LIMITS.MAX_RESPONSE_CHARS && clamped.windows?.length) {
    clamped.windows = clamped.windows.slice(0, clamped.windows.length - 1);
    json = JSON.stringify(clamped);
  }
  if (json.length > FETCH_LIMITS.MAX_RESPONSE_CHARS && clamped.text_head) {
    clamped.text_head = clamped.text_head.slice(0, 800);
  }
  return clamped;
}

export async function runFetch(
  store: EvidenceStore,
  discovered: Map<string, SearchResult>,
  input: FetchInput,
  ledger?: AcquisitionLedger,
): Promise<FetchOutput> {
  // ── Targeted re-read of an already-stored body (no HTTP, no budget) ──────
  if (input.source_id && !input.url && !input.result_id) {
    const src = store.get(input.source_id);
    if (!src) return { ok: false, error: `unknown_source_id:${input.source_id}` };
    const ex = store.excerpt(input.source_id, {
      query: input.query,
      locator: input.locator,
      find: input.find,
      maxChars: FETCH_LIMITS.WINDOW_CHARS,
    })!;
    return clampFetchOutput({
      ok: src.fetch_status === "ok",
      already_read: true,
      source_id: src.source_id,
      title: src.title,
      summary: src.summary,
      text_length: src.text_length,
      is_actual_document: src.is_actual_document,
      identity_found: src.identity_fields,
      windows: ex.windows,
      instruction: `קריאה ממוקדת בתוך ${src.source_id} (${ex.from}). הגוף המלא שמור בצד השרת ואינו נשלח לשיחה.`,
    });
  }

  const discovery = input.result_id ? discovered.get(input.result_id) ?? null : null;
  const url = input.url || discovery?.url;
  if (!url || !/^https?:\/\//i.test(url)) {
    return { ok: false, error: "no_usable_url" };
  }

  const authorityKey = authorityKeyOf(input.expected_identity ?? {});

  // Per-run fetch dedupe: an already-read URL is served from the evidence
  // store and does not consume fetch budget, unless a refetch reason is given.
  if (!input.refetch_reason?.trim()) {
    const cached = store.findByUrl(url);
    if (cached) return clampFetchOutput(alreadyReadPayload(cached, input));
  }

  // ── Same-authority acquisition efficiency ────────────────────────────────
  // Identity verification is unchanged: this only avoids repeating network
  // work for an authority whose body was ALREADY acquired with a matching
  // identity, and avoids re-walking a path that already failed.
  if (ledger && authorityKey && !input.refetch_reason?.trim()) {
    const acquiredId = ledger.get(authorityKey)?.acquired_source_id;
    const acquired = acquiredId ? store.get(acquiredId) : null;
    if (acquired && normalizeUrlKey(acquired.url ?? "") !== normalizeUrlKey(url)) {
      return clampFetchOutput({
        ...alreadyReadPayload(acquired, input),
        authority_reuse: true,
        authority_state: ledger.state(authorityKey) ?? undefined,
        instruction:
          `גוף האסמכתה ${authorityKey} כבר הובא ואומת זהותית (${acquired.source_id}). עבוד מתוכו: fetch({source_id:"${acquired.source_id}", query}). אל תחפש עותקים נוספים אלא אם חסר בו רכיב ספציפי — ואז ציין refetch_reason.`,
      });
    }
    const prior = ledger.attemptOn(authorityKey, url);
    if (prior && prior.outcome !== "acquired") {
      return clampFetchOutput({
        ok: false,
        dead_path: true,
        error: `dead_acquisition_path:${prior.reason}`.slice(0, 160),
        authority_state: ledger.state(authorityKey) ?? undefined,
        instruction:
          "כתובת זו כבר נוסתה בריצה זו ונכשלה. אל תחזור עליה. נסה מקור שונה מהותית או המשך עם מה שכבר נקרא.",
      });
    }
  }

  const title = discovery?.title || url;
  const origin = discovery?.origin ?? "direct_url";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_LIMITS.TIMEOUT_MS);
  let entry: EvidenceSource;
  const noteFailure = (reason: string) => {
    if (ledger && authorityKey) {
      ledger.note(authorityKey, { url, outcome: "failed", reason, at: new Date().toISOString() });
    }
  };
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
      noteFailure(`http_${res.status}`);
      return clampFetchOutput({
        ok: false,
        source_id: entry.source_id,
        error: `http_${res.status}`,
        acquisition_note: authorityKey ? ledger?.advice(authorityKey) : undefined,
      });
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
      noteFailure("document_too_large");
      return clampFetchOutput({ ok: false, source_id: entry.source_id, error: "document_too_large" });
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
    if (error) {
      noteFailure(error);
      return clampFetchOutput({
        ok: false,
        source_id: entry.source_id,
        error,
        acquisition_note: authorityKey ? ledger?.advice(authorityKey) : undefined,
      });
    }
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
    noteFailure(msg.slice(0, 120));
    return clampFetchOutput({
      ok: false,
      source_id: entry.source_id,
      error: msg.slice(0, 200),
      acquisition_note: authorityKey ? ledger?.advice(authorityKey) : undefined,
    });
  } finally {
    clearTimeout(timer);
  }

  const expectedDocket = input.expected_identity?.docket?.trim();
  let identity_hint: string | undefined;
  let identityMatched = true;
  if (expectedDocket) {
    const num = expectedDocket.match(/\d{1,6}\/\d{2,4}/)?.[0] ?? expectedDocket;
    identityMatched = entry.identity_fields.dockets.includes(num) || entry.extracted_text.includes(num);
    identity_hint = identityMatched
      ? `התיק ${expectedDocket} מופיע בגוף המסמך שהובא.`
      : `אזהרה: התיק ${expectedDocket} לא נמצא בגוף המסמך שהובא — ככל הנראה זה אינו המסמך המבוקש.`;
  }

  if (ledger && authorityKey) {
    const acquired = entry.is_actual_document && identityMatched;
    ledger.note(
      authorityKey,
      {
        url,
        outcome: acquired ? "acquired" : identityMatched ? "failed" : "not_the_document",
        reason: acquired ? "body_read_with_matching_identity" : (entry.not_document_reason ?? "identity_mismatch"),
        at: new Date().toISOString(),
      },
      acquired ? entry.source_id : undefined,
    );
  }

  return clampFetchOutput({
    ok: true,
    source_id: entry.source_id,
    title: entry.title,
    summary: entry.summary,
    text_length: entry.text_length,
    is_actual_document: entry.is_actual_document,
    not_document_reason: entry.not_document_reason,
    identity_found: entry.identity_fields,
    identity_hint,
    text_head: entry.extracted_text.slice(0, FETCH_LIMITS.HEAD_CHARS),
    windows: input.find?.length ? readingWindows(entry.extracted_text, input.find) : undefined,
    instruction:
      "הגוף המלא שמור בצד השרת. לקריאת קטע נוסף מתוכו: fetch({source_id, query}) — אל תביא את אותו URL שוב.",
    acquisition_note: authorityKey ? ledger?.advice(authorityKey) : undefined,
  });
}
