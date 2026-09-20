/**
 * legal-research-v2 — acquisition failure taxonomy
 * (acquisition_failure_taxonomy_v1).
 *
 * One job: turn "http_failed" into a specific, actionable terminal cause, so a
 * repository that refuses our egress is never confused with a DNS failure, a
 * login wall, a JavaScript shell or a PDF whose body could not be read.
 *
 * Pure classification. It never retries, never routes and never relaxes a gate.
 */

export type FetchFailureClass =
  | "dns_failure"
  | "tls_failure"
  | "connection_reset"
  | "timeout"
  | "http_403_forbidden"
  | "http_401_unauthorized"
  | "http_404_not_found"
  | "http_429_rate_limited"
  | "http_5xx_origin_error"
  | "http_error"
  | "redirect_loop"
  | "login_or_paywall_challenge"
  | "block_page"
  | "unsupported_content_type"
  | "landing_page_not_document"
  | "javascript_shell"
  | "empty_extraction"
  | "pdf_body_unreadable"
  | "discovery_endpoint_not_a_document";

/** Failure classes that a bounded alternative-copy attempt can plausibly fix. */
const RECOVERABLE: FetchFailureClass[] = [
  "http_403_forbidden",
  "http_401_unauthorized",
  "http_404_not_found",
  "http_429_rate_limited",
  "http_5xx_origin_error",
  "connection_reset",
  "tls_failure",
  "timeout",
  "block_page",
  "login_or_paywall_challenge",
  "landing_page_not_document",
  "javascript_shell",
  "empty_extraction",
  "pdf_body_unreadable",
];

export function isRecoverableFailure(c: FetchFailureClass): boolean {
  return RECOVERABLE.includes(c);
}

export function classifyHttpStatus(status: number): FetchFailureClass {
  if (status === 401) return "http_401_unauthorized";
  if (status === 403) return "http_403_forbidden";
  if (status === 404) return "http_404_not_found";
  if (status === 429) return "http_429_rate_limited";
  if (status >= 500) return "http_5xx_origin_error";
  return "http_error";
}

export function classifyFetchException(message: string): FetchFailureClass {
  const m = String(message ?? "").toLowerCase();
  if (/abort|timed? ?out|deadline/.test(m)) return "timeout";
  if (/dns|name not resolved|failed to lookup|nodename/.test(m)) return "dns_failure";
  if (/tls|handshake|certificate|ssl/.test(m)) return "tls_failure";
  if (/redirect/.test(m)) return "redirect_loop";
  if (/reset|broken pipe|connection closed|error sending request|econnreset/.test(m)) {
    return "connection_reset";
  }
  return "http_error";
}

const LOGIN_SIGNATURES = [
  "sign in to continue",
  "please log in",
  "subscribe to continue",
  "purchase this article",
  "institutional login",
  "התחבר כדי לצפות",
  "נדרשת הרשמה",
];

const JS_SHELL_SIGNATURES = [
  "enable javascript",
  "javascript is required",
  "your browser does not support frames",
  "<noframes",
];

/**
 * Classify a body that WAS delivered (HTTP 200) but is not a usable document.
 * `reason` is the deterministic document-check reason already computed.
 */
export function classifyUnusableBody(
  input: { text: string; reason?: string; content_type?: string; is_pdf?: boolean },
): FetchFailureClass {
  const t = (input.text ?? "").toLowerCase();
  if (!t.trim()) return input.is_pdf ? "pdf_body_unreadable" : "empty_extraction";
  if (LOGIN_SIGNATURES.some((s) => t.includes(s))) return "login_or_paywall_challenge";
  if (JS_SHELL_SIGNATURES.some((s) => t.includes(s))) return "javascript_shell";
  if (input.reason === "block_page") return "block_page";
  if (input.reason?.startsWith("listing_or_portal_shell") || input.reason === "portal_shell_no_prose") {
    return "landing_page_not_document";
  }
  if (input.reason === "too_short_for_a_document") {
    return input.is_pdf ? "pdf_body_unreadable" : "empty_extraction";
  }
  if (input.content_type && !/pdf|html|text|xml|wordprocessingml/i.test(input.content_type)) {
    return "unsupported_content_type";
  }
  return "empty_extraction";
}
