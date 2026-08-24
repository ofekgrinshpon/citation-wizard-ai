/**
 * official_fetch_profile_v1
 *
 * A single, shared fetch profile for official / high-trust legal document
 * hosts (Supreme Court decision server, court.gov.il, gov.il legal hosts).
 *
 * Why this exists: the origin is not protected by anti-bot challenges, but it
 * rejects requests that do not look like an ordinary browser navigation
 * (missing Accept / Accept-Language / Referer) by redirecting them to a Hebrew
 * "unauthorised request" interstitial served with HTTP 200. It also enforces
 * an unpublished burst limit (connection resets after a rapid series of
 * requests).
 *
 * This module therefore does exactly two things:
 *   1. sends normal browser-like headers on official hosts;
 *   2. serialises, caps and backs off official-host fetches per run.
 *
 * It does NOT bypass authentication, CAPTCHA, paywalls or any access control:
 * no cookies are minted, no login is performed, no challenge is solved.
 */

import {
  courtEgressConfigured,
  courtEgressFetch,
  isEgressAllowedHost,
} from "./courtEgress.ts";

export const OFFICIAL_FETCH_VERSION = "official_fetch_profile_v1";

export const OFFICIAL_FETCH_LIMITS = {
  /** Hard cap on official-host fetches per run. */
  MAX_PER_RUN: 5,
  /** Minimum spacing between two official-host fetches. */
  MIN_SPACING_MS: 700,
  /** Backoff after a reset / block, doubled per consecutive failure. */
  BACKOFF_BASE_MS: 900,
  BACKOFF_MAX_MS: 4_000,
  /** Stop issuing official fetches after this many consecutive resets/blocks. */
  MAX_CONSECUTIVE_HARD_FAILURES: 3,
} as const;

const OFFICIAL_HOSTS = [
  "supremedecisions.court.gov.il",
  "elyon1.court.gov.il",
  "elyon2.court.gov.il",
  "court.gov.il",
  "www.court.gov.il",
  "din.court.gov.il",
  "knesset.gov.il",
  "main.knesset.gov.il",
  "fs.knesset.gov.il",
  "www.gov.il",
  "gov.il",
  "mevaker.gov.il",
  "www.mevaker.gov.il",
  "nevo.co.il",
  "www.nevo.co.il",
];

/** Hosts subject to the burst limit (serialise + cap + backoff). */
const RATE_LIMITED_HOST_RE = /(^|\.)court\.gov\.il$/i;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const BLOCK_PAGE_SIGNATURES = [
  "חסימת בקשה לא מורשת",
  "בקשה לא מורשת",
  "request rejected",
  "access denied",
  "request blocked",
];

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isOfficialHost(url: string): boolean {
  const h = hostOf(url);
  if (!h) return false;
  return OFFICIAL_HOSTS.some((o) => h === o || h.endsWith(`.${o}`));
}

function isRateLimitedHost(url: string): boolean {
  return RATE_LIMITED_HOST_RE.test(hostOf(url));
}

/**
 * A plausible same-origin referer: the origin's own search / landing page.
 * Never a third-party or fabricated authenticated page.
 */
function refererFor(url: string): string {
  try {
    const u = new URL(url);
    if (/supremedecisions\.court\.gov\.il$/i.test(u.hostname)) {
      return "https://supremedecisions.court.gov.il/Home/Search";
    }
    return `${u.origin}/`;
  } catch {
    return "";
  }
}

export function officialHeaders(url: string, extra?: Record<string, string>): Record<string, string> {
  const ref = refererFor(url);
  return {
    "User-Agent": BROWSER_UA,
    "Accept": "application/pdf,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.7,en;q=0.6",
    ...(ref ? { "Referer": ref } : {}),
    ...(extra ?? {}),
  };
}

/** Default profile for every non-official host (unchanged behaviour). */
export const DEFAULT_UA = "Mozilla/5.0 (compatible; ReLexBot/1.0; +https://relexlm.com)";

export interface OfficialFetchAttempt {
  host: string;
  url: string;
  /** Where the URL came from, when the caller knows. */
  url_origin: "search_first" | "derivation" | "retrieved" | "cache" | "unknown";
  profile: "official_browser_like" | "default_bot";
  status: number | null;
  content_type: string | null;
  content_length: number | null;
  redirected: boolean;
  block_page_detected: boolean;
  rate_limited: boolean;
  connection_reset: boolean;
  error: string | null;
  ms: number;
  skipped_reason: string | null;
}

