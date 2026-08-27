/**
 * doctrinal_secondary_body_acquisition_v1
 *
 * substance_based_doctrinal_sufficiency_v1 shipped safe but inert: the
 * doctrinal fallback never fired because secondary/doctrinal sources reached
 * the drafter with nothing but a title, a search snippet or a Perplexity
 * summary. `hasAcquiredSubstantiveText` therefore rejected every one of them
 * and `doctrinal_eligible_count` was 0 in all nine validation runs.
 *
 * This stage closes that gap and nothing else: for admitted secondary /
 * doctrinal candidates it tries to obtain genuine substantive body text —
 * local corpus first, verified-source cache second, a bounded open-web fetch
 * last — and marks the candidate `secondary_body_acquired` so the existing
 * eligibility predicate can see real text.
 *
 * Hard scope guarantees (nothing below is relaxed anywhere in this file):
 *   - No new retrieval/discovery. Only candidates ALREADY in the admitted pool.
 *   - Primary law and judgments are untouched: judgment identity validation,
 *     the verified cache identity rules, the court relay, statute acquisition
 *     and primary-law source integrity are all out of scope.
 *   - Rate-limited / court hosts are skipped outright, so the relay is never
 *     used for secondary material.
 *   - No paywall, login or CAPTCHA circumvention: a non-200, a block page or
 *     a login wall is a plain failure and the candidate stays bibliography-only.
 *   - Fail closed. On any failure the candidate is left exactly as it was and
 *     is recorded in the bibliography-only bucket — never as claim support.
 *   - Mode-gated: broad_research / academic_research / narrow_doctrine only.
 */

import type { Candidate } from "../lib/types.ts";
import { extractDocumentText } from "../lib/attachments.ts";
import { processExtractedBody } from "./postExtract.ts";
import { decodeHebrew } from "./judgmentTextAcquisition.ts";
import { officialFetch, looksLikeBlockPage } from "../lib/officialFetch.ts";
import { looksBinary } from "./statuteTextAcquisition.ts";
import type { SourceIntegrity } from "./sourceIntegrity.ts";

export const SECONDARY_BODY_LIMITS = {
  /** Hard per-web-attempt deadline (fetch + decode + extract + post-extract). */
  PER_ATTEMPT_MS: 10_000,
  /** Whole-stage time box. */
  TOTAL_MS: 20_000,
  /** Local corpus / cache lookups per run. */
  MAX_LOCAL_LOOKUPS: 8,
  /** Open-web fetches per run. */
  MAX_WEB_ATTEMPTS: 3,
  MAX_BYTES: 3 * 1024 * 1024,
  MAX_INLINE_EXTRACTION_BYTES: 2_000_000,
  MAX_DECODE_BYTES: 1_000_000,
  /** Below this the acquisition is not substantive text. */
  MIN_USABLE_TEXT: 800,
  /** Stored body cap. */
  MAX_TEXT: 16_000,
} as const;

/** Modes where doctrinal secondary material is worth acquiring. */
const ALLOWED_DEPTH_MODES = new Set([
  "broad_research",
  "academic_research",
  "narrow_doctrine",
]);

/** Types already understood as secondary/doctrinal material. */
const SECONDARY_TYPES = new Set([
  "legal_article",
  "journal_article",
  "article",
  "book",
  "book_chapter",
  "book_or_chapter",
  "chapter",
  "commentary",
  "doctrinal_commentary",
  "scholarship",
  "academic",
  "report",
  "government_report",
  "institutional_report",
]);

/** Types that are primary law / judgments — never handled here. */
const PRIMARY_TYPES = new Set([
  "case",
  "caselaw",
  "judgment",
  "israeli_law",
  "statute",
  "regulation",
  "legislation",
  "legislation_primary",
  "legislation_secondary",
]);

