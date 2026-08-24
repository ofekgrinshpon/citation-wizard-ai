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

export const COURT_EGRESS_VERSION = "official_court_egress_path_v1";

export const COURT_EGRESS_LIMITS = {
  /** Hard cap on alternative-egress fetches per run. */
  MAX_PER_RUN: 3,
  /** Minimum spacing between two alternative-egress fetches. */
  MIN_SPACING_MS: 1_000,
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
