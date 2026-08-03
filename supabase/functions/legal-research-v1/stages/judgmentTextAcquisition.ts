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

export const ACQUISITION_LIMITS = {
  /** Per-method time box. */
  PER_METHOD_MS: 7000,
  /** Whole-stage time box. */
  TOTAL_MS: 26000,
  /** Below this many chars the candidate counts as "not enough real text". */
  MIN_USABLE_TEXT: 400,
  /** Never store more than this — the snippet budget caps display anyway. */
  MAX_TEXT: 6000,
  /** Max bytes downloaded per file. */
  MAX_BYTES: 8 * 1024 * 1024,
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
    | "text_below_threshold";
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
    | "budget_exhausted"
    | "stage_time_budget_exhausted";
}

export interface AcquisitionResult {
  enabled: boolean;
  mode: string | null;
  budget: { leading: number; other: number; total: number } | null;
  judgment_candidates: number;
  eligible_count: number;
  excluded: AcquisitionSkipLog[];
  attempts: AcquisitionAttemptLog[];
  attempts_made: number;
  successes: number;
  ms: number;
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

async function fetchBytes(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ReLexBot/1.0)" },
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > ACQUISITION_LIMITS.MAX_BYTES) throw new Error("file_too_large");
  return { bytes: buf, contentType };
}

/** Decode Hebrew bytes safely: UTF-8 first, windows-1255 fallback. */
export function decodeHebrew(bytes: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const replacementRatio = (utf8.match(/\uFFFD/g)?.length ?? 0) / Math.max(utf8.length, 1);
  const hasHebrew = /[\u0590-\u05FF]/.test(utf8);
  if (hasHebrew && replacementRatio < 0.01) return utf8;
  try {
    const cp1255 = new TextDecoder("windows-1255", { fatal: false }).decode(bytes);
    if (/[\u0590-\u05FF]/.test(cp1255)) return cp1255;
  } catch { /* decoder unavailable */ }
  return utf8;
}

/** Strip HTML/RTF-ish wrappers a court .txt file may still carry. */
function plainTextFromTxt(raw: string): string {
  let s = raw;
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
}

/** Method 1 — the URL already points at a judgment file. */
export async function tryDirectFile(url: string, opts: DirectFileOptions = {}): Promise<string> {
  const { bytes, contentType } = await fetchBytes(url);
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
    return normText(await extractDocumentText(bytes, isPdf ? "pdf" : "docx"));
  }
  if (isLegacyDoc && !head.startsWith("PK")) {
    // mammoth cannot read OLE2 .doc; salvage readable Hebrew runs instead.
    const salvaged = plainTextFromTxt(decodeHebrew(bytes)).replace(/[^\S\n]{3,}/g, " ");
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

  const text = plainTextFromTxt(decodeHebrew(bytes));
  if (text.length < ACQUISITION_LIMITS.MIN_USABLE_TEXT) {
    throw new Error("plain_text_below_threshold");
  }
  if (!JUDGMENT_BODY_RE.test(text)) throw new Error("plain_text_not_judgment_like");
  if (opts.validateText && !opts.validateText(text)) {
    throw new Error("plain_text_docket_mismatch");
  }
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
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ReLexBot/1.0)" },
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  const html = (await res.text()).slice(0, 400_000);
  const hrefs = Array.from(html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)).map((m) => m[1]);
  const fileHref = hrefs.find((h) => FILE_URL_RE.test(h) || DIRECT_DOWNLOAD_RE.test(h));
  if (!fileHref) throw new Error("no_downloadable_file_on_wrapper");
  const abs = new URL(fileHref, url).toString();
  return await tryDirectFile(abs, opts);
}

export interface AcquisitionInput {
  admin: SupabaseClient;
  research_mode: string | null;
  candidates: Candidate[];
  /** Question text — used to prioritise the exact requested docket. */
  question?: string | null;
}

interface Eligible {
  c: Candidate;
  integ: SourceIntegrity;
  role: string;
  dockets: DocketRef[];
  isRequested: boolean;
  trigger: AcquisitionAttemptLog["trigger_reason"];
}

function disabledResult(mode: string | null): AcquisitionResult {
  return {
    enabled: false,
    mode,
    budget: null,
    judgment_candidates: 0,
    eligible_count: 0,
    excluded: [],
    attempts: [],
    attempts_made: 0,
    successes: 0,
    ms: 0,
  };
}

/**
 * Is this candidate a judgment candidate worth acquiring?
 * A judgment candidate has a docket, a court/supreme-decisions URL, or a
 * recognizable Israeli judgment title — and is typed as a judgment or a
 * case-like source.
 */