const DOCTRINAL_SIGNAL_RE =
  /(מאמר|כתב עת|רבעון|עיוני משפט|משפטים|הפרקליט|משפט וממשל|עלי משפט|ספר|כרך|מהדורה|הוצאת|בתוך:|עורכ|דו"ח|דוח|דין וחשבון|ועדת|מבקר המדינה|נייר עמדה|מחקר מדיניות|פרשנות|פירוש|סקירה)/;
const DOCTRINAL_HOST_RE =
  /(ac\.il|\.edu|jstor|heinonline|repository|journals?|idi\.org\.il|mevaker\.gov\.il|knesset\.gov\.il\/mmm|oecd|un\.org)/i;

/** Hosts we refuse to touch from this stage (relay / court / paywalled). */
const BLOCKED_HOST_RE =
  /(court\.gov\.il|supremedecisions|nevo\.co\.il|takdin|pador|lawdata|psakdin)/i;
/** Login / paywall URL shapes we never attempt. */
const ACCESS_CONTROLLED_RE = /(login|signin|sign-in|subscribe|paywall|checkout|account)/i;

export type SecondaryStageSink = (
  name: string,
  detail?: Record<string, unknown>,
) => void | Promise<void>;

export type SecondaryAcquisitionPath =
  | "local_secondary_body"
  | "verified_cache_body"
  | "open_web_body"
  | "none";

export interface SecondaryCandidateReport {
  candidate_id: string;
  title: string;
  url: string | null;
  host: string | null;
  origin: string;
  source_type: string;
  /** Why this candidate was considered secondary/doctrinal. */
  selection_evidence: string[];
  local_lookup_attempted: boolean;
  local_body_found: boolean;
  local_lookup_source: "legal_documents" | "verified_cache" | null;
  web_attempted: boolean;
  web_result: string | null;
  acquisition_path: SecondaryAcquisitionPath;
  body_chars: number;
  ok: boolean;
  failure_reason: string | null;
  /** Kept for the "found for further checking" bucket when no body exists. */
  bibliography_only: boolean;
  skipped_by_budget: boolean;
  ms: number;
}

export interface SecondaryBodyAcquisitionReport {
  ran: boolean;
  reason: string;
  depth_mode: string | null;
  candidates_considered: number;
  local_lookups: number;
  local_hits: number;
  web_attempts: number;
  web_successes: number;
  acquired_candidate_ids: string[];
  bibliography_only_candidate_ids: string[];
  skipped_by_budget: number;
  per_candidate: SecondaryCandidateReport[];
  stage_stop_reason:
    | "completed"
    | "stage_not_run"
    | "no_eligible_candidates"
    | "local_budget_exhausted"
    | "web_budget_exhausted"
    | "retrieval_budget_exceeded"
    | "stage_timeout";
  ms: number;
}

function hostOf(url: string | null | undefined): string {
  try {
    return new URL(String(url)).hostname;
  } catch {
    return "";
  }
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

function currentBodyChars(c: Candidate): number {
  const meta = (c.metadata ?? {}) as Record<string, unknown>;
  const ext = typeof meta.extended_text === "string" ? meta.extended_text.length : 0;
  return Math.max(ext, String(c.snippet ?? "").length);
}

function alreadyHasBody(c: Candidate): boolean {
  const meta = (c.metadata ?? {}) as Record<string, unknown>;
  return meta.body_acquired === true ||
    meta.judgment_text_acquired === true ||
    meta.statute_text_acquired === true ||
    meta.secondary_body_acquired === true;
}

/** Deterministic: is this an admitted secondary/doctrinal candidate? */
export function selectSecondaryCandidate(
  c: Candidate,
): { eligible: boolean; evidence: string[]; reason: string } {
  const type = String(c.source_type ?? "").toLowerCase();
  const evidence: string[] = [];
  if (PRIMARY_TYPES.has(type)) return { eligible: false, evidence, reason: "primary_law_or_judgment" };

  const integ = ((c.metadata ?? {}) as Record<string, unknown>).source_integrity as
    | SourceIntegrity
    | undefined;
  const citable = String(integ?.citable_as ?? "");
  if (citable === "judgment" || citable === "statute") {
    return { eligible: false, evidence, reason: "primary_citable_as" };
  }

  if (SECONDARY_TYPES.has(type)) evidence.push(`secondary_type:${type}`);
  const hay = `${c.title ?? ""} ${c.snippet ?? ""}`;
  if (DOCTRINAL_SIGNAL_RE.test(hay)) evidence.push("doctrinal_text_signal");
  if (DOCTRINAL_HOST_RE.test(String(c.source_url ?? ""))) evidence.push("doctrinal_host");
  if (c.role === "scholarship" || c.role === "government_report" || c.role === "factual_report") {
    evidence.push(`doctrinal_role:${c.role}`);
  }

  if (evidence.length === 0) return { eligible: false, evidence, reason: "no_doctrinal_signal" };
  if (alreadyHasBody(c)) return { eligible: false, evidence, reason: "body_already_acquired" };
  return { eligible: true, evidence, reason: "secondary_doctrinal_candidate" };
}

/** Attach an acquired body to a candidate without touching identity rules. */
function attachBody(c: Candidate, text: string, path: SecondaryAcquisitionPath): number {
  const stored = text.slice(0, SECONDARY_BODY_LIMITS.MAX_TEXT);
  const meta = (c.metadata ?? {}) as Record<string, unknown>;
  const integ = meta.source_integrity as SourceIntegrity | undefined;
  if (integ) {
    integ.text_usability = (stored.length >= 1200 ? "full_text" : "substantive_excerpt") as
      SourceIntegrity["text_usability"];
    integ.integrity_flags = [
      ...(integ.integrity_flags ?? []),
      "secondary_body_acquired",
      "body_acquired",
    ];
    // Only lifts the metadata-only style rejection this stage just cured.
    if (integ.reject && /metadata_only|no_text|snippet_only/i.test(String(integ.reject_reason ?? ""))) {
      integ.reject = false;
      delete integ.reject_reason;
    }
  }
  c.metadata = {
    ...meta,
    ...(integ ? { source_integrity: integ } : {}),
    extended_text: stored,
    secondary_body_acquired: true,
    body_acquired: true,
    acquisition_path: path,
    final_text_usability: stored.length >= 1200 ? "full_text" : "substantive_excerpt",
  };
  if ((c.snippet || "").length < 400) c.snippet = stored.slice(0, 1200);
  return stored.length;
}

async function fetchCapped(
  url: string,
  signal: AbortSignal,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const res = await officialFetch(url, { signal });
  if (!res.ok) {
    try {
      await res.body?.cancel();
    } catch { /* already closed */ }
    throw new Error(`http_${res.status}`);
  }
  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  const declared = Number(res.headers.get("content-length") || "0") || 0;
  if (declared > SECONDARY_BODY_LIMITS.MAX_BYTES) {
    try {
      await res.body?.cancel();
    } catch { /* already closed */ }
    throw new Error("secondary_body_too_large");
  }
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
    if (total >= SECONDARY_BODY_LIMITS.MAX_BYTES) {
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
  return { bytes, contentType };
}

/** Bounded open-web body acquisition for a public secondary source. */
export async function acquireSecondaryBodyFromUrl(
  url: string,
  budgetExceeded: () => boolean,
  onStage: SecondaryStageSink,
  allowExtraction?: (bytes: number) => boolean,
): Promise<string> {
  const signal = AbortSignal.timeout(SECONDARY_BODY_LIMITS.PER_ATTEMPT_MS);
  const gate = (where: string) => {
    if (budgetExceeded()) {
      onStage("secondary_budget_exceeded", { where });
      throw new Error("retrieval_timeout");
    }
  };
  gate("before_fetch");
  const { bytes, contentType } = await fetchCapped(url, signal);
  gate("after_fetch");

  const head = new TextDecoder("latin1").decode(bytes.slice(0, 8));
  const isPdf = /pdf/.test(contentType) || /\.pdf(\?|#|$)/i.test(url) || head.startsWith("%PDF");
  const isDocx = /wordprocessingml|officedocument/.test(contentType) ||
    /\.docx(\?|#|$)/i.test(url) || head.startsWith("PK");

  if (isPdf || isDocx) {
    if (bytes.byteLength > SECONDARY_BODY_LIMITS.MAX_INLINE_EXTRACTION_BYTES) {
      throw new Error("secondary_binary_too_large_for_inline_extraction");
    }
    if (allowExtraction && !allowExtraction(bytes.byteLength)) {
      throw new Error("secondary_extraction_budget_spent");
    }
    gate("before_binary_extract");
    const extracted = await extractDocumentText(bytes, isPdf ? "pdf" : "docx");
    gate("after_binary_extract");
    const processed = await processExtractedBody(extracted, { onStage, budgetExceeded });
    return processed.text;
  }

  if (looksBinary(bytes)) throw new Error("secondary_binary_not_text_extractable");

  gate("before_decode");
  const decoded = decodeHebrew(bytes.slice(0, SECONDARY_BODY_LIMITS.MAX_DECODE_BYTES));
  gate("after_decode");
  if (looksLikeBlockPage(decoded.slice(0, 4000))) throw new Error("block_or_access_page");
  const processed = await processExtractedBody(stripMarkup(decoded), { onStage, budgetExceeded });
  return processed.text;
}

interface AdminLike {
  from: (table: string) => any;
}

async function localBodyLookup(
  admin: AdminLike,
  c: Candidate,
): Promise<{ text: string; source: "legal_documents" | "verified_cache" } | null> {
  const meta = (c.metadata ?? {}) as Record<string, unknown>;
  const documentId = c.document_id ??
    (typeof meta.document_id === "string" ? meta.document_id : null);
  const url = c.source_url ?? null;

  // 1. Local corpus document (full stored content).
  if (documentId || url) {
    let q = admin.from("legal_documents").select("id,content").limit(1);
    q = documentId ? q.eq("id", documentId) : q.eq("source_url", url);
    const { data } = await q;
    const row = Array.isArray(data) ? data[0] : null;
    const content = String(row?.content ?? "");
    if (content.length >= SECONDARY_BODY_LIMITS.MIN_USABLE_TEXT) {
      return { text: content, source: "legal_documents" };
    }
    // 2. Substantial stored chunks for the same document.
    if (row?.id) {
      const { data: chunks } = await admin
        .from("legal_document_chunks")
        .select("content,chunk_index")
        .eq("document_id", row.id)
        .order("chunk_index", { ascending: true })
        .limit(12);
      const joined = (Array.isArray(chunks) ? chunks : [])
        .map((r: { content?: string }) => String(r?.content ?? ""))
        .join("\n")
        .trim();
      if (joined.length >= SECONDARY_BODY_LIMITS.MIN_USABLE_TEXT) {
        return { text: joined, source: "legal_documents" };
      }
    }
  }

  // 3. Verified-source cache body (read-only; identity rules untouched).
  if (url) {
    const { data: src } = await admin
      .from("verified_legal_sources")
      .select("id,status")
      .eq("official_url", url)
      .eq("status", "verified")
      .limit(1);
    const srcRow = Array.isArray(src) ? src[0] : null;
    if (srcRow?.id) {
      const { data: texts } = await admin
        .from("verified_legal_source_texts")
        .select("text,chunk_index")
        .eq("source_id", srcRow.id)
        .order("chunk_index", { ascending: true })
        .limit(12);
      const joined = (Array.isArray(texts) ? texts : [])
        .map((r: { text?: string }) => String(r?.text ?? ""))
        .join("\n")
        .trim();
      if (joined.length >= SECONDARY_BODY_LIMITS.MIN_USABLE_TEXT) {
        return { text: joined, source: "verified_cache" };
      }
    }
  }

  return null;
}

export interface SecondaryBodyAcquisitionInput {
  admin: AdminLike;
  candidates: Candidate[];
  depth_mode: string | null;
  /** Kill switch for the control arm of the before/after comparison. */
  enabled?: boolean;
  retrieval_budget?: { exceeded: () => boolean; allowExtraction?: (bytes: number) => boolean };
  markDurable?: SecondaryStageSink;
}

export async function runSecondaryBodyAcquisition(
  input: SecondaryBodyAcquisitionInput,
): Promise<SecondaryBodyAcquisitionReport> {
  const t0 = Date.now();
  const onStage: SecondaryStageSink = input.markDurable ?? (() => {});
  const depth = input.depth_mode ?? null;
  const base = (
    reason: string,
    stop: SecondaryBodyAcquisitionReport["stage_stop_reason"],
    ran = false,
  ): SecondaryBodyAcquisitionReport => ({
    ran,
    reason,
    depth_mode: depth,
    candidates_considered: 0,
    local_lookups: 0,
    local_hits: 0,
    web_attempts: 0,
    web_successes: 0,
    acquired_candidate_ids: [],
    bibliography_only_candidate_ids: [],
    skipped_by_budget: 0,
    per_candidate: [],
    stage_stop_reason: stop,
    ms: Date.now() - t0,
  });

  if (input.enabled === false) return base("disabled_control_arm", "stage_not_run");
  if (!depth || !ALLOWED_DEPTH_MODES.has(depth)) {
    return base(`depth_mode_not_eligible:${depth ?? "unknown"}`, "stage_not_run");
  }
  if (input.retrieval_budget?.exceeded()) {
    return base("retrieval_budget_exceeded", "retrieval_budget_exceeded");
  }

  const budgetExceeded = () =>
    (input.retrieval_budget?.exceeded() ?? false) ||
    Date.now() - t0 > SECONDARY_BODY_LIMITS.TOTAL_MS;

  const selected: Array<{ c: Candidate; evidence: string[] }> = [];
  for (const c of input.candidates) {
    const sel = selectSecondaryCandidate(c);
    if (sel.eligible) selected.push({ c, evidence: sel.evidence });
  }
  if (selected.length === 0) {
    return { ...base("no_secondary_candidates", "no_eligible_candidates", true), ran: true };
  }

  // Richer / more clearly doctrinal candidates first.
  selected.sort((a, b) => b.evidence.length - a.evidence.length);

  const rows: SecondaryCandidateReport[] = [];
  const acquired: string[] = [];
  const bibliographyOnly: string[] = [];
  let localLookups = 0;
  let localHits = 0;
  let webAttempts = 0;
  let webSuccesses = 0;
  let skippedByBudget = 0;
  let stop: SecondaryBodyAcquisitionReport["stage_stop_reason"] = "completed";

  await onStage("secondary_body_acquisition_start", {
    depth_mode: depth,
    candidates: selected.length,
  });

  for (const { c, evidence } of selected) {
    const a0 = Date.now();
    const url = c.source_url ?? null;
    const host = url ? hostOf(url) : null;
    const row: SecondaryCandidateReport = {
      candidate_id: c.candidate_id,
      title: String(c.title ?? ""),
      url,
      host,
      origin: String(c.origin ?? ""),
      source_type: String(c.source_type ?? ""),
      selection_evidence: evidence,
      local_lookup_attempted: false,
      local_body_found: false,
      local_lookup_source: null,
      web_attempted: false,
      web_result: null,
      acquisition_path: "none",
      body_chars: currentBodyChars(c),
      ok: false,
      failure_reason: null,
      bibliography_only: true,
      skipped_by_budget: false,
      ms: 0,
    };

    if (budgetExceeded()) {
      row.skipped_by_budget = true;
      row.failure_reason = "retrieval_budget_exceeded";
      skippedByBudget++;
      stop = "retrieval_budget_exceeded";
      rows.push({ ...row, ms: Date.now() - a0 });
      bibliographyOnly.push(c.candidate_id);
      continue;
    }

    // ── 1. local DB / cache body first (cheapest, always preferred) ────────
    if (localLookups < SECONDARY_BODY_LIMITS.MAX_LOCAL_LOOKUPS) {
      localLookups++;
      row.local_lookup_attempted = true;
      try {
        const local = await localBodyLookup(input.admin, c);
        if (local) {
          localHits++;
          row.local_body_found = true;
          row.local_lookup_source = local.source;
          row.body_chars = attachBody(
            c,
            local.text,
            local.source === "verified_cache" ? "verified_cache_body" : "local_secondary_body",
          );
          row.acquisition_path = local.source === "verified_cache"
            ? "verified_cache_body"
            : "local_secondary_body";
          row.ok = true;
          row.bibliography_only = false;
          acquired.push(c.candidate_id);
          rows.push({ ...row, ms: Date.now() - a0 });
          await onStage("secondary_local_body_hit", {
            candidate_id: c.candidate_id,
            chars: row.body_chars,
            source: local.source,
          });
          continue;
        }
      } catch (err) {
        row.failure_reason = `local_lookup_error:${err instanceof Error ? err.message : String(err)}`;
      }
    } else {
      row.failure_reason = "local_lookup_budget_exhausted";
      stop = "local_budget_exhausted";
    }

    // ── 2. bounded open-web acquisition ───────────────────────────────────
    if (!url) {
      row.failure_reason ??= "no_public_url";
    } else if (BLOCKED_HOST_RE.test(host ?? "")) {
      row.failure_reason = "host_not_allowed_for_secondary_fetch";
    } else if (ACCESS_CONTROLLED_RE.test(url)) {
      row.failure_reason = "access_controlled_url";
    } else if (webAttempts >= SECONDARY_BODY_LIMITS.MAX_WEB_ATTEMPTS) {
      row.skipped_by_budget = true;
      row.failure_reason = "web_attempt_budget_exhausted";
      skippedByBudget++;
      stop = "web_budget_exhausted";
    } else if (budgetExceeded()) {
      row.skipped_by_budget = true;
      row.failure_reason = "retrieval_budget_exceeded";
      skippedByBudget++;
      stop = "retrieval_budget_exceeded";
    } else {
      webAttempts++;
      row.web_attempted = true;
      try {
        const text = await acquireSecondaryBodyFromUrl(
          url,
          budgetExceeded,
          onStage,
          (bytes: number) => input.retrieval_budget?.allowExtraction?.(bytes) ?? true,
        );
        if (text.length < SECONDARY_BODY_LIMITS.MIN_USABLE_TEXT) {
          throw new Error("secondary_text_below_threshold");
        }
        webSuccesses++;
        row.web_result = "body_acquired";
        row.acquisition_path = "open_web_body";
        row.body_chars = attachBody(c, text, "open_web_body");
        row.ok = true;
        row.bibliography_only = false;
        acquired.push(c.candidate_id);
        await onStage("secondary_web_body_ok", {
          candidate_id: c.candidate_id,
          host,
          chars: row.body_chars,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        row.web_result = `failed:${reason}`;
        row.failure_reason = reason;
        if (reason === "retrieval_timeout") stop = "retrieval_budget_exceeded";
        await onStage("secondary_web_body_failed", { candidate_id: c.candidate_id, host, reason });
      }
    }

    if (!row.ok) bibliographyOnly.push(c.candidate_id);
    rows.push({ ...row, ms: Date.now() - a0 });
    if (stop === "retrieval_budget_exceeded") break;
  }

  await onStage("secondary_body_acquisition_done", {
    acquired: acquired.length,
    local_hits: localHits,
    web_successes: webSuccesses,
    bibliography_only: bibliographyOnly.length,
    stop_reason: stop,
  });

  return {
    ran: true,
    reason: "stage_ran",
    depth_mode: depth,
    candidates_considered: selected.length,
    local_lookups: localLookups,
    local_hits: localHits,
    web_attempts: webAttempts,
    web_successes: webSuccesses,
    acquired_candidate_ids: acquired,
    bibliography_only_candidate_ids: bibliographyOnly,
    skipped_by_budget: skippedByBudget,
    per_candidate: rows,
    stage_stop_reason: stop,
    ms: Date.now() - t0,
  };
}