interface Ledger {
  attempts: OfficialFetchAttempt[];
  official_calls: number;
  consecutive_hard_failures: number;
  last_official_at: number;
  chain: Promise<unknown>;
  stopped_reason: string | null;
}

let ledger: Ledger = freshLedger();

function freshLedger(): Ledger {
  return {
    attempts: [],
    official_calls: 0,
    consecutive_hard_failures: 0,
    last_official_at: 0,
    chain: Promise.resolve(),
    stopped_reason: null,
  };
}

/** Call once at the start of every run. */
export function resetOfficialFetchLedger(): void {
  ledger = freshLedger();
}

export function officialFetchTelemetry() {
  return {
    version: OFFICIAL_FETCH_VERSION,
    official_calls: ledger.official_calls,
    max_per_run: OFFICIAL_FETCH_LIMITS.MAX_PER_RUN,
    stopped_reason: ledger.stopped_reason,
    block_pages_detected: ledger.attempts.filter((a) => a.block_page_detected).length,
    rate_limited_events: ledger.attempts.filter((a) => a.rate_limited || a.connection_reset).length,
    attempts: ledger.attempts.slice(0, 40),
  };
}

/** Record a downstream outcome for the last attempt on this URL (telemetry only). */
export function noteOfficialFetchOutcome(
  url: string,
  patch: Partial<
    OfficialFetchAttempt & {
      body_bytes: number;
      preflight: string;
      extracted_chars: number;
      identity_validated: boolean | null;
      cache_write: string | null;
      injected_candidate_id: string | null;
    }
  >,
): void {
  for (let i = ledger.attempts.length - 1; i >= 0; i--) {
    if (ledger.attempts[i].url === url) {
      Object.assign(ledger.attempts[i], patch);
      return;
    }
  }
}

export function looksLikeBlockPage(text: string): boolean {
  const head = text.slice(0, 4_000).toLowerCase();
  return BLOCK_PAGE_SIGNATURES.some((s) => head.includes(s.toLowerCase()));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isResetError(msg: string): boolean {
  return /connection reset|connection closed|error sending request|broken pipe|ECONNRESET|tls|handshake/i
    .test(msg);
}

export interface OfficialFetchOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
  url_origin?: OfficialFetchAttempt["url_origin"];
  /** Skip the per-run cap (never used for the burst-limited court hosts). */
  method?: string;
}

/**
 * Fetch a URL with the right profile for its host.
 *
 * - official hosts: browser-like headers; court hosts are additionally
 *   serialised, capped and backed off per run;
 * - everything else: the previous ReLex bot profile, unchanged.
 */
