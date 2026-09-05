import { officialHeaders } from "./officialFetch.ts";
import { extractDocumentText } from "./attachments.ts";
/**
 * official_court_egress_path_v1
 *
 * A narrow, allowlisted alternative egress for *public* official court
 * document URLs that were already discovered by the pipeline.
 *
 * Why this exists: `*.court.gov.il` resets the TCP connection for requests
 * originating from the Supabase Edge egress IP range, while the exact same URL
 * with the exact same browser-like headers returns the real public PDF from
 * other networks (verified). This is an egress-network problem, not an access
 * control: there is no login, no CAPTCHA, no paywall and no robots restriction
 * on these document URLs.
 *
 * Hard guarantees (enforced below, not by convention):
 *   - host allowlist: court.gov.il and its subdomains ONLY. Anything else is
 *     rejected before a request is made. It cannot become a general proxy.
 *   - only URLs already produced by official discovery (callers pass
 *     `url_origin`; `derivation`/`unknown` origins are allowed only because the
 *     same discovery ladder produced them — no crawling, no link following).
 *   - fallback only: used strictly after a direct edge fetch failed with a
 *     transport reset / 403 / block page.
 *   - serialised, capped per run, bounded backoff, hard stop on repeated
 *     failures.
 *   - no cookies, no credentials, no challenge solving of any kind.
 *
 * Configuration (all optional — with none of it set the module is inert and
 * behaviour is byte-identical to official_fetch_profile_v1):
 *   COURT_EGRESS_URL_TEMPLATE  e.g. "https://my-worker.example.com/fetch?url={url_encoded}"
 *                              placeholders: {url_encoded} | {url} | {token}
 *   COURT_EGRESS_TOKEN         sent as `Authorization: Bearer <token>` unless
 *                              the template consumes {token}.
 *   COURT_EGRESS_HEADER_PREFIX headers forwarded to the relay for the upstream
 *                              request, default "X-Fwd-" (browser-like profile
 *                              headers are forwarded under this prefix).
 */

declare const Deno: { env: { get(key: string): string | undefined } };


export const COURT_EGRESS_VERSION = "official_court_egress_path_v1";

export const COURT_EGRESS_LIMITS = {
  /** Hard cap on alternative-egress fetches per run. */
  MAX_PER_RUN: 10,
  /** Minimum spacing between two alternative-egress fetches. */
  MIN_SPACING_MS: 300,
  BACKOFF_BASE_MS: 1_200,
  BACKOFF_MAX_MS: 5_000,
  MAX_CONSECUTIVE_HARD_FAILURES: 2,
  /** Relay request timeout. */
  TIMEOUT_MS: 25_000,
} as const;

/** The ONLY hosts reachable through this path. */
const EGRESS_ALLOWLIST_RE = /(^|\.)court\.gov\.il$/i;

