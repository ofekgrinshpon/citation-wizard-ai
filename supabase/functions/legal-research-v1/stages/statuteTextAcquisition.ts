// Bounded statute/regulation text acquisition (F5).
//
// Why this exists: statute-section anchors (`סעיף 6 לחוק החברות`) were
// evaluated only against a candidate's title + search snippet. The official
// statute source was routinely admitted to the pool but stayed
// `metadata_only`, so `candidateHasDirectStatuteSectionText` could never see
// the provision and the drafter fired `statute_section_limitation` while
// holding the official text.
//
// Scope guarantees:
//   - No retrieval expansion. Only candidates ALREADY in the admitted pool.
//   - Only official / primary statute sources on an allow-listed host.
//   - Hard byte + time caps mirroring the judgment-acquisition safeguards.
//   - Fail closed: on any failure the candidate is left exactly as it was.
//   - Acquisition never asserts a legal proposition; it only makes existing
//     official text visible to the deterministic anchor predicates.

import type { Candidate } from "../lib/types.ts";
import { extractDocumentText } from "../lib/attachments.ts";
import type { SourceIntegrity } from "./sourceIntegrity.ts";
import { processExtractedBody } from "./postExtract.ts";
import { decodeHebrew } from "./judgmentTextAcquisition.ts";
import type { StatuteSectionRef } from "./statuteSectionDetection.ts";

export const STATUTE_ACQUISITION_LIMITS = {
  /** Hard per-candidate deadline (fetch + decode + extract + post-extract). */
  PER_ATTEMPT_MS: 12_000,
  /** Whole-stage time box. */
  TOTAL_MS: 22_000,
  /** Attempts, not sources. */
  MAX_ATTEMPTS: 3,
  /** Max bytes downloaded per file. */
  MAX_BYTES: 4 * 1024 * 1024,
  /**
   * Pre-extract inline gate. Statute PDFs are the *target authority* of the
   * question (not speculative), so the ceiling is higher than the speculative
   * judgment path — but still bounded.
   */
  MAX_INLINE_EXTRACTION_BYTES: 2_500_000,
  /** CPU guard for text/HTML decoding. */
  MAX_DECODE_BYTES: 1_200_000,
  /** Below this the download is not real statutory text. */
  MIN_USABLE_TEXT: 400,
  /** Stored body cap. */
  MAX_TEXT: 16_000,
  /** Window kept around the located section marker. */
  SECTION_WINDOW_CHARS: 6_000,
} as const;

/** Official statute hosts only — no aggregators, no commentary sites. */
export const STATUTE_HOST_RE =
  /(^|\.)(knesset\.gov\.il|gov\.il|nevo\.co\.il|justice\.gov\.il|mishpatim\.gov\.il)$/i;

const STATUTE_TYPES = new Set(["israeli_law", "statute", "regulation", "legislation"]);

export type StatuteStageSink = (
  name: string,
  detail?: Record<string, unknown>,
) => void | Promise<void>;

export interface StatuteAcquisitionAttempt {
  candidate_id: string;
  url: string | null;
  title: string;
  ref_id: string;
  ok: boolean;
  bytes?: number;
  chars?: number;
  section_found?: boolean;
  failure_reason?: string;
  ms: number;
}

export interface StatuteAcquisitionResult {
  attempted: number;
  successes: number;
  attempts: StatuteAcquisitionAttempt[];
  acquired_candidate_ids: string[];
  stage_stop_reason:
    | "completed"
    | "no_eligible_candidates"
    | "attempt_budget_exhausted"
    | "retrieval_budget_exceeded"
    | "stage_timeout";
  retrieval_budget_exceeded: boolean;
  ms: number;
}

function hostOf(url: string | null | undefined): string {
  try {
    return new URL(String(url)).hostname;
  } catch {
    return "";
  }
}

function looksStatuteSource(c: Candidate): boolean {
  const t = String(c.source_type ?? "").toLowerCase();
  if (STATUTE_TYPES.has(t)) return true;
  return /(חוק|פקודת|תקנות|חוק-יסוד|חוק יסוד)/.test(String(c.title ?? ""));
}