function isJudgmentCandidate(c: Candidate, integ: SourceIntegrity, dockets: DocketRef[]): boolean {
  const url = c.source_url ?? "";
  const typedJudgment = integ.citable_as === "judgment" || integ.is_judgment_document === true;
  const caseLike = /case|caselaw|judgment|court/i.test(String(c.source_type ?? ""));
  const courtUrl = /court\.gov\.il|supremedecisions/i.test(url);
  const hasSignal = dockets.length > 0 || courtUrl || JUDGMENT_TITLE_RE.test(c.title ?? "");
  return (typedJudgment || caseLike || courtUrl) && hasSignal;
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
  const eligible: Eligible[] = [];
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
    if (isInstitutionalPage(url)) {
      excluded.push({ candidate_id: c.candidate_id, title: c.title, url, reason: "institutional_page" });
      continue;
    }
    if (isListingPage(url) && dockets.length === 0) {
      excluded.push({ candidate_id: c.candidate_id, title: c.title, url, reason: "listing_page" });
      continue;
    }
    if (dockets.length === 0 && !JUDGMENT_TITLE_RE.test(c.title ?? "")) {
      excluded.push({
        candidate_id: c.candidate_id,
        title: c.title,
        url,
        reason: "no_docket_or_title_signal",
      });
      continue;
    }

    const role = assignSynthesisRole({
      role: c.role,
      integrity: integ,
      title: c.title,
      snippet: c.snippet,
    }).synthesis_role;

    const usability = String(integ.text_usability ?? "unknown");
    const len = availableTextLength(c);
    let trigger: AcquisitionAttemptLog["trigger_reason"] | null = null;
    if (usability === "metadata_only") trigger = "metadata_only";
    else if (THIN_USABILITY.has(usability)) trigger = "unusable_or_unknown";
    else if (len < ACQUISITION_LIMITS.MIN_USABLE_TEXT) trigger = "text_below_threshold";
    if (!trigger) continue;

    const isRequested =
      requestedDockets.length > 0 &&
      requestedDockets.some((d) =>
        [c.title, c.source_url].some((f) => textContainsExactDocket(f, d))
      );

    // In judgment-bearing modes we also allow well-signalled judgments whose
    // synthesis role came back "unknown" (e.g. doctrine/survey packs).
    if (!ACQUIRABLE_ROLES.has(role) && !isRequested && dockets.length === 0) continue;

    eligible.push({ c, integ, role, dockets, isRequested, trigger });
  }

  // Exact requested docket first, then leading → applying → limiting, then score.
  eligible.sort((a, b) =>
    Number(b.isRequested) - Number(a.isRequested) ||
    (ROLE_PRIORITY[a.role] ?? 9) - (ROLE_PRIORITY[b.role] ?? 9) ||
    b.c.score - a.c.score
  );

  const attempts: AcquisitionAttemptLog[] = [];
  let successes = 0;
  let leadingUsed = 0;
  let otherUsed = 0;

  for (const e of eligible) {
    if (attempts.length >= budget.total) {
      excluded.push({
        candidate_id: e.c.candidate_id,
        title: e.c.title,
        url: e.c.source_url ?? null,
        reason: "budget_exhausted",
      });
      continue;
    }
    if (Date.now() - t0 > ACQUISITION_LIMITS.TOTAL_MS) {
      excluded.push({
        candidate_id: e.c.candidate_id,
        title: e.c.title,
        url: e.c.source_url ?? null,
        reason: "stage_time_budget_exhausted",
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
      continue;
    }
    if (!isLeading && otherUsed >= budget.other) {
      excluded.push({
        candidate_id: e.c.candidate_id,
        title: e.c.title,
        url: e.c.source_url ?? null,
        reason: "budget_exhausted",
      });
      continue;
    }
    if (isLeading) leadingUsed++;
    else otherUsed++;

    const tAttempt = Date.now();
    const url = e.c.source_url ?? null;
    const methods: AcquisitionMethod[] = [];
    const failures: string[] = [];
    let text = "";
    let succeeded: AcquisitionMethod | null = null;

    const docketGate = e.dockets.length > 0
      ? (t: string) => e.dockets.some((d) => textContainsExactDocket(t.slice(0, 30000), d))
      : undefined;
    const fileOpts: DirectFileOptions = {
      allowPlainText: true,
      validateText: docketGate,
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
      methods.push(method);
      try {
        const run = method === "direct_file_fetch"
          ? tryDirectFile(url!, fileOpts)
          : method === "wrapper_file_resolve"
          ? tryWrapperResolve(url!, fileOpts)
          : e.dockets.length > 0
          ? tryLocalDbByDockets(input.admin, e.dockets)
          : tryLocalDb(input.admin, null, e.c.title);
        const got = await withTimeout(run, ACQUISITION_LIMITS.PER_METHOD_MS, method);
        if (got.length >= ACQUISITION_LIMITS.MIN_USABLE_TEXT) {
          text = normText(got);
          succeeded = method;
          break;
        }
        failures.push("extracted_text_below_threshold");
      } catch (err) {
        failures.push(err instanceof Error ? err.message : String(err));
      }
    }

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
      e.integ.integrity_flags = [
        ...(e.integ.integrity_flags ?? []),
        "judgment_text_acquired",
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
      };
      if ((e.c.snippet || "").length < 200) {
        e.c.snippet = stored.slice(0, 600);
      }
      successes++;
    } else {
      e.c.metadata = {
        ...(e.c.metadata ?? {}),
        judgment_candidate: true,
        docket_normalized: e.dockets[0] ? normalizedDocketId(e.dockets[0]) : null,
        judgment_text_acquired: false,
        judgment_text_acquisition_failure_reasons: failures,
      };
    }

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
  }

  return {
    enabled: true,
    mode,
    budget,
    judgment_candidates: judgmentCandidates,
    eligible_count: eligible.length,
    excluded,
    attempts,
    attempts_made: attempts.length,
    successes,
    ms: Date.now() - t0,
  };
}