export async function officialFetch(
  url: string,
  opts: OfficialFetchOptions = {},
): Promise<Response> {
  const official = isOfficialHost(url);
  const gated = official && isRateLimitedHost(url);
  if (!gated) {
    const t0 = Date.now();
    const headers = official
      ? officialHeaders(url, opts.headers)
      : { "User-Agent": DEFAULT_UA, ...(opts.headers ?? {}) };
    const res = await fetch(url, {
      redirect: "follow",
      headers,
      ...(opts.method ? { method: opts.method } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    if (official) {
      ledger.attempts.push(describe(url, opts, res, t0, "official_browser_like"));
    }
    return res;
  }

  // Serialise every court-host fetch behind a single chain.
  const run = ledger.chain.then(async (): Promise<Response> => {
    const t0 = Date.now();
    if (ledger.stopped_reason) {
      ledger.attempts.push(skipped(url, opts, ledger.stopped_reason));
      throw new Error(`official_fetch_stopped:${ledger.stopped_reason}`);
    }
    if (ledger.official_calls >= OFFICIAL_FETCH_LIMITS.MAX_PER_RUN) {
      ledger.stopped_reason = "official_fetch_cap_reached";
      ledger.attempts.push(skipped(url, opts, "official_fetch_cap_reached"));
      throw new Error("official_fetch_cap_reached");
    }
    const since = Date.now() - ledger.last_official_at;
    const backoff = ledger.consecutive_hard_failures > 0
      ? Math.min(
        OFFICIAL_FETCH_LIMITS.BACKOFF_MAX_MS,
        OFFICIAL_FETCH_LIMITS.BACKOFF_BASE_MS * 2 ** (ledger.consecutive_hard_failures - 1),
      )
      : 0;
    const wait = Math.max(OFFICIAL_FETCH_LIMITS.MIN_SPACING_MS - since, backoff);
    if (wait > 0) await sleep(wait);

    ledger.official_calls++;
    ledger.last_official_at = Date.now();
    try {
      const res = await fetch(url, {
        redirect: "follow",
        headers: officialHeaders(url, opts.headers),
        ...(opts.method ? { method: opts.method } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      const rec = describe(url, opts, res, t0, "official_browser_like");
      ledger.attempts.push(rec);
      if (res.status === 403 || res.status === 429) {
        rec.rate_limited = res.status === 429;
        rec.block_page_detected = res.status === 403;
        ledger.consecutive_hard_failures++;
        const alt = await tryAltEgress(url, opts, rec, `origin_status_${res.status}`);
        if (alt) return alt;
      } else {
        ledger.consecutive_hard_failures = 0;
      }
      if (ledger.consecutive_hard_failures >= OFFICIAL_FETCH_LIMITS.MAX_CONSECUTIVE_HARD_FAILURES) {
        ledger.stopped_reason = "repeated_origin_rejection";
      }
      return res;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const rec = skipped(url, opts, null);
      rec.error = msg.slice(0, 200);
      rec.ms = Date.now() - t0;
      rec.connection_reset = isResetError(msg);
      ledger.attempts.push(rec);
      if (rec.connection_reset) {
        ledger.consecutive_hard_failures++;
        const alt = await tryAltEgress(url, opts, rec, "edge_connection_reset");
        if (alt) return alt;
        if (
          ledger.consecutive_hard_failures >= OFFICIAL_FETCH_LIMITS.MAX_CONSECUTIVE_HARD_FAILURES
        ) {
          ledger.stopped_reason = "repeated_connection_reset";
        }
      }
      throw err;
    }
  });
  // Keep the chain alive regardless of this call's outcome.
  ledger.chain = run.then(() => undefined, () => undefined);
  return await run;
}

/**
 * official_court_egress_path_v1 — fallback only, allowlisted court hosts only,
 * only after the direct edge fetch already failed.
 */
async function tryAltEgress(
  url: string,
  opts: OfficialFetchOptions,
  rec: OfficialFetchAttempt & Record<string, unknown>,
  reason: string,
): Promise<Response | null> {
  rec.alt_egress_attempted = false;
  if (!courtEgressConfigured() || !isEgressAllowedHost(url)) {
    rec.alt_egress_skipped = courtEgressConfigured() ? "host_not_allowlisted" : "egress_not_configured";
    return null;
  }
  rec.alt_egress_attempted = true;
  rec.alt_egress_reason = reason;
  const res = await courtEgressFetch(url, {
    reason,
    headers: officialHeaders(url, opts.headers),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  rec.alt_egress_status = res?.status ?? null;
  rec.alt_egress_content_type = res?.headers.get("content-type") ?? null;
  if (res) {
    // A successful alternative-egress fetch clears the origin-failure streak
    // for this run: the origin itself is reachable, only the edge IP is not.
    ledger.consecutive_hard_failures = 0;
  }
  return res;
}


function describe(
  url: string,
  opts: OfficialFetchOptions,
  res: Response,
  t0: number,
  profile: OfficialFetchAttempt["profile"],
): OfficialFetchAttempt {
  return {
    host: hostOf(url),
    url,
    url_origin: opts.url_origin ?? "unknown",
    profile,
    status: res.status,
    content_type: res.headers.get("content-type"),
    content_length: Number(res.headers.get("content-length") || "0") || null,
    redirected: res.redirected,
    block_page_detected: false,
    rate_limited: false,
    connection_reset: false,
    error: null,
    ms: Date.now() - t0,
    skipped_reason: null,
  };
}

function skipped(
  url: string,
  opts: OfficialFetchOptions,
  reason: string | null,
): OfficialFetchAttempt {
  return {
    host: hostOf(url),
    url,
    url_origin: opts.url_origin ?? "unknown",
    profile: "official_browser_like",
    status: null,
    content_type: null,
    content_length: null,
    redirected: false,
    block_page_detected: false,
    rate_limited: false,
    connection_reset: false,
    error: null,
    ms: 0,
    skipped_reason: reason,
  };
}