function sectionWindow(text: string, ref: StatuteSectionRef): { window: string; found: boolean } {
  for (const v of ref.section_variants) {
    if (v.length < 2) continue;
    const i = text.indexOf(v);
    if (i >= 0) {
      const start = Math.max(0, i - 200);
      return {
        window: text.slice(start, start + STATUTE_ACQUISITION_LIMITS.SECTION_WINDOW_CHARS),
        found: true,
      };
    }
  }
  return { window: text.slice(0, STATUTE_ACQUISITION_LIMITS.SECTION_WINDOW_CHARS), found: false };
}

async function fetchCapped(
  url: string,
  signal: AbortSignal,
  onStage: StatuteStageSink,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  onStage("statute_fetch_start", { url });
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ReLexBot/1.0)" },
    signal,
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  const declared = Number(res.headers.get("content-length") || "0") || 0;
  onStage("statute_response_headers", { status: res.status, contentType, declared });
  const binary = /pdf|wordprocessingml|officedocument|msword|octet-stream/.test(contentType) ||
    /\.(pdf|docx?)(\?|#|$)/i.test(url);
  if (declared > STATUTE_ACQUISITION_LIMITS.MAX_BYTES) {
    try {
      await res.body?.cancel();
    } catch { /* already closed */ }
    throw new Error("statute_body_too_large");
  }
  const cap = binary
    ? STATUTE_ACQUISITION_LIMITS.MAX_BYTES
    : Math.min(
      STATUTE_ACQUISITION_LIMITS.MAX_BYTES,
      STATUTE_ACQUISITION_LIMITS.MAX_DECODE_BYTES + 65_536,
    );
  const reader = res.body?.getReader();
  if (!reader) return { bytes: new Uint8Array(0), contentType };
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    total += value.byteLength;
    if (total >= cap) {
      try {
        await reader.cancel();
      } catch { /* already closed */ }
      break;
    }
  }
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const ch of chunks) {
    bytes.set(ch.subarray(0, Math.min(ch.byteLength, total - off)), off);
    off += ch.byteLength;
    if (off >= total) break;
  }
  onStage("statute_fetch_done", { bytes: bytes.byteLength, contentType });
  return { bytes, contentType };
}

function stripMarkup(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

export async function acquireStatuteTextFromUrl(
  url: string,
  budgetExceeded: () => boolean,
  onStage: StatuteStageSink,
  allowExtraction?: (bytes: number) => boolean,
): Promise<string> {
  const signal = AbortSignal.timeout(STATUTE_ACQUISITION_LIMITS.PER_ATTEMPT_MS);
  const gate = (where: string) => {
    if (budgetExceeded()) {
      onStage("statute_budget_exceeded", { where });
      throw new Error("retrieval_timeout");
    }
  };
  gate("before_fetch");
  const { bytes, contentType } = await fetchCapped(url, signal, onStage);
  gate("after_fetch");
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 8));
  const isPdf = /pdf/.test(contentType) || /\.pdf(\?|#|$)/i.test(url) || head.startsWith("%PDF");
  const isDocx = /wordprocessingml|officedocument/.test(contentType) ||
    /\.docx(\?|#|$)/i.test(url) || head.startsWith("PK");

  if (isPdf || isDocx) {
    if (bytes.byteLength > STATUTE_ACQUISITION_LIMITS.MAX_INLINE_EXTRACTION_BYTES) {
      await onStage("statute_binary_too_large_for_inline_extraction", {
        bytes: bytes.byteLength,
        limit: STATUTE_ACQUISITION_LIMITS.MAX_INLINE_EXTRACTION_BYTES,
      });
      throw new Error("statute_binary_too_large_for_inline_extraction");
    }
    if (allowExtraction && !allowExtraction(bytes.byteLength)) {
      await onStage("statute_extraction_budget_spent", { bytes: bytes.byteLength });
      throw new Error("statute_extraction_budget_spent");
    }
    gate("before_binary_extract");
    await onStage("statute_binary_extract_start", {
      kind: isPdf ? "pdf" : "docx",
      bytes: bytes.byteLength,
    });
    const extracted = await extractDocumentText(bytes, isPdf ? "pdf" : "docx");
    await onStage("statute_binary_extract_done", { chars: extracted.length });
    gate("after_binary_extract");
    const processed = await processExtractedBody(extracted, { onStage, budgetExceeded });
    gate("after_post_extract");
    return processed.text;
  }

  // retrieval_budget_enforcement_v1: never decode/clean an opaque binary
  // (legacy OLE2 .doc, archives, images). Running the Hebrew decoder and the
  // markup-stripping regexes over binary noise is a synchronous CPU sink and
  // was killing the isolate mid-retrieval (F05: knesset .doc).
  if (looksBinary(bytes)) {
    await onStage("statute_binary_not_text_extractable", {
      bytes: bytes.byteLength,
      content_type: contentType,
    });
    throw new Error("statute_binary_not_text_extractable");
  }

  gate("before_decode");
  const decoded = decodeHebrew(bytes.slice(0, STATUTE_ACQUISITION_LIMITS.MAX_DECODE_BYTES));
  gate("after_decode");
  const processed = await processExtractedBody(stripMarkup(decoded), {
    onStage,
    budgetExceeded,
  });
  return processed.text;
}

/**
 * Cheap binary sniff over a bounded prefix: OLE2/RTF/archive magic bytes, or a
 * high ratio of control/NUL bytes. Bounded work — never scans the whole file.
 */
export function looksBinary(bytes: Uint8Array): boolean {
  if (bytes.byteLength === 0) return true;
  const b = bytes.subarray(0, Math.min(4096, bytes.byteLength));
  // OLE2 compound file (legacy .doc/.xls): D0 CF 11 E0
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return true;
  let control = 0;
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (c === 0) return true;
    if (c < 9 || (c > 13 && c < 32)) control++;
  }
  return control / b.length > 0.05;
}


