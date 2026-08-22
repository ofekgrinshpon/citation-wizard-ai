// Judgment-body acquisition as a first-class research stage.
//
// Scope: acquisition / source pipeline only. This module does NOT change the
// planner, verifier, sufficiency thresholds, drafter prompt, model routing, or
// any deterministic branch. It tries — in a bounded, deterministic way — to
// obtain real judgment body text for judgment candidates that matter to the
// answer, so sufficiency and drafting see primary authority instead of
// metadata rows and secondary commentary.
//
// Fail closed: if no usable body is found the source is left exactly as it was
// and the attempt is logged with its failure reasons.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import type { Candidate } from "../lib/types.ts";
import { extractDocumentText } from "../lib/attachments.ts";
import type { SourceIntegrity } from "./sourceIntegrity.ts";
import { assignSynthesisRole } from "./synthesisRole.ts";
import {
  detectDockets,
  normalizedDocketId,
  normalizedDocketVariants,
  textContainsExactDocket,
  type DocketRef,
} from "./docketDetection.ts";
import {
  rankJudgmentCandidates,
  type JudgmentRank,
  type RankInput,
} from "./judgmentCandidateRanking.ts";
import { processExtractedBody } from "./postExtract.ts";
import { looksBinary } from "./statuteTextAcquisition.ts";


export const ACQUISITION_LIMITS = {
  /** Per-method time box. */
  PER_METHOD_MS: 7000,
  /**
   * Hard per-candidate deadline. One candidate must never be able to consume
   * the whole isolate: fetch + decode + extract + post-extract for a single
   * attempt are all bounded by this.
   */
  PER_ATTEMPT_MS: 12_000,
  /** Whole-stage time box. */
  TOTAL_MS: 26000,
  /** Below this many chars the candidate counts as "not enough real text". */
  MIN_USABLE_TEXT: 400,
  /** Never store more than this — the snippet budget caps display anyway. */
  MAX_TEXT: 6000,
  /** Max bytes downloaded per file. */
  MAX_BYTES: 4 * 1024 * 1024,
  /**
   * CPU guard: never decode/normalize more than this many bytes of a raw
   * download. Judgment bodies we keep are capped at MAX_TEXT anyway, but
   * running Hebrew decoding + HTML stripping over multi-megabyte court files
   * is a real CPU sink and was killing the isolate mid-retrieval.
   */
  MAX_DECODE_BYTES: 1_200_000,
  /**
   * Above this size a PDF/DOCX is routed through the bounded/chunked
   * post-extract path with an explicit budget check between chunks, rather
   * than the straight-through path. Extraction itself still runs.
   */
  BOUNDED_EXTRACT_BYTES: 1_600_000,
  /**
   * Hard ceiling. Beyond this we fail closed with
   * `binary_too_large_for_extraction` — extraction of a binary this large
   * reliably exhausts the edge CPU quota.
   */
  MAX_EXTRACT_BYTES: 4 * 1024 * 1024,
  /**
   * Conservative pre-extract inline limit for *speculative* acquisition:
   * doctrine/survey candidates with no requested docket. `extractDocumentText`
   * is one uninterruptible synchronous CPU step — no budget check can preempt
   * it — so for candidates that are not the target authority we skip the file
   * instead of risking the worker. Exact-docket / requested-authority flows
   * keep the higher BOUNDED/MAX ceilings (G02/R02 official court PDFs).
   */
  MAX_INLINE_EXTRACTION_BYTES: 900_000,




  /** CPU guard: cap the character length fed to the text-cleaning regexes. */
  MAX_RAW_CHARS: 300_000,
  /** Legacy global cap (kept for reference; per-role budgets are used now). */
  MAX_ATTEMPTS: 2,
} as const;


/** Per-mode acquisition budgets (attempts, not sources). */
export const ACQUISITION_BUDGETS: Record<string, { leading: number; other: number; total: number }> = {
  specific_case: { leading: 3, other: 1, total: 3 },
  case_law_synthesis: { leading: 2, other: 2, total: 4 },
  doctrine_explanation: { leading: 3, other: 2, total: 3 },
  generic: { leading: 3, other: 2, total: 3 },
};

/** Modes that may carry judgment candidates. Others are untouched. */
const JUDGMENT_BEARING_MODES = new Set([
  "specific_case",
  "case_law_synthesis",
  "doctrine_explanation",
  "generic",
]);

const ACQUIRABLE_ROLES = new Set([
  "leading_candidate",
  "applying_candidate",
  "limiting_or_distinguishing_candidate",
]);

const ROLE_PRIORITY: Record<string, number> = {
  leading_candidate: 0,
  applying_candidate: 1,
  limiting_or_distinguishing_candidate: 2,
  unknown: 3,
};

const THIN_USABILITY = new Set(["metadata_only", "unusable", "unknown"]);