export function isEgressAllowedHost(url: string): boolean {
  try {
    return EGRESS_ALLOWLIST_RE.test(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export interface CourtEgressConfig {
  template: string;
  token: string | null;
  headerPrefix: string;
}

export function courtEgressConfig(): CourtEgressConfig | null {
  const template = (Deno.env.get("COURT_EGRESS_URL_TEMPLATE") ?? "").trim();
  if (!template) return null;
  if (!/^https:\/\//i.test(template)) return null;
  if (!/\{url(_encoded)?\}/.test(template)) return null;
  return {
    template,
    token: (Deno.env.get("COURT_EGRESS_TOKEN") ?? "").trim() || null,
    headerPrefix: (Deno.env.get("COURT_EGRESS_HEADER_PREFIX") ?? "X-Fwd-").trim(),
  };
}

export function courtEgressConfigured(): boolean {
  return courtEgressConfig() !== null;
}

interface EgressLedger {
  calls: number;
  consecutive_hard_failures: number;
  last_at: number;
  stopped_reason: string | null;
  attempts: CourtEgressAttempt[];
}

export interface CourtEgressAttempt {
  url: string;
  host: string;
  reason: string;
  status: number | null;
  content_type: string | null;
  content_length: number | null;
  error: string | null;
  connection_reset: boolean;
  ms: number;
  skipped_reason: string | null;
}

let ledger: EgressLedger = fresh();

function fresh(): EgressLedger {
  return {
    calls: 0,
    consecutive_hard_failures: 0,
    last_at: 0,
    stopped_reason: null,
    attempts: [],
  };
}

export function resetCourtEgressLedger(): void {
  ledger = fresh();
}

export function courtEgressTelemetry() {
  return {
    version: COURT_EGRESS_VERSION,
    configured: courtEgressConfigured(),
    calls: ledger.calls,
    max_per_run: COURT_EGRESS_LIMITS.MAX_PER_RUN,
    stopped_reason: ledger.stopped_reason,
    attempts: ledger.attempts.slice(0, 20),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function relayUrl(cfg: CourtEgressConfig, url: string): string {
  return cfg.template
    .replace("{url_encoded}", encodeURIComponent(url))
    .replace("{url}", url)
    .replace("{token}", cfg.token ?? "");
}

/**
 * Fetch an allowlisted official court URL through the alternative egress path.
 * Returns null when the path is not configured, not allowed, or exhausted.
 */
export async function courtEgressFetch(
  url: string,
  opts: { reason: string; headers: Record<string, string>; signal?: AbortSignal },
): Promise<Response | null> {
  const cfg = courtEgressConfig();
  const host = (() => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  const skip = (reason: string) => {
    ledger.attempts.push({
      url,
      host,
      reason: opts.reason,
      status: null,
      content_type: null,
      content_length: null,
      error: null,
      connection_reset: false,
      ms: 0,
      skipped_reason: reason,
    });
    return null;
  };

  if (!cfg) return skip("egress_not_configured");
  if (!isEgressAllowedHost(url)) return skip("host_not_allowlisted");
  if (ledger.stopped_reason) return skip(ledger.stopped_reason);
  if (ledger.calls >= COURT_EGRESS_LIMITS.MAX_PER_RUN) {
    ledger.stopped_reason = "egress_cap_reached";
    return skip("egress_cap_reached");
  }

  const since = Date.now() - ledger.last_at;
  const backoff = ledger.consecutive_hard_failures > 0
    ? Math.min(
      COURT_EGRESS_LIMITS.BACKOFF_MAX_MS,
      COURT_EGRESS_LIMITS.BACKOFF_BASE_MS * 2 ** (ledger.consecutive_hard_failures - 1),
    )
    : 0;
  const wait = Math.max(COURT_EGRESS_LIMITS.MIN_SPACING_MS - since, backoff);
  if (wait > 0) await sleep(wait);

  ledger.calls++;
  ledger.last_at = Date.now();
  const t0 = Date.now();

  // Forward the browser-like profile headers to the relay for the upstream
  // request, namespaced so the relay never confuses them with its own.
  const fwd: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.headers)) fwd[`${cfg.headerPrefix}${k}`] = v;
  if (cfg.token && !cfg.template.includes("{token}")) {
    fwd["Authorization"] = `Bearer ${cfg.token}`;
  }

  const timer = new AbortController();
  const to = setTimeout(() => timer.abort(), COURT_EGRESS_LIMITS.TIMEOUT_MS);
  try {
    const res = await fetch(relayUrl(cfg, url), {
      redirect: "follow",
      headers: fwd,
      signal: opts.signal ?? timer.signal,
    });
    ledger.attempts.push({
      url,
      host,
      reason: opts.reason,
      status: res.status,
      content_type: res.headers.get("content-type"),
      content_length: Number(res.headers.get("content-length") || "0") || null,
      error: null,
      connection_reset: false,
      ms: Date.now() - t0,
      skipped_reason: null,
    });
    if (res.status >= 400) {
      ledger.consecutive_hard_failures++;
    } else {
      ledger.consecutive_hard_failures = 0;
    }
    if (ledger.consecutive_hard_failures >= COURT_EGRESS_LIMITS.MAX_CONSECUTIVE_HARD_FAILURES) {
      ledger.stopped_reason = "repeated_egress_failure";
    }
    return res.status >= 400 ? null : res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ledger.attempts.push({
      url,
      host,
      reason: opts.reason,
      status: null,
      content_type: null,
      content_length: null,
      error: msg.slice(0, 200),
      connection_reset: /reset|closed|timeout|abort/i.test(msg),
      ms: Date.now() - t0,
      skipped_reason: null,
    });
    ledger.consecutive_hard_failures++;
    if (ledger.consecutive_hard_failures >= COURT_EGRESS_LIMITS.MAX_CONSECUTIVE_HARD_FAILURES) {
      ledger.stopped_reason = "repeated_egress_failure";
    }
    return null;
  } finally {
    clearTimeout(to);
  }
}


// ─────────────────────────────────────────────────────────────────────────
/**
 * canonical_body_acquisition_and_csm_survival_v1 — Part 1.
 *
 * Precise, per-fetch diagnostics for the dedicated court/gov relay path.
 *
 * Before this module, a relay failure surfaced as an opaque "502 / 0 bytes".
 * Every relay fetch now produces a `court_relay_fetch_diagnostic` row that
 * names the exact stage that failed: URL selection, edge→relay payload/auth,
 * relay network, upstream status, redirect, bytes, file type, extraction or
 * identity validation.
 *
 * Nothing here bypasses authentication, CAPTCHA, paywalls or access control:
 * it fetches the same public document URLs the pipeline already discovered,
 * through the same allowlisted relay, and only records what happened.
 */


export const COURT_RELAY_DIAGNOSTICS_VERSION =
  "canonical_body_acquisition_and_csm_survival_v1";

export type RelayUrlSource =
  | "local_db"
  | "discovered_url"
  | "official_candidate"
  | "mirror_candidate"
  | "derived_url"
  | "manual_test_url";

export type RelayFinalClassification =
  | "no_candidate_url_found"
  | "bad_or_unusable_url"
  | "edge_to_relay_payload_or_auth_failure"
  | "relay_network_dns_tls_failure"
  | "relay_upstream_403_or_blocked"
  | "redirect_not_followed"
  | "html_error_instead_of_pdf"
  | "zero_bytes_received"
  | "unsupported_file_type"
  | "pdf_bytes_received_extraction_failed"
  | "doc_bytes_received_extraction_failed"
  | "identity_validation_failed"
  | "success_body_acquired";

export interface CourtRelayFetchDiagnostic {
  request_id: string;
  run_id: string | null;
  source_id: string | null;
  authority_id: string | null;
  input_url: string;
  normalized_url: string;
  url_source: RelayUrlSource;
  transport: "relay" | "direct_edge";
  method: string;
  non_secret_headers_sent: string[];
  dns_ms: number | null;
  tls_ms: number | null;
  ttfb_ms: number | null;
  total_ms: number;
  upstream_http_status: number | null;
  relay_http_status: number | null;
  redirect_chain: string[];
  final_url: string | null;
  content_type: string | null;
  content_length_header: number | null;
  bytes_received: number;
  first_20_bytes_or_magic_header: string | null;
  is_pdf: boolean;
  is_doc_or_docx: boolean;
  is_html: boolean;
  extraction_attempted: boolean;
  extracted_text_chars: number;
  error_code: string | null;
  error_message: string | null;
  timeout_stage: string | null;
  final_classification: RelayFinalClassification;
}

const MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    // Court download endpoints carry backslashes in `path` — keep them intact.
    return u.toString();
  } catch {
    return String(url ?? "").trim();
  }
}

function magic(bytes: Uint8Array): string {
  return Array.from(bytes.slice(0, 20))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
}

function looksHtml(bytes: Uint8Array, contentType: string): boolean {
  if (/html/i.test(contentType)) return true;
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 200)).trim().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html");
}

export interface RelayProbeOptions {
  run_id?: string | null;
  source_id?: string | null;
  authority_id?: string | null;
  url_source?: RelayUrlSource;
  timeout_ms?: number;
  /** When present, the extracted body must contain this text to validate. */
  identity_must_contain?: string | null;
  /** Skip extraction (headers/bytes only). */
  extract?: boolean;
}

/**
 * Run the exact relay fetch + extraction path for one URL and return the
 * full diagnostic. Never throws.
 */
export async function relayFetchDiagnostic(
  url: string,
  opts: RelayProbeOptions = {},
): Promise<CourtRelayFetchDiagnostic> {
  return await fetchDiagnostic(url, "relay", opts);
}

/** Same shape, but issued straight from the Supabase Edge egress. */
export async function directFetchDiagnostic(
  url: string,
  opts: RelayProbeOptions = {},
): Promise<CourtRelayFetchDiagnostic> {
  return await fetchDiagnostic(url, "direct_edge", opts);
}

async function fetchDiagnostic(
  url: string,
  transport: "relay" | "direct_edge",
  opts: RelayProbeOptions,
): Promise<CourtRelayFetchDiagnostic> {
  const t0 = Date.now();
  const normalized_url = normalizeUrl(url);
  const diag: CourtRelayFetchDiagnostic = {
    request_id: crypto.randomUUID(),
    run_id: opts.run_id ?? null,
    source_id: opts.source_id ?? null,
    authority_id: opts.authority_id ?? null,
    input_url: url,
    normalized_url,
    url_source: opts.url_source ?? "manual_test_url",
    transport,
    method: "GET",
    non_secret_headers_sent: [],
    dns_ms: null,
    tls_ms: null,
    ttfb_ms: null,
    total_ms: 0,
    upstream_http_status: null,
    relay_http_status: null,
    redirect_chain: [],
    final_url: null,
    content_type: null,
    content_length_header: null,
    bytes_received: 0,
    first_20_bytes_or_magic_header: null,
    is_pdf: false,
    is_doc_or_docx: false,
    is_html: false,
    extraction_attempted: false,
    extracted_text_chars: 0,
    error_code: null,
    error_message: null,
    timeout_stage: null,
    final_classification: "bad_or_unusable_url",
  };

  if (!/^https?:\/\//i.test(normalized_url)) {
    diag.error_code = "bad_url";
    diag.total_ms = Date.now() - t0;
    return diag;
  }

  const upstreamHeaders = officialHeaders(normalized_url);
  let target = normalized_url;
  let headers: Record<string, string> = upstreamHeaders;

  if (transport === "relay") {
    const cfg = courtEgressConfig();
    if (!cfg) {
      diag.error_code = "egress_not_configured";
      diag.final_classification = "edge_to_relay_payload_or_auth_failure";
      diag.total_ms = Date.now() - t0;
      return diag;
    }
    if (!isEgressAllowedHost(normalized_url)) {
      diag.error_code = "host_not_allowlisted";
      diag.final_classification = "bad_or_unusable_url";
      diag.total_ms = Date.now() - t0;
      return diag;
    }
    target = cfg.template
      .replace("{url_encoded}", encodeURIComponent(normalized_url))
      .replace("{url}", normalized_url)
      .replace("{token}", cfg.token ?? "");
    const fwd: Record<string, string> = {};
    for (const [k, v] of Object.entries(upstreamHeaders)) fwd[`${cfg.headerPrefix}${k}`] = v;
    if (cfg.token && !cfg.template.includes("{token}")) {
      fwd["Authorization"] = `Bearer ${cfg.token}`;
    }
    headers = fwd;
  }
  diag.non_secret_headers_sent = Object.keys(headers).filter((h) =>
    !/^authorization$/i.test(h)
  );

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), opts.timeout_ms ?? DEFAULT_TIMEOUT_MS);
  let bytes: Uint8Array = new Uint8Array(0);
  try {
    const res = await fetch(target, { method: "GET", headers, redirect: "follow", signal: ctrl.signal });
    diag.ttfb_ms = Date.now() - t0;
    if (transport === "relay") {
      diag.relay_http_status = res.status;
      const up = res.headers.get("x-upstream-status") ?? res.headers.get("x-relay-upstream-status");
      diag.upstream_http_status = up ? Number(up) || null : null;
      const chain = res.headers.get("x-redirect-chain");
      if (chain) diag.redirect_chain = chain.split(/[,\s]+/).filter(Boolean);
      diag.final_url = res.headers.get("x-final-url") ?? (res.redirected ? res.url : null);
    } else {
      diag.upstream_http_status = res.status;
      diag.final_url = res.redirected ? res.url : normalized_url;
    }
    diag.content_type = res.headers.get("content-type");
    diag.content_length_header = Number(res.headers.get("content-length") || "0") || null;

    const buf = await readCapped(res, MAX_BYTES);
    bytes = buf as Uint8Array;
    diag.bytes_received = buf.byteLength;
    diag.first_20_bytes_or_magic_header = buf.byteLength ? magic(buf) : null;

    const ct = diag.content_type ?? "";
    const head = new TextDecoder("latin1").decode(buf.slice(0, 8));
    diag.is_pdf = head.startsWith("%PDF") || /pdf/i.test(ct) || /\.pdf($|[?#])/i.test(normalized_url);
    diag.is_doc_or_docx = head.startsWith("PK") ||
      (head.charCodeAt(0) === 0xd0 && head.charCodeAt(1) === 0xcf) ||
      /msword|wordprocessingml|officedocument/i.test(ct) ||
      /\.docx?($|[?#])/i.test(normalized_url);
    diag.is_html = looksHtml(buf, ct);

    const status = (transport === "relay" ? (diag.upstream_http_status ?? diag.relay_http_status) : diag.upstream_http_status) ?? 0;

    if (transport === "relay" && (diag.relay_http_status ?? 0) >= 500 && buf.byteLength === 0) {
      diag.final_classification = "relay_network_dns_tls_failure";
      diag.error_code = `relay_${diag.relay_http_status}`;
      diag.error_message = new TextDecoder().decode(buf.slice(0, 300)) || null;
    } else if (status === 401 || status === 403 || status === 429) {
      diag.final_classification = "relay_upstream_403_or_blocked";
      diag.error_code = `upstream_${status}`;
    } else if (buf.byteLength === 0) {
      diag.final_classification = "zero_bytes_received";
      diag.error_code = "zero_bytes";
    } else if (diag.is_html && !diag.is_pdf && status >= 400) {
      diag.final_classification = "html_error_instead_of_pdf";
    } else if (opts.extract === false) {
      diag.final_classification = "success_body_acquired";
    } else {
      diag.extraction_attempted = true;
      let text = "";
      try {
        if (diag.is_pdf) text = await extractDocumentText(buf, "pdf");
        else if (head.startsWith("PK")) text = await extractDocumentText(buf, "docx");
        else text = decodeText(buf, ct);
      } catch (e) {
        diag.error_code = "extraction_failed";
        diag.error_message = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      }
      if (diag.is_html) text = stripHtml(text);
      diag.extracted_text_chars = text.trim().length;
      if (diag.extracted_text_chars < 200) {
        diag.final_classification = diag.is_pdf
          ? "pdf_bytes_received_extraction_failed"
          : diag.is_doc_or_docx
          ? "doc_bytes_received_extraction_failed"
          : diag.is_html
          ? "html_error_instead_of_pdf"
          : "unsupported_file_type";
      } else if (
        opts.identity_must_contain &&
        !text.slice(0, 40_000).includes(opts.identity_must_contain)
      ) {
        diag.final_classification = "identity_validation_failed";
      } else {
        diag.final_classification = "success_body_acquired";
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    diag.error_message = msg.slice(0, 300);
    if (/abort|timeout/i.test(msg)) {
      diag.error_code = "timeout";
      diag.timeout_stage = diag.ttfb_ms === null ? "connect_or_ttfb" : "body_read";
      diag.final_classification = "relay_network_dns_tls_failure";
    } else if (/dns|tls|handshake|connection|reset|closed/i.test(msg)) {
      diag.error_code = "network";
      diag.final_classification = "relay_network_dns_tls_failure";
    } else {
      diag.error_code = "fetch_failed";
      diag.final_classification = "relay_network_dns_tls_failure";
    }
  } finally {
    clearTimeout(timeout);
  }
  diag.total_ms = Date.now() - t0;
  return diag;
}

function decodeText(bytes: Uint8Array, contentType: string): string {
  const m = /charset=([\w-]+)/i.exec(contentType ?? "");
  const enc = (m?.[1] ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(enc as string).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  if (!res.body) {
    const ab = await res.arrayBuffer();
    return new Uint8Array(ab.slice(0, max));
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < max) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  try {
    await reader.cancel();
  } catch { /* ignore */ }
  const out = new Uint8Array(Math.min(total, max));
  let off = 0;
  for (const c of chunks) {
    if (off >= out.length) break;
    const take = Math.min(c.byteLength, out.length - off);
    out.set(c.subarray(0, take), off);
    off += take;
  }
  return out;
}

// ── per-run diagnostic ledger ───────────────────────────────────────────────

let rows: CourtRelayFetchDiagnostic[] = [];

export function resetCourtRelayDiagnostics(): void {
  rows = [];
}

export function recordCourtRelayDiagnostic(row: CourtRelayFetchDiagnostic): void {
  if (rows.length < 40) rows.push(row);
}

export function courtRelayDiagnostics(): {
  version: string;
  count: number;
  rows: CourtRelayFetchDiagnostic[];
} {
  return { version: COURT_RELAY_DIAGNOSTICS_VERSION, count: rows.length, rows };
}