export interface StatuteAcquisitionInput {
  candidates: Candidate[];
  statuteSectionRefs: StatuteSectionRef[];
  retrieval_budget?: { exceeded: () => boolean; allowExtraction?: (bytes: number) => boolean };
  markDurable?: StatuteStageSink;
}

/**
 * Acquire statutory text for admitted official statute candidates that a
 * statute-section anchor depends on.
 */
export async function runStatuteTextAcquisition(
  input: StatuteAcquisitionInput,
): Promise<StatuteAcquisitionResult> {
  const t0 = Date.now();
  const onStage: StatuteStageSink = input.markDurable ?? (() => {});
  const budgetExceeded = () =>
    (input.retrieval_budget?.exceeded() ?? false) ||
    Date.now() - t0 > STATUTE_ACQUISITION_LIMITS.TOTAL_MS;

  const attempts: StatuteAcquisitionAttempt[] = [];
  const acquired: string[] = [];
  const refs = input.statuteSectionRefs ?? [];
  if (refs.length === 0) {
    return {
      attempted: 0,
      successes: 0,
      attempts,
      acquired_candidate_ids: [],
      stage_stop_reason: "no_eligible_candidates",
      retrieval_budget_exceeded: false,
      ms: Date.now() - t0,
    };
  }

  // Eligible = admitted candidate, official statute host, title matches the
  // statute of a required section anchor, and the section text is not already
  // visible in title+snippet.
  type Eligible = { c: Candidate; ref: StatuteSectionRef };
  const eligible: Eligible[] = [];
  for (const c of input.candidates) {
    const url = c.source_url ?? null;
    if (!url) continue;
    if (!STATUTE_HOST_RE.test(hostOf(url))) continue;
    if (!looksStatuteSource(c)) continue;
    const title = String(c.title ?? "");
    const hay = `${title}\n${String(c.snippet ?? "")}`;
    const ref = refs.find((r) => r.title_patterns.some((re) => re.test(title)));
    if (!ref) continue;
    const meta = (c.metadata ?? {}) as Record<string, unknown>;
    if (meta.statute_text_acquired === true) continue;
    const alreadyVisible = ref.section_variants.some((v) => v.length >= 2 && hay.includes(v)) &&
      String(c.snippet ?? "").length >= 1200;
    if (alreadyVisible) continue;
    eligible.push({ c, ref });
  }

  if (eligible.length === 0) {
    return {
      attempted: 0,
      successes: 0,
      attempts,
      acquired_candidate_ids: [],
      stage_stop_reason: "no_eligible_candidates",
      retrieval_budget_exceeded: false,
      ms: Date.now() - t0,
    };
  }

  // Prefer official gov/knesset hosts over mirrors, longer titles last.
  eligible.sort((a, b) => {
    const rank = (e: Eligible) => (/(knesset|gov)\.il$/i.test(hostOf(e.c.source_url)) ? 0 : 1);
    return rank(a) - rank(b);
  });

  let stop: StatuteAcquisitionResult["stage_stop_reason"] = "completed";
  let budgetHit = false;
  let attempted = 0;

  for (const e of eligible) {
    if (attempted >= STATUTE_ACQUISITION_LIMITS.MAX_ATTEMPTS) {
      stop = "attempt_budget_exhausted";
      break;
    }
    if (budgetExceeded()) {
      budgetHit = true;
      stop = "retrieval_budget_exceeded";
      break;
    }
    const url = String(e.c.source_url);
    const a0 = Date.now();
    attempted++;
    await onStage("statute_attempt_start", {
      candidate_id: e.c.candidate_id,
      host: hostOf(url),
      ref_id: e.ref.ref_id,
    });
    try {
      const text = await acquireStatuteTextFromUrl(
        url,
        budgetExceeded,
        onStage,
        (bytes: number) => input.retrieval_budget?.allowExtraction?.(bytes) ?? true,
      );
      if (text.length < STATUTE_ACQUISITION_LIMITS.MIN_USABLE_TEXT) {
        throw new Error("statute_text_below_threshold");
      }
      const { window, found } = sectionWindow(text, e.ref);
      const stored = (found ? window : text).slice(0, STATUTE_ACQUISITION_LIMITS.MAX_TEXT);
      const integ = ((e.c.metadata ?? {}) as Record<string, unknown>).source_integrity as
        | SourceIntegrity
        | undefined;
      if (integ) {
        integ.text_usability = (stored.length >= 1200 ? "full_text" : "substantive_excerpt") as
          SourceIntegrity["text_usability"];
        integ.integrity_flags = [
          ...(integ.integrity_flags ?? []),
          "statute_text_acquired",
          "body_acquired",
          ...(found ? ["statute_section_text_located"] : []),
        ];
        integ.reject = false;
        delete integ.reject_reason;
      }
      e.c.metadata = {
        ...(e.c.metadata ?? {}),
        ...(integ ? { source_integrity: integ } : {}),
        extended_text: stored,
        statute_text_acquired: true,
        body_acquired: true,
        statute_section_text_located: found,
        statute_section_ref_id: e.ref.ref_id,
        final_text_usability: stored.length >= 1200 ? "full_text" : "substantive_excerpt",
      };
      if ((e.c.snippet || "").length < 400) e.c.snippet = stored.slice(0, 1200);
      acquired.push(e.c.candidate_id);
      attempts.push({
        candidate_id: e.c.candidate_id,
        url,
        title: String(e.c.title ?? ""),
        ref_id: e.ref.ref_id,
        ok: true,
        chars: stored.length,
        section_found: found,
        ms: Date.now() - a0,
      });
      await onStage("statute_attempt_ok", {
        candidate_id: e.c.candidate_id,
        chars: stored.length,
        section_found: found,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (reason === "retrieval_timeout") {
        budgetHit = true;
        stop = "retrieval_budget_exceeded";
      }
      attempts.push({
        candidate_id: e.c.candidate_id,
        url,
        title: String(e.c.title ?? ""),
        ref_id: e.ref.ref_id,
        ok: false,
        failure_reason: reason,
        ms: Date.now() - a0,
      });
      await onStage("statute_attempt_failed", {
        candidate_id: e.c.candidate_id,
        reason,
      });
      if (budgetHit) break;
    }
  }

  return {
    attempted,
    successes: acquired.length,
    attempts,
    acquired_candidate_ids: acquired,
    stage_stop_reason: stop,
    retrieval_budget_exceeded: budgetHit,
    ms: Date.now() - t0,
  };
}