const FILE_URL_RE = /\.(pdf|docx?|rtf|txt)(\?|#|$)/i;

/** Court download endpoints that serve a file without a file extension. */
const DIRECT_DOWNLOAD_RE = /(\/Home\/Download\?|[?&]path=|[?&]fileName=|[?&]download=)/i;

/**
 * Institutional / navigational pages on official hosts. These are NOT judgment
 * bodies and must never consume a leading-candidate acquisition attempt.
 */
export const INSTITUTIONAL_PAGE_RE =
  /(\/Pages\/(Overview|About|Default|Home|Contact|Search|Info)\b|\/about\b|\/overview\b|\/HomePage|\/Units\/|\/Pages\/default\.aspx)/i;

/** Listing / index / archive pages (results, pagination, archives). */
export const LISTING_PAGE_RE =
  /(PadiArchive|SearchResults?|\/search\b|[?&]page=\d+|[?&]skip=\d+|\/archive\b|\/index\b|\/tags?\/|\/category\/|verdicts?list|psakim\/?$)/i;

/** Summary/aggregator hosts: usable for docket extraction, never as a body. */
export const SUMMARY_HOST_RE = /(nevo\.co\.il|psakdin\.co\.il|takdin\.co\.il|pador)/i;

/**
 * Hosts whose plain-text downloads may be treated as judgment text.
 * Israeli Supreme Court decisions are served as `.txt` from these hosts.
 */
export const TRUSTED_COURT_TEXT_HOST_RE =
  /(^|\.)(supremedecisions\.court\.gov\.il|elyon1\.court\.gov\.il|court\.gov\.il)$/i;

export function isTrustedCourtTextHost(url: string): boolean {
  try {
    return TRUSTED_COURT_TEXT_HOST_RE.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function isDirectFileUrl(url: string): boolean {
  return FILE_URL_RE.test(url) || DIRECT_DOWNLOAD_RE.test(url);
}

export function isInstitutionalPage(url: string | null | undefined): boolean {
  const u = String(url ?? "");
  if (!u) return false;
  if (isDirectFileUrl(u)) return false;
  return INSTITUTIONAL_PAGE_RE.test(u);
}

export function isListingPage(url: string | null | undefined): boolean {
  const u = String(url ?? "");
  if (!u) return false;
  if (isDirectFileUrl(u)) return false;
  return LISTING_PAGE_RE.test(u);
}

/** Hebrew markers that indicate a real judgment body (not a listing page). */
export const JUDGMENT_BODY_RE =
  /(בבית\s+המשפט|בפני|כב['׳]?\s*הש(ופט|ופטת)|פסק[\-\s]?דין|החלטה|לפני:|העותר|המערער|המשיב)/;

/** Court / official hosts whose HTML pages may wrap a downloadable file. */
export const WRAPPER_HOST_RE = /(court\.gov\.il|gov\.il|nevo\.co\.il|knesset\.gov\.il)/i;

/** Recognizable Israeli judgment title, e.g. `פלוני נ' אלמוני`. */
export const JUDGMENT_TITLE_RE = /\S+\s+(נ'|נ׳|נגד)\s+\S+/;

export const HOLDING_TEXT_RE =
  /(אנו\s+פוסקים|הערעור\s+(מתקבל|נדחה)|העתירה\s+(מתקבלת|נדחית)|ניתן\s+היום|אשר\s+על\s+כן|לפיכך\s|נפסק\s+כי|קובע[ת]?\s+כי|הלכה\s+ש|בדעת\s+(רוב|מיעוט)|דעת\s+הרוב)/;

export type AcquisitionMethod =
  | "direct_file_fetch"
  | "local_db_docket_lookup"
  | "wrapper_file_resolve"
  | "summary_page_docket_resolve";

export interface AcquisitionAttemptLog {
  candidate_id: string;
  title: string;
  url: string | null;
  judgment_candidate: true;
  docket_signal: string | null;
  docket_normalized: string | null;
  title_signal: string | null;
  synthesis_role: string;
  trigger_reason:
    | "metadata_only"
    | "unusable_or_unknown"
    | "text_below_threshold"
    | "no_judgment_body_text";
  acquisition_attempted: boolean;
  methods_attempted: AcquisitionMethod[];
  acquisition_methods_attempted: AcquisitionMethod[];
  method_succeeded: AcquisitionMethod | null;
  success: boolean;
  acquisition_success: boolean;
  acquisition_failure_reasons: string[];
  extracted_text_length: number;
  acquired_text_length: number;
  body_contains_docket_or_title: boolean;
  has_holding_text: boolean;
  text_usability_before: string;
  text_usability_after: string;
  final_text_usability: string;
  usable_for_holding: boolean;
  can_support_synthesis_holding: boolean;
  failure_reason: string | null;
  ms: number;
}

export interface AcquisitionSkipLog {
  candidate_id: string;
  title: string;
  url: string | null;
  reason:
    | "institutional_page"
    | "listing_page"
    | "no_docket_or_title_signal"
    | "statute_or_regulation"
    | "scholarship_without_case_identity"
    | "already_has_usable_text"
    | "budget_exhausted"
    | "docket_mismatch_specific_case"
    | "stage_time_budget_exhausted"
    | "speculative_extraction_stopped"
    | "retrieval_budget_exceeded";

}

/** Part 1 — per-candidate eligibility diagnostics for non-attempted judgments. */
export interface EligibilityDiagnostic {
  candidate_id: string;
  title: string;
  url: string | null;
  source_type: string | null;
  citable_as: string | null;
  authority_tier: string | null;
  text_usability: string | null;
  docket_normalized: string | null;
  has_docket_signal: boolean;
  has_case_title_signal: boolean;
  has_court_url: boolean;
  has_download_url: boolean;
  has_party_names: boolean;
  synthesis_role: string;
  planner_role: string | null;
  eligible: boolean;
  excluded_reason: string | null;
  ineligible_reason: string | null;
  eligibility_basis: string[];
  would_have_been_attempted_under_relaxed_rule: boolean;
  acquisition_attempted: boolean;
  rank_before_acquisition?: number;
  rank_score?: number;
  rank_reason?: string;
}

export interface AcquisitionResult {
  enabled: boolean;
  mode: string | null;
  budget: { leading: number; other: number; total: number } | null;
  judgment_candidates: number;
  eligible_count: number;
  excluded: AcquisitionSkipLog[];
  eligibility_diagnostics: EligibilityDiagnostic[];
  attempts: AcquisitionAttemptLog[];
  attempts_made: number;
  successes: number;
  ms: number;
  /** Ranking telemetry — computed before any budget is spent. */
  judgment_candidate_rank_before_acquisition: JudgmentRank[];
  acquisition_budget_spent_on: Array<{
    candidate_id: string;
    title: string;
    url: string | null;
    rank: number;
    rank_reason: string;
    official_judgment_document: boolean;
    success: boolean;
  }>;
  skipped_higher_quality_candidates: number;
  institutional_pages_excluded_before_budget: number;
  official_judgment_documents_found: number;
  official_judgment_documents_acquired: number;
  /** Controlled reason the loop stopped early (null = ran to completion). */
  stage_stop_reason: string | null;
  /** True when the pipeline retrieval budget stopped acquisition. */
  retrieval_budget_exceeded: boolean;
  /** f07_extraction_stability_v1 — speculative acquisition stopped early. */
  speculative_extraction_stopped: boolean;

}


export function normText(s: string): string {
  return (s || "").replace(/\u0000/g, " ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

/** Dockets carried by a candidate's identity fields (title/url/citation). */
function identityDockets(c: Candidate): DocketRef[] {
  const meta = (c.metadata ?? {}) as Record<string, unknown>;
  const citation = [meta.citation, meta.case_number]
    .filter((x) => typeof x === "string")
    .join(" ");
  return detectDockets(`${c.title ?? ""} ${citation} ${c.source_url ?? ""}`);
}

/** Dockets anywhere on the candidate, including a summary-page snippet. */
function anyDockets(c: Candidate): DocketRef[] {
  const found = new Map<string, DocketRef>();
  for (const d of [...identityDockets(c), ...detectDockets(c.snippet ?? "")]) {
    found.set(d.docket_id, d);
  }
  return [...found.values()];
}

function availableTextLength(c: Candidate): number {
  const meta = (c.metadata ?? {}) as Record<string, unknown>;
  const ext = typeof meta.extended_text === "string" ? meta.extended_text : "";
  return Math.max((c.snippet || "").length, ext.length);
}

export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: number | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, rej) => {
        t = setTimeout(() => rej(new Error(`${label}_timeout`)), ms) as unknown as number;
      }),
    ]);
  } finally {
    if (t !== undefined) clearTimeout(t);
  }
}

/** Fine-grained stage marker sink (diagnostics only). */
export type StageSink = (name: string, detail?: Record<string, unknown>) => void | Promise<void>;

async function fetchBytes(
  url: string,
  signal?: AbortSignal,
  opts: { onStage?: StageSink; maxBytes?: number } = {},
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const onStage = opts.onStage ?? (() => {});
  onStage("fetch_start", { url });
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ReLexBot/1.0)" },
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  const declaredLength = Number(res.headers.get("content-length") || "0") || 0;
  onStage("response_headers", { status: res.status, contentType, declaredLength });
  // Read with a hard byte cap and cancel the rest of the stream: court hosts
  // serve multi-MB bodies slowly, and buffering all of them is the dominant
  // wall/CPU cost. Text bodies are capped at the decode window (nothing beyond
  // it is ever decoded); binary documents keep the full MAX_BYTES envelope
  // because truncating a PDF/DOCX would break extraction.
  // Content-type wins: court.gov.il serves `*.txt` verdict URLs as real PDFs
  // (`Content-Type: application/pdf`), so the extension must never override it.
  const binary = /pdf|wordprocessingml|officedocument|msword|octet-stream/.test(contentType) ||
    /\.(pdf|docx?|zip)(\?|#|$)/i.test(url);


  let CAP = binary
    ? ACQUISITION_LIMITS.MAX_BYTES
    : Math.min(ACQUISITION_LIMITS.MAX_BYTES, ACQUISITION_LIMITS.MAX_DECODE_BYTES + 65_536);
  if (opts.maxBytes && opts.maxBytes > 0) {
    // Explicit shape gate (fast lane): a body declared larger than the caller
    // can afford is refused up front instead of being buffered and decoded.
    if (binary && declaredLength > opts.maxBytes) {
      try {
        await res.body?.cancel();
      } catch { /* already closed */ }
      onStage("body_too_large", { declaredLength, maxBytes: opts.maxBytes });
      throw new Error("body_too_large_for_budget");
    }
    CAP = Math.min(CAP, opts.maxBytes);
  }
  const reader = res.body?.getReader();
  if (!reader) return { bytes: new Uint8Array(0), contentType };
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < CAP) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch { /* stream already closed */ }
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  onStage("body_read_done", { bytes: total, capped: total >= CAP });
  return { bytes: buf, contentType };
}


/**
 * Decode Hebrew bytes safely: UTF-8 first, windows-1255 fallback.
 *
 * CPU guard: only the first `MAX_DECODE_BYTES` are decoded, and the encoding
 * decision is made on a small head sample rather than the whole buffer. A
 * judgment's identity, docket line and holding all sit far inside that window,
 * and we never store more than `MAX_TEXT` anyway.
 */
export function decodeHebrew(bytes: Uint8Array): string {
  const capped = bytes.byteLength > ACQUISITION_LIMITS.MAX_DECODE_BYTES
    ? bytes.subarray(0, ACQUISITION_LIMITS.MAX_DECODE_BYTES)
    : bytes;
  const sample = capped.subarray(0, Math.min(capped.byteLength, 65_536));
  const utf8Sample = new TextDecoder("utf-8", { fatal: false }).decode(sample);
  const replacementRatio = (utf8Sample.match(/\uFFFD/g)?.length ?? 0) /
    Math.max(utf8Sample.length, 1);
  const hasHebrew = /[\u0590-\u05FF]/.test(utf8Sample);
  if (hasHebrew && replacementRatio < 0.01) {
    return new TextDecoder("utf-8", { fatal: false }).decode(capped);
  }
  try {
    const cp1255Sample = new TextDecoder("windows-1255", { fatal: false }).decode(sample);
    if (/[\u0590-\u05FF]/.test(cp1255Sample)) {
      return new TextDecoder("windows-1255", { fatal: false }).decode(capped);
    }
  } catch { /* decoder unavailable */ }
  return new TextDecoder("utf-8", { fatal: false }).decode(capped);
}

/** Strip HTML/RTF-ish wrappers a court .txt file may still carry. */
function plainTextFromTxt(raw: string): string {
  // CPU guard: the cleaning regexes below are O(n) with heavy backtracking
  // potential on huge inputs. Bound the working string first.
  let s = (raw || "").length > ACQUISITION_LIMITS.MAX_RAW_CHARS
    ? raw.slice(0, ACQUISITION_LIMITS.MAX_RAW_CHARS)
    : raw;
  if (/<\s*(html|body|p|div|br)\b/i.test(s)) {
    s = s.replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"');
  }
  return normText(s);
}


export interface DirectFileOptions {
  /**
   * Allow plain-text downloads. Only ever enabled for trusted court hosts —
   * the caller must also validate that the text is a real judgment body.
   */
  allowPlainText?: boolean;
  /** Extra gate applied to plain-text downloads (e.g. exact-docket check). */
  validateText?: (text: string) => boolean;
  /** Hard network-layer abort for the underlying fetch. */
  signal?: AbortSignal;
  /** Fine-grained stage markers (diagnostics for silent-hang triage). */
  onStage?: StageSink;
  /** Shape gate: refuse bodies larger than this instead of buffering them. */
  maxBytes?: number;
  /**
   * Pre-extract inline gate. When set and the downloaded binary exceeds it,
   * `extractDocumentText` is never called and the attempt fails closed with
   * `binary_too_large_for_inline_extraction`.
   */
  maxInlineExtractionBytes?: number;
  /**
   * Time-budget gate consulted before every expensive synchronous step
   * (decode, clean, PDF/DOCX extraction). Returning true fails closed.
   */
  budgetExceeded?: () => boolean;
  /**
   * Run-level ledger for uninterruptible binary extraction. Returning false
   * means this run has already spent its extraction allowance.
   */
  allowExtraction?: (bytes: number) => boolean;
  /** Charge the extracted character count back to the run ledger. */
  noteExtractionOutput?: (chars: number) => void;
  /**
   * large_pdf_extraction_preemption_v1 — final gate immediately before the
   * uninterruptible `extractDocumentText` call. Returning `allow: false` means
   * extraction is never entered and the attempt fails closed with
   * `pdf_extraction_preempted`.
   */
  preflight?: (info: {
    bytes: number;
    contentType: string;
    url: string;
    kind: "pdf" | "docx";
  }) => { allow: boolean; reason: string | null; detail?: Record<string, unknown> };
}



/** Method 1 — the URL already points at a judgment file. */
export async function tryDirectFile(url: string, opts: DirectFileOptions = {}): Promise<string> {
  const onStage = opts.onStage ?? (() => {});
  const gate = (where: string) => {
    if (opts.budgetExceeded?.()) {
      onStage("budget_exceeded", { where });
      throw new Error("retrieval_timeout");
    }
  };
  gate("before_fetch");
  const { bytes, contentType } = await fetchBytes(url, opts.signal, {
    onStage,
    maxBytes: opts.maxBytes,
  });
  gate("after_fetch");
  // Content-type first, then extension, then magic bytes (court download
  // endpoints often serve octet-stream with no extension in the URL).
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 8));
  const isPdf =
    /pdf/.test(contentType) || /\.pdf(\?|#|$)/i.test(url) || head.startsWith("%PDF");
  const isDocx =
    /wordprocessingml|officedocument/.test(contentType) ||
    /\.docx(\?|#|$)/i.test(url) ||
    head.startsWith("PK");
  // Legacy binary .doc (OLE2 compound file) — magic bytes D0 CF 11 E0.
  const isLegacyDoc =
    /msword/.test(contentType) ||
    /\.doc(\?|#|$)/i.test(url) ||
    head.charCodeAt(0) === 0xd0 && head.charCodeAt(1) === 0xcf;
  if (isPdf || isDocx) {
    gate("before_binary_extract");
    if (bytes.byteLength > ACQUISITION_LIMITS.MAX_EXTRACT_BYTES) {
      // Hard ceiling only: fail closed rather than risk an isolate kill.
      onStage("binary_too_large_for_extraction", {
        bytes: bytes.byteLength,
        limit: ACQUISITION_LIMITS.MAX_EXTRACT_BYTES,
      });
      throw new Error("binary_too_large_for_extraction");
    }
    if (
      opts.maxInlineExtractionBytes !== undefined &&
      bytes.byteLength > opts.maxInlineExtractionBytes
    ) {
      // Speculative (non-docket) acquisition: extraction is uninterruptible,
      // so skip rather than enter it.
      await onStage("binary_too_large_for_inline_extraction", {
        reason: "binary_too_large_for_inline_extraction",
        bytes: bytes.byteLength,
        limit: opts.maxInlineExtractionBytes,
        content_type: contentType,
        kind: isPdf ? "pdf" : "docx",
      });
      throw new Error("binary_too_large_for_inline_extraction");
    }

    const bounded = bytes.byteLength > ACQUISITION_LIMITS.BOUNDED_EXTRACT_BYTES;
    if (bounded) {
      // Mid-size official PDFs (e.g. the 2.34 MB court.gov.il verdict) are
      // extracted, then processed through the chunked post-extract path with a
      // budget check between chunks — never rejected up front.
      onStage("binary_bounded_extract_path", {
        bytes: bytes.byteLength,
        threshold: ACQUISITION_LIMITS.BOUNDED_EXTRACT_BYTES,
      });
    }
    if (opts.allowExtraction && !opts.allowExtraction(bytes.byteLength)) {
      await onStage("binary_extraction_budget_spent", { bytes: bytes.byteLength });
      throw new Error("extraction_budget_spent");
    }
    // large_pdf_extraction_preemption_v1: last gate before the uninterruptible
    // synchronous step. Once `extractDocumentText` is entered nothing — not the
    // abort signal, not the deadline — can stop it, so an unaffordable body
    // must be refused *here*, with a durable checkpoint.
    if (opts.preflight) {
      const pf = opts.preflight({
        bytes: bytes.byteLength,
        contentType,
        url,
        kind: isPdf ? "pdf" : "docx",
      });
      if (!pf.allow) {
        await onStage("binary_extraction_preempted", {
          bytes: bytes.byteLength,
          reason: pf.reason,
          ...(pf.detail ?? {}),
        });
        throw new Error("pdf_extraction_preempted");
      }
    }
    gate("before_binary_extract_run");

    // Awaited: extraction is a long synchronous CPU step that can block the
    // event loop hard enough that a fire-and-forget checkpoint never leaves
    // the isolate. The trail must be durable *before* we enter it.
    await onStage("binary_extract_start", { kind: isPdf ? "pdf" : "docx", bytes: bytes.byteLength, bounded });
    const extracted = await extractDocumentText(bytes, isPdf ? "pdf" : "docx");
    // f07_extraction_stability_v1: charge the real cost (extracted chars, not
    // only input bytes) back to the run ledger before any cleaning work.
    opts.noteExtractionOutput?.(extracted.length);
    onStage("binary_extract_done", { chars: extracted.length, bounded });

    // Never clean/normalize/identity-match a multi-hundred-kilochar extraction
    // in one synchronous pass — that is what killed the isolate.
    gate("after_binary_extract");
    const processed = await processExtractedBody(extracted, {
      onStage,
      budgetExceeded: opts.budgetExceeded,
      validateText: opts.validateText,
    });
    gate("after_post_extract");
    return processed.text;

  }

  if (isLegacyDoc && !head.startsWith("PK")) {
    // mammoth cannot read OLE2 .doc; salvage readable Hebrew runs instead —
    // but only over a bounded prefix, and never for opaque binaries whose
    // decode + cleaning regexes are a synchronous CPU sink.
    gate("before_legacy_doc_decode");
    if (bytes.byteLength > ACQUISITION_LIMITS.MAX_DECODE_BYTES) {
      onStage("legacy_doc_too_large", { bytes: bytes.byteLength });
      throw new Error("legacy_doc_too_large");
    }
    onStage("legacy_doc_decode_start", { bytes: bytes.byteLength });
    const salvaged = plainTextFromTxt(
      decodeHebrew(bytes.subarray(0, ACQUISITION_LIMITS.MAX_DECODE_BYTES)),
    ).replace(/[^\S\n]{3,}/g, " ");
    onStage("legacy_doc_decode_done", { chars: salvaged.length });
    if (salvaged.length >= ACQUISITION_LIMITS.MIN_USABLE_TEXT && JUDGMENT_BODY_RE.test(salvaged)) {
      if (opts.validateText && !opts.validateText(salvaged)) {
        throw new Error("legacy_doc_docket_mismatch");
      }
      return salvaged;
    }
    throw new Error("legacy_doc_not_extractable");
  }

  const looksTextual =
    /text\/plain|charset|octet-stream/.test(contentType) ||
    /\.txt(\?|#|$)/i.test(url) ||
    DIRECT_DOWNLOAD_RE.test(url);
  if (!opts.allowPlainText || !looksTextual) throw new Error("not_a_document_file");
  if (!isTrustedCourtTextHost(url)) throw new Error("plain_text_host_not_trusted");

  if (looksBinary(bytes)) {
    onStage("binary_not_text_extractable", { bytes: bytes.byteLength, content_type: contentType });
    throw new Error("binary_not_text_extractable");
  }
  gate("before_decode");
  onStage("decode_start", { bytes: bytes.byteLength });
  const decoded = decodeHebrew(bytes);
  onStage("decode_done", { chars: decoded.length });
  gate("before_clean");
  onStage("clean_start", { chars: decoded.length });
  const text = plainTextFromTxt(decoded);
  onStage("clean_done", { chars: text.length });
  gate("after_clean");
  if (text.length < ACQUISITION_LIMITS.MIN_USABLE_TEXT) {
    throw new Error("plain_text_below_threshold");
  }
  if (!JUDGMENT_BODY_RE.test(text)) throw new Error("plain_text_not_judgment_like");
  onStage("identity_check_start");
  if (opts.validateText && !opts.validateText(text)) {
    throw new Error("plain_text_docket_mismatch");
  }
  onStage("identity_check_passed", { chars: text.length });
  return text;

}

/** Method 2 — pull the full text we already store locally, by docket / title. */
export async function tryLocalDb(
  admin: SupabaseClient,
  docket: string | null,
  title: string | null,
): Promise<string> {
  const filters: string[] = [];
  if (docket) {
    const d = docket.replace(/["״']/g, "");
    filters.push(`case_number.ilike.%${d}%`, `citation.ilike.%${d}%`, `title.ilike.%${d}%`);
  }
  if (!filters.length && title) {
    const t = title.replace(/[%,()]/g, " ").trim().slice(0, 60);
    if (t.length < 8) throw new Error("no_docket_or_title_signal");
    filters.push(`title.ilike.%${t}%`);
  }
  if (!filters.length) throw new Error("no_docket_or_title_signal");

  const { data: docs, error } = await admin
    .from("legal_documents")
    .select("id,title")
    .or(filters.join(","))
    .limit(3);
  if (error) throw new Error(`db_error:${error.message}`);
  if (!docs || docs.length === 0) throw new Error("no_local_document_match");

  const { data: chunks, error: cErr } = await admin
    .from("legal_document_chunks")
    .select("content")
    .eq("document_id", docs[0].id)
    .limit(6);
  if (cErr) throw new Error(`db_error:${cErr.message}`);
  const text = normText((chunks ?? []).map((c) => String(c.content ?? "")).join("\n"));
  if (!text) throw new Error("local_document_has_no_chunks");
  return text;
}

/**
 * Docket-keyed local resolution: normalized docket variants, verified against
 * the stored row's own case_number / citation / title before the body is used.
 */
export async function tryLocalDbByDockets(
  admin: SupabaseClient,
  dockets: DocketRef[],
): Promise<string> {
  if (dockets.length === 0) throw new Error("no_docket_signal");
  const filters: string[] = [];
  const numbers = new Set<string>();
  for (const d of dockets) {
    numbers.add(d.number);
    numbers.add(d.number.replace(/\//g, "-"));
    for (const v of normalizedDocketVariants(d)) numbers.add(v);
  }
  for (const n of numbers) {
    const safe = n.replace(/[,%()]/g, " ").trim();
    if (safe.length < 4) continue;
    filters.push(`case_number.ilike.%${safe}%`, `citation.ilike.%${safe}%`, `title.ilike.%${safe}%`);
  }
  if (!filters.length) throw new Error("no_docket_signal");

  const { data: docs, error } = await admin
    .from("legal_documents")
    .select("id,title,citation,case_number")
    .or(filters.slice(0, 40).join(","))
    .limit(5);
  if (error) throw new Error(`db_error:${error.message}`);
  if (!docs || docs.length === 0) throw new Error("no_local_document_match");

  const hit = docs.find((d) =>
    dockets.some((dk) =>
      textContainsExactDocket(String(d.case_number ?? ""), dk) ||
      textContainsExactDocket(String(d.citation ?? ""), dk) ||
      textContainsExactDocket(String(d.title ?? ""), dk)
    )
  );
  if (!hit) throw new Error("no_exact_docket_document_match");

  const { data: chunks } = await admin
    .from("legal_document_chunks")
    .select("content")
    .eq("document_id", hit.id)
    .order("chunk_index", { ascending: true })
    .limit(8);
  const text = normText((chunks ?? []).map((c) => String(c.content ?? "")).join("\n"));
  if (text.length < ACQUISITION_LIMITS.MIN_USABLE_TEXT) {
    throw new Error("local_document_text_below_threshold");
  }
  return text;
}

/**
 * Method 3 — an HTML wrapper page on a court host that links the real file.
 *
 * Conservative by design: only a direct document/download link is followed.
 * Listing / archive pages (e.g. Nevo `PadiArchive.aspx`) that expose no
 * document link fail closed — their own page text is never treated as
 * judgment text.
 */
export async function tryWrapperResolve(
  url: string,
  opts: DirectFileOptions = {},
): Promise<string> {
  const onStage = opts.onStage ?? (() => {});
  onStage("wrapper_fetch_start", { url });
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ReLexBot/1.0)" },
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  const html = (await res.text()).slice(0, 400_000);
  onStage("wrapper_body_read_done", { chars: html.length });
  if (opts.budgetExceeded?.()) {
    onStage("budget_exceeded", { where: "wrapper_resolve" });
    throw new Error("retrieval_timeout");
  }
  const hrefs = Array.from(html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)).map((m) => m[1]);
  const fileHref = hrefs.find((h) => FILE_URL_RE.test(h) || DIRECT_DOWNLOAD_RE.test(h));
  if (!fileHref) throw new Error("no_downloadable_file_on_wrapper");
  const abs = new URL(fileHref, url).toString();
  onStage("wrapper_resolved_file", { abs });
  return await tryDirectFile(abs, opts);
}

export interface AcquisitionInput {
  admin: SupabaseClient;
  research_mode: string | null;
  candidates: Candidate[];
  /** Question text — used to prioritise the exact requested docket. */
  question?: string | null;
  /**
   * The pipeline-level retrieval budget. When supplied, the acquisition loop
   * consults it before every attempt and between every expensive step, and
   * stops with a controlled reason instead of letting the isolate die.
   */
  retrieval_budget?: {
    exceeded(): boolean;
    remaining(): number;
    allowExtraction?(bytes: number, opts?: { speculative?: boolean }): boolean;
    noteExtractionOutput?(chars: number, opts?: { speculative?: boolean }): void;
    noteSpeculativeBodyAcquired?(): void;
    speculativeExtractionBlocked?(): boolean;
    noteBodyAcquisition?(n?: number): void;
  } | null;

  /**
   * Durable checkpoint sink (awaited). Used for per-attempt observability so a
   * killed isolate still leaves a trail of exactly where acquisition was.
   */
  markDurable?: (name: string, detail?: Record<string, unknown>) => Promise<void> | void;
}


interface Eligible {
  c: Candidate;
  integ: SourceIntegrity;
  role: string;
  dockets: DocketRef[];
  isRequested: boolean;
  trigger: AcquisitionAttemptLog["trigger_reason"];
  diag: EligibilityDiagnostic;
  rank?: JudgmentRank;
}

function disabledResult(mode: string | null): AcquisitionResult {
  return {
    enabled: false,
    mode,
    budget: null,
    judgment_candidates: 0,
    eligible_count: 0,
    excluded: [],
    eligibility_diagnostics: [],
    attempts: [],
    attempts_made: 0,
    successes: 0,
    ms: 0,
    judgment_candidate_rank_before_acquisition: [],
    acquisition_budget_spent_on: [],
    skipped_higher_quality_candidates: 0,
    institutional_pages_excluded_before_budget: 0,
    official_judgment_documents_found: 0,
    official_judgment_documents_acquired: 0,
    stage_stop_reason: null,
    retrieval_budget_exceeded: false,
    speculative_extraction_stopped: false,
  };
}

/** Legal-DB / aggregator pages: usable for docket resolution, never as a body. */
const LEGAL_DB_HOST_RE = /(nevo\.co\.il|psakdin\.co\.il|takdin\.co\.il|pador|lawdata|din\.co\.il)/i;

/**
 * Is this candidate a judgment candidate worth acquiring?
 * Widened: a judgment candidate is anything carrying real case identity —
 * a docket, an official court URL, or an Israeli case-title pattern — that is
 * not a statute/regulation and not identity-free scholarship.
 */
function isJudgmentCandidate(c: Candidate, integ: SourceIntegrity, dockets: DocketRef[]): boolean {
  const url = c.source_url ?? "";
  const typedJudgment = integ.citable_as === "judgment" || integ.is_judgment_document === true;
  const caseLike = /case|caselaw|judgment|court/i.test(String(c.source_type ?? ""));
  const courtUrl = /court\.gov\.il|supremedecisions/i.test(url);
  const legalDb = LEGAL_DB_HOST_RE.test(url);
  const titleSignal = JUDGMENT_TITLE_RE.test(c.title ?? "");
  const hasSignal = dockets.length > 0 || courtUrl || titleSignal;
  return (typedJudgment || caseLike || courtUrl || legalDb || titleSignal) && hasSignal;
}

/**
 * Bounded judgment-body acquisition. Mutates candidate metadata / integrity in
 * place on success only; returns telemetry for every attempt and exclusion.
 */
export async function runJudgmentTextAcquisition(
  input: AcquisitionInput,
): Promise<AcquisitionResult> {
  const t0 = Date.now();
  const mode = input.research_mode ?? null;
  if (!mode || !JUDGMENT_BEARING_MODES.has(mode)) return disabledResult(mode);

  const budget = ACQUISITION_BUDGETS[mode] ?? ACQUISITION_BUDGETS.generic;
  const requestedDockets = detectDockets(input.question ?? "");
  const excluded: AcquisitionSkipLog[] = [];
  const diagnostics: EligibilityDiagnostic[] = [];
  const eligible: Eligible[] = [];
  const rankInputs: RankInput[] = [];
  let judgmentCandidates = 0;

  for (const c of input.candidates) {
    const meta = (c.metadata ?? {}) as Record<string, unknown>;
    const integ = meta.source_integrity as SourceIntegrity | undefined;
    if (!integ) continue;

    const idDockets = identityDockets(c);
    // Summary/aggregator pages: mine the snippet for a docket, but never treat
    // their page text as a judgment body.
    const isSummaryHost = SUMMARY_HOST_RE.test(c.source_url ?? "");
    const dockets = isSummaryHost || idDockets.length === 0 ? anyDockets(c) : idDockets;

    if (!isJudgmentCandidate(c, integ, dockets)) continue;
    judgmentCandidates++;

    const url = c.source_url ?? null;
    const role = assignSynthesisRole({
      role: c.role,
      integrity: integ,
      title: c.title,
      snippet: c.snippet,
    }).synthesis_role;
    const titleSignal = JUDGMENT_TITLE_RE.test(c.title ?? "");
    const courtUrl = /court\.gov\.il|supremedecisions/i.test(url ?? "");
    const isRequested =
      requestedDockets.length > 0 &&
      requestedDockets.some((d) =>
        [c.title, c.source_url].some((f) => textContainsExactDocket(f, d))
      );

    const diag: EligibilityDiagnostic = {
      candidate_id: c.candidate_id,
      title: c.title,
      url,
      source_type: c.source_type ?? null,
      citable_as: integ.citable_as ?? null,
      authority_tier: integ.authority_tier ?? null,
      text_usability: integ.text_usability ?? null,
      docket_normalized: dockets[0] ? normalizedDocketId(dockets[0]) : null,
      has_docket_signal: dockets.length > 0,
      has_case_title_signal: titleSignal,
      has_court_url: courtUrl,
      has_download_url: !!url && isDirectFileUrl(url),
      has_party_names: titleSignal,
      synthesis_role: role,
      planner_role: (c.role as string | null) ?? null,
      eligible: false,
      excluded_reason: null,
      ineligible_reason: null,
      eligibility_basis: [],
      would_have_been_attempted_under_relaxed_rule: false,
      acquisition_attempted: false,
    };
    diagnostics.push(diag);
    rankInputs.push({
      candidate: c,
      integrity: integ,
      dockets,
      synthesis_role: role,
      is_requested_docket: isRequested,
      verdict: typeof meta.verifier_verdict === "string" ? meta.verifier_verdict : null,
      domain_match: meta.domain_match === true,
    });

    const drop = (reason: AcquisitionSkipLog["reason"], relaxed = false) => {
      excluded.push({ candidate_id: c.candidate_id, title: c.title, url, reason });
      diag.excluded_reason = reason;
      diag.ineligible_reason = reason;
      diag.would_have_been_attempted_under_relaxed_rule = relaxed;
    };

    // ── Hard exclusions (never spend budget) ────────────────────────────────
    if (isInstitutionalPage(url)) { drop("institutional_page"); continue; }
    if (isListingPage(url) && dockets.length === 0 && !titleSignal) { drop("listing_page"); continue; }
    if (integ.citable_as === "statute") { drop("statute_or_regulation"); continue; }
    if (
      (integ.citable_as === "scholarship" || integ.citable_as === "commentary") &&
      dockets.length === 0 && !titleSignal
    ) { drop("scholarship_without_case_identity"); continue; }
    // specific_case: never spend the (tiny) budget on a different case's
    // judgment — an adjacent docket can never answer the requested one.
    if (
      mode === "specific_case" && requestedDockets.length > 0 &&
      dockets.length > 0 && !isRequested &&
      !dockets.some((d) =>
        requestedDockets.some((r) => normalizedDocketId(d) === normalizedDocketId(r))
      )
    ) { drop("docket_mismatch_specific_case"); continue; }


    // ── Widened eligibility basis (any one suffices) ────────────────────────
    if (isRequested) diag.eligibility_basis.push("exact_requested_docket");
    if (dockets.length > 0) diag.eligibility_basis.push("docket_signal");
    if (courtUrl) diag.eligibility_basis.push("official_court_url");
    if (titleSignal) diag.eligibility_basis.push("case_title_party_names");
    if (LEGAL_DB_HOST_RE.test(url ?? "") && (dockets.length > 0 || titleSignal)) {
      diag.eligibility_basis.push("legal_db_resolution_only");
    }
    if (ACQUIRABLE_ROLES.has(role) && (dockets.length > 0 || titleSignal)) {
      diag.eligibility_basis.push("planner_role_with_case_identity");
    }
    if (diag.eligibility_basis.length === 0) { drop("no_docket_or_title_signal"); continue; }

    const usability = String(integ.text_usability ?? "unknown");
    const len = availableTextLength(c);
    let trigger: AcquisitionAttemptLog["trigger_reason"] | null = null;
    if (usability === "metadata_only") trigger = "metadata_only";
    else if (THIN_USABILITY.has(usability)) trigger = "unusable_or_unknown";
    else if (len < ACQUISITION_LIMITS.MIN_USABLE_TEXT) trigger = "text_below_threshold";
    // A long commentary/summary snippet about a judgment is not a judgment body:
    // if the candidate carries case identity but no judgment text, still try.
    else if (integ.is_judgment_document !== true || integ.has_holding_text !== true) {
      trigger = "no_judgment_body_text";
    }
    if (!trigger) {
      diag.ineligible_reason = "already_has_usable_text";
      continue;
    }

    diag.eligible = true;
    eligible.push({ c, integ, role, dockets, isRequested, trigger, diag });
  }


  // ── Pre-acquisition ranking (Part 1) ─────────────────────────────────────
  // Every judgment candidate is scored *before* a single byte is fetched, so
  // institutional / listing pages can never consume budget ahead of genuine
  // judgment documents.
  const ranked = rankJudgmentCandidates(rankInputs);
  const rankById = new Map(ranked.map((r) => [r.candidate_id, r]));
  for (const d of diagnostics) {
    const r = rankById.get(d.candidate_id);
    if (!r) continue;
    d.rank_before_acquisition = r.rank;
    d.rank_score = r.score;
    d.rank_reason = r.rank_reason;
  }
  for (const e of eligible) e.rank = rankById.get(e.c.candidate_id);

  const institutional_pages_excluded_before_budget = ranked.filter(
    (r) => r.is_institutional_or_listing,
  ).length;
  const official_judgment_documents_found = ranked.filter(
    (r) => r.is_official_judgment_document,
  ).length;

  // Exact requested docket first, then rank score, then role, then retrieval score.
  eligible.sort((a, b) =>
    Number(b.isRequested) - Number(a.isRequested) ||
    (b.rank?.score ?? 0) - (a.rank?.score ?? 0) ||
    (ROLE_PRIORITY[a.role] ?? 9) - (ROLE_PRIORITY[b.role] ?? 9) ||
    b.c.score - a.c.score
  );

  const budget_spent_on: AcquisitionResult["acquisition_budget_spent_on"] = [];

  const attempts: AcquisitionAttemptLog[] = [];
  let successes = 0;
  let leadingUsed = 0;
  let otherUsed = 0;

  // ── Observability / liveness plumbing (no behavioural change to ranking,
  //    eligibility or per-role budgets) ──────────────────────────────────────
  const retrievalBudget = input.retrieval_budget ?? null;
  const markDurable = input.markDurable;
  const mark = async (name: string, detail?: Record<string, unknown>) => {
    try {
      await markDurable?.(name, detail);
    } catch {
      /* checkpointing must never break acquisition */
    }
  };
  const hostOf = (u: string | null): string | null => {
    if (!u) return null;
    try {
      return new URL(u).host;
    } catch {
      return null;
    }
  };
  /** Durable checkpoint names emitted from the inner fetch/decode sink. */
  const DURABLE_STAGE_MAP: Record<string, string> = {
    fetch_start: "judgment_attempt_fetch_start",
    body_read_done: "judgment_attempt_fetch_done",
    body_too_large: "judgment_attempt_fetch_done",
    binary_extract_start: "judgment_attempt_extract_start",
    binary_extract_done: "judgment_attempt_extract_done",
    legacy_doc_decode_start: "judgment_attempt_extract_start",
    legacy_doc_decode_done: "judgment_attempt_extract_done",
    decode_start: "judgment_attempt_extract_start",
    decode_done: "judgment_attempt_extract_done",
    post_extract_start: "judgment_attempt_post_extract_start",
    post_extract_done: "judgment_attempt_post_extract_done",
    post_extract_too_large: "judgment_attempt_post_extract_done",
    post_extract_budget_exceeded: "judgment_attempt_post_extract_done",
    binary_too_large_for_inline_extraction: "judgment_attempt_skipped",
  };
  let stage_stop_reason: string | null = null;
  let retrieval_budget_exceeded = false;
  let speculative_extraction_stopped = false;

  let attemptIndex = 0;
  for (const e of eligible) {
    // Pipeline-level budget: stop the whole loop with a controlled reason
    // rather than letting the isolate be killed mid-attempt.
    if (retrievalBudget?.exceeded()) {
      retrieval_budget_exceeded = true;
      stage_stop_reason = "retrieval_budget_exceeded";
      await mark("judgment_acquisition_budget_exceeded", {
        attempts_made: attempts.length,
        remaining_candidates: eligible.length - attemptIndex,
        remaining_ms: retrievalBudget.remaining(),
      });
      excluded.push({
        candidate_id: e.c.candidate_id,
        title: e.c.title,
        url: e.c.source_url ?? null,
        reason: "retrieval_budget_exceeded",
      });
      e.diag.excluded_reason = "retrieval_budget_exceeded";
      e.diag.ineligible_reason = "retrieval_budget_exceeded";
      break;
    }
    if (attempts.length >= budget.total) {
      excluded.push({
        candidate_id: e.c.candidate_id,
        title: e.c.title,
        url: e.c.source_url ?? null,
        reason: "budget_exhausted",
      });
      e.diag.excluded_reason = "budget_exhausted";
      e.diag.ineligible_reason = "budget_exhausted";
      e.diag.would_have_been_attempted_under_relaxed_rule = true;
      await mark("judgment_attempt_skipped", {
        candidate_id: e.c.candidate_id,
        index: attemptIndex++,
        host: hostOf(e.c.source_url ?? null),
        reason: "budget_exhausted",
      });
      continue;
    }
    if (Date.now() - t0 > ACQUISITION_LIMITS.TOTAL_MS) {
      stage_stop_reason = stage_stop_reason ?? "stage_time_budget_exhausted";
      excluded.push({
        candidate_id: e.c.candidate_id,
        title: e.c.title,
        url: e.c.source_url ?? null,
        reason: "stage_time_budget_exhausted",
      });
      e.diag.excluded_reason = "stage_time_budget_exhausted";
      e.diag.ineligible_reason = "stage_time_budget_exhausted";
      e.diag.would_have_been_attempted_under_relaxed_rule = true;
      await mark("judgment_attempt_skipped", {
        candidate_id: e.c.candidate_id,
        index: attemptIndex++,
        host: hostOf(e.c.source_url ?? null),
        reason: "stage_time_budget_exhausted",
      });
      continue;
    }
    // f07_extraction_stability_v1 — speculative acquisition stops entirely once
    // one usable body has already been acquired in this run. Further bodies buy
    // little and cost uninterruptible synchronous CPU that can kill the isolate.
    if (
      !e.isRequested && requestedDockets.length === 0 && successes > 0 &&
      (retrievalBudget?.speculativeExtractionBlocked?.() ?? false)
    ) {
      stage_stop_reason = stage_stop_reason ?? "speculative_extraction_stopped";
      speculative_extraction_stopped = true;
      excluded.push({
        candidate_id: e.c.candidate_id,
        title: e.c.title,
        url: e.c.source_url ?? null,
        reason: "speculative_extraction_stopped",
      });
      e.diag.excluded_reason = "speculative_extraction_stopped";
      e.diag.ineligible_reason = "speculative_extraction_stopped";
      e.diag.would_have_been_attempted_under_relaxed_rule = true;
      await mark("judgment_attempt_skipped", {
        candidate_id: e.c.candidate_id,
        index: attemptIndex++,
        host: hostOf(e.c.source_url ?? null),
        reason: "speculative_extraction_stopped",
      });
      continue;
    }
    const isLeading = e.isRequested || e.role === "leading_candidate";

    if (isLeading && leadingUsed >= budget.leading) {
      excluded.push({
        candidate_id: e.c.candidate_id,
        title: e.c.title,
        url: e.c.source_url ?? null,
        reason: "budget_exhausted",
      });
      e.diag.excluded_reason = "budget_exhausted";
      e.diag.ineligible_reason = "budget_exhausted";
      e.diag.would_have_been_attempted_under_relaxed_rule = true;
      await mark("judgment_attempt_skipped", {
        candidate_id: e.c.candidate_id,
        index: attemptIndex++,
        host: hostOf(e.c.source_url ?? null),
        reason: "leading_budget_exhausted",
      });
      continue;
    }
    if (!isLeading && otherUsed >= budget.other) {
      excluded.push({
        candidate_id: e.c.candidate_id,
        title: e.c.title,
        url: e.c.source_url ?? null,
        reason: "budget_exhausted",
      });
      e.diag.excluded_reason = "budget_exhausted";
      e.diag.ineligible_reason = "budget_exhausted";
      e.diag.would_have_been_attempted_under_relaxed_rule = true;
      await mark("judgment_attempt_skipped", {
        candidate_id: e.c.candidate_id,
        index: attemptIndex++,
        host: hostOf(e.c.source_url ?? null),
        reason: "other_budget_exhausted",
      });
      continue;
    }
    if (isLeading) leadingUsed++;
    else otherUsed++;
    e.diag.acquisition_attempted = true;

    const tAttempt = Date.now();
    const url = e.c.source_url ?? null;
    const methods: AcquisitionMethod[] = [];
    const failures: string[] = [];
    let text = "";
    let succeeded: AcquisitionMethod | null = null;

    const thisIndex = attemptIndex++;
    // Hard per-candidate deadline, further clipped by whatever remains of the
    // pipeline retrieval budget.
    const attemptMs = Math.max(
      1000,
      Math.min(
        ACQUISITION_LIMITS.PER_ATTEMPT_MS,
        retrievalBudget ? retrievalBudget.remaining() - 1000 : ACQUISITION_LIMITS.PER_ATTEMPT_MS,
      ),
    );
    const attemptDeadline = tAttempt + attemptMs;
    const attemptOverBudget = () =>
      Date.now() > attemptDeadline ||
      Date.now() - t0 > ACQUISITION_LIMITS.TOTAL_MS ||
      !!retrievalBudget?.exceeded();

    await mark("judgment_attempt_start", {
      candidate_id: e.c.candidate_id,
      index: thisIndex,
      rank: e.rank?.rank ?? -1,
      host: hostOf(url),
      role: e.role,
      trigger: e.trigger,
      is_requested: e.isRequested,
      attempt_deadline_ms: attemptMs,
    });

    const docketGate = e.dockets.length > 0
      ? (t: string) => e.dockets.some((d) => textContainsExactDocket(t.slice(0, 30000), d))
      : undefined;

    // Fine-grained sink → durable per-attempt checkpoints. The sink itself is
    // synchronous, so writes are chained and awaited after each method.
    const stageTrail: Array<{ name: string; detail?: Record<string, unknown> }> = [];
    let pending: Promise<void> = Promise.resolve();
    const onStage: StageSink = (name, detail) => {
      stageTrail.push({ name, detail });
      const durable = DURABLE_STAGE_MAP[name];
      if (!durable) return;
      // Returned so callers may await the checkpoint before an expensive step.
      return (pending = pending.then(() =>
        mark(durable, {
          candidate_id: e.c.candidate_id,
          index: thisIndex,
          host: hostOf(url),
          inner_stage: name,
          ...(detail ?? {}),
        }) as Promise<void>
      ));
    };

    const isSummaryHost = SUMMARY_HOST_RE.test(url ?? "");
    const plan: AcquisitionMethod[] = [];
    if (url && isDirectFileUrl(url) && !isSummaryHost) plan.push("direct_file_fetch");
    if (e.dockets.length > 0) {
      plan.push(isSummaryHost ? "summary_page_docket_resolve" : "local_db_docket_lookup");
    }
    if (
      url && WRAPPER_HOST_RE.test(url) && !isDirectFileUrl(url) && !isSummaryHost &&
      !isListingPage(url) && !isInstitutionalPage(url)
    ) {
      plan.push("wrapper_file_resolve");
    }
    if (plan.length === 0) plan.push("local_db_docket_lookup");

    for (const method of plan) {
      if (Date.now() - t0 > ACQUISITION_LIMITS.TOTAL_MS) {
        failures.push("stage_time_budget_exhausted");
        break;
      }
      if (retrievalBudget?.exceeded()) {
        retrieval_budget_exceeded = true;
        failures.push("retrieval_budget_exceeded");
        break;
      }
      if (Date.now() >= attemptDeadline) {
        failures.push("attempt_deadline_exceeded");
        break;
      }
      methods.push(method);
      const methodMs = Math.max(
        500,
        Math.min(ACQUISITION_LIMITS.PER_METHOD_MS, attemptDeadline - Date.now()),
      );
      // Real network-layer abort — a hung socket can never outlive the attempt.
      // Speculative acquisition (no requested docket, no docket signal at all —
      // i.e. doctrine/survey candidates) gets the conservative pre-extract
      // inline limit; exact-docket / requested-authority acquisition keeps the
      // existing bounded path up to the hard ceiling.
      // Speculative = the *question* names no docket (doctrine/survey
      // acquisition). Candidate-level docket signals do not count: they are
      // discovered, not requested.
      const speculative = requestedDockets.length === 0 && !e.isRequested;
      const fileOpts: DirectFileOptions = {
        allowPlainText: true,
        validateText: docketGate,
        onStage,
        signal: AbortSignal.timeout(methodMs),
        budgetExceeded: attemptOverBudget,
        allowExtraction: (bytes: number) =>
          retrievalBudget?.allowExtraction?.(bytes, { speculative }) ?? true,
        noteExtractionOutput: (chars: number) =>
          retrievalBudget?.noteExtractionOutput?.(chars, { speculative }),
        ...(speculative
          ? { maxInlineExtractionBytes: ACQUISITION_LIMITS.MAX_INLINE_EXTRACTION_BYTES }
          : {}),
      };

      try {
        const run = method === "direct_file_fetch"
          ? tryDirectFile(url!, fileOpts)
          : method === "wrapper_file_resolve"
          ? tryWrapperResolve(url!, fileOpts)
          : e.dockets.length > 0
          ? tryLocalDbByDockets(input.admin, e.dockets)
          : tryLocalDb(input.admin, null, e.c.title);
        const got = await withTimeout(run, methodMs, method);
        await pending;
        if (got.length >= ACQUISITION_LIMITS.MIN_USABLE_TEXT) {
          text = normText(got);
          succeeded = method;
          break;
        }
        failures.push("extracted_text_below_threshold");
      } catch (err) {
        await pending.catch(() => {});
        failures.push(err instanceof Error ? err.message : String(err));
      }
    }
    await pending.catch(() => {});



    const before = String(e.integ.text_usability ?? "unknown");
    let after = before;
    const holding = !!text && HOLDING_TEXT_RE.test(text);
    const bodySignal = !!text && (
      (docketGate ? docketGate(text) : false) || JUDGMENT_BODY_RE.test(text)
    );

    if (succeeded && text) {
      const stored = text.slice(0, ACQUISITION_LIMITS.MAX_TEXT);
      after = stored.length >= 1200 ? "full_text" : "substantive_excerpt";
      e.integ.text_usability = after as SourceIntegrity["text_usability"];
      e.integ.has_holding_text = e.integ.has_holding_text || holding;
      e.integ.is_judgment_document = true;
      // Part 3 — handoff consistency: an acquired body that carries its own
      // case identity is a judgment for every downstream consumer, including
      // sufficiency. Text always comes from a court file or the local corpus —
      // aggregator page text is never used as a body — so this is not a
      // loosening of sufficiency, only a correct hand-off.
      if (bodySignal && stored.length >= ACQUISITION_LIMITS.MIN_USABLE_TEXT) {
        e.integ.citable_as = "judgment";
        if (
          e.integ.authority_tier === "index_or_listing" ||
          e.integ.authority_tier === "non_authority" ||
          e.integ.authority_tier === "unknown"
        ) {
          e.integ.authority_tier = (succeeded === "direct_file_fetch" && isTrustedCourtTextHost(url ?? "")) ||
              succeeded === "local_db_docket_lookup" || succeeded === "summary_page_docket_resolve"
            ? "official_primary"
            : "primary_mirror";
        }
        e.integ.reject = false;
        delete e.integ.reject_reason;
      }
      e.integ.integrity_flags = [
        ...(e.integ.integrity_flags ?? []),
        "judgment_text_acquired",
        ...(bodySignal ? ["judgment_identity_confirmed_in_body"] : []),
        ...(holding ? ["holding_text_present"] : []),
      ];

      e.c.metadata = {
        ...(e.c.metadata ?? {}),
        source_integrity: e.integ,
        extended_text: stored,
        judgment_candidate: true,
        docket_normalized: e.dockets[0] ? normalizedDocketId(e.dockets[0]) : null,
        judgment_text_acquired: true,
        judgment_text_acquisition_method: succeeded,
        body_contains_docket_or_title: bodySignal,
        usable_for_holding: holding && stored.length >= ACQUISITION_LIMITS.MIN_USABLE_TEXT,
        final_text_usability: after,
      };
      if ((e.c.snippet || "").length < 200) {
        e.c.snippet = stored.slice(0, 600);
      }
      successes++;
      // f07_extraction_stability_v1 — one usable body is enough for speculative
      // (non-requested-docket) acquisition; block further binary extraction.
      if (requestedDockets.length === 0) {
        retrievalBudget?.noteSpeculativeBodyAcquired?.();
      }
    } else {
      e.c.metadata = {
        ...(e.c.metadata ?? {}),
        judgment_candidate: true,
        docket_normalized: e.dockets[0] ? normalizedDocketId(e.dockets[0]) : null,
        judgment_text_acquired: false,
        judgment_text_acquisition_failure_reasons: failures,
      };
    }

    budget_spent_on.push({
      candidate_id: e.c.candidate_id,
      title: e.c.title,
      url,
      rank: e.rank?.rank ?? -1,
      rank_reason: e.rank?.rank_reason ?? "unranked",
      official_judgment_document: e.rank?.is_official_judgment_document ?? false,
      success: !!succeeded,
    });

    attempts.push({
      candidate_id: e.c.candidate_id,
      title: e.c.title,
      url,
      judgment_candidate: true,
      docket_signal: e.dockets[0] ? `${e.dockets[0].prefix_he} ${e.dockets[0].number}` : null,
      docket_normalized: e.dockets[0] ? normalizedDocketId(e.dockets[0]) : null,
      title_signal: e.c.title ? e.c.title.slice(0, 120) : null,
      synthesis_role: e.role,
      trigger_reason: e.trigger,
      acquisition_attempted: true,
      methods_attempted: methods,
      acquisition_methods_attempted: methods,
      method_succeeded: succeeded,
      success: !!succeeded,
      acquisition_success: !!succeeded,
      acquisition_failure_reasons: succeeded ? [] : failures,
      extracted_text_length: text.length,
      acquired_text_length: succeeded ? Math.min(text.length, ACQUISITION_LIMITS.MAX_TEXT) : 0,
      body_contains_docket_or_title: bodySignal,
      has_holding_text: holding,
      text_usability_before: before,
      text_usability_after: after,
      final_text_usability: after,
      usable_for_holding: !!succeeded && holding &&
        text.length >= ACQUISITION_LIMITS.MIN_USABLE_TEXT,
      can_support_synthesis_holding: !!succeeded && holding &&
        text.length >= ACQUISITION_LIMITS.MIN_USABLE_TEXT,
      failure_reason: succeeded ? null : (failures[failures.length - 1] ?? "no_method_available"),
      ms: Date.now() - tAttempt,
    });

    await mark("judgment_attempt_done", {
      candidate_id: e.c.candidate_id,
      index: thisIndex,
      host: hostOf(url),
      methods: methods,
      method_succeeded: succeeded,
      success: !!succeeded,
      chars: text.length,
      failure_reason: succeeded ? null : (failures[failures.length - 1] ?? "no_method_available"),
      inner_stages: stageTrail.map((s) => s.name),
      ms: Date.now() - tAttempt,
    });

    if (retrieval_budget_exceeded) {
      stage_stop_reason = stage_stop_reason ?? "retrieval_budget_exceeded";
      await mark("judgment_acquisition_budget_exceeded", {
        attempts_made: attempts.length,
        where: "after_attempt",
      });
      break;
    }
  }


  return {
    enabled: true,
    mode,
    budget,
    judgment_candidates: judgmentCandidates,
    eligible_count: eligible.length,
    excluded,
    eligibility_diagnostics: diagnostics,
    attempts,
    attempts_made: attempts.length,
    successes,
    ms: Date.now() - t0,
    judgment_candidate_rank_before_acquisition: ranked,
    acquisition_budget_spent_on: budget_spent_on,
    // A higher-ranked candidate that never got an attempt while a lower-ranked
    // one did — should stay at 0 under correct budgeting.
    skipped_higher_quality_candidates: (() => {
      const attemptedRanks = budget_spent_on.map((b) => b.rank).filter((r) => r > 0);
      if (attemptedRanks.length === 0) return 0;
      const worst = Math.max(...attemptedRanks);
      const attempted = new Set(attemptedRanks);
      return ranked.filter((r) => r.rank < worst && !attempted.has(r.rank)).length;
    })(),
    institutional_pages_excluded_before_budget,
    official_judgment_documents_found,
    official_judgment_documents_acquired: budget_spent_on.filter(
      (b) => b.success && b.official_judgment_document,
    ).length,
    stage_stop_reason,
    retrieval_budget_exceeded,
    speculative_extraction_stopped,
  };
}
