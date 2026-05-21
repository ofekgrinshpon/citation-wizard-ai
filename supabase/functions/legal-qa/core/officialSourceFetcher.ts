// Research Core v1 — Pass C: official-URL fetch + parse.
//
// Strict host-allowlisted HTTP fetch + regex parsing of the resulting HTML
// to recover {docket, parties, year, fullDate} for bare-reporter citations
// whose LedgerSource carries an official permalink.
//
// No LLM. No HTML library. No new deps. Pure fetch + regex.
//
// Constraints:
//   • 12s per-fetch timeout (server-side AbortController).
//   • Caller is responsible for parallel cap + overall budget.
//   • Strips HTML tags + decodes basic entities; works on first ~16 KB +
//     <title> only (large judgments shouldn't need more for parties/docket).
//   • Returns null on any failure — never throws to the caller.

import {
  extractDocketFromText,
  extractPartiesFromText,
  extractYearFromText,
  extractFullDateFromText,
} from "./citationCleanup.ts";

// Hosts whose pages are considered authoritative for case identity.
// Tight by design — must match the same trust set used elsewhere.
const APPROVED_OFFICIAL_HOSTS = new Set<string>([
  "supreme.court.gov.il",
  "supremedecisions.court.gov.il",
  "elyon1.court.gov.il",
  "elyon2.court.gov.il",
  "versa.cardozo.yu.edu",
  "nevo.co.il",
  "www.nevo.co.il",
]);

export interface OfficialPageFields {
  prefix?: string;
  docket?: string;
  party1?: string;
  party2?: string;
  year?: string;
  fullDate?: string;
  source_url: string;
}

export interface FetcherTelemetry {
  attempted: number;
  recovered: number;
  timeouts: number;
  errors: number;
  per_url: Array<{
    url: string;
    status: "hit" | "miss" | "timeout" | "error" | "host_not_allowed" | "http_error";
    http_status?: number;
    detail?: string;
  }>;
}

function isApprovedUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return APPROVED_OFFICIAL_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

const ENTITY_MAP: Record<string, string> = {
  amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ",
};
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, n) => ENTITY_MAP[n] ?? m);
}
function stripHtml(s: string): string {
  return s
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<{ ok: boolean; status: number; text: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        // Some Israeli court endpoints return 403 without a UA.
        "User-Agent": "Mozilla/5.0 (compatible; ReLexResearchCore/1.0)",
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
      },
      redirect: "follow",
    });
    // Pull only the first 64KB — enough for header/metadata/title/parties.
    const reader = res.body?.getReader();
    if (!reader) {
      return { ok: res.ok, status: res.status, text: "" };
    }
    const decoder = new TextDecoder("utf-8", { fatal: false });
    let received = 0;
    const MAX_BYTES = 64 * 1024;
    let buf = "";
    while (received < MAX_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value.byteLength;
      buf += decoder.decode(value, { stream: true });
      if (received >= MAX_BYTES) break;
    }
    try { await reader.cancel(); } catch { /* noop */ }
    buf += decoder.decode();
    return { ok: res.ok, status: res.status, text: buf };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Fetch a single official URL and extract case fields. Returns null on any
 * failure (host filter, timeout, HTTP error, no extractable fields).
 *
 * Side-effect: pushes a per-url telemetry record to `telemetry.per_url`.
 */
export async function fetchOfficialCasePage(
  url: string,
  telemetry: FetcherTelemetry,
  timeoutMs = 12_000,
): Promise<OfficialPageFields | null> {
  if (!isApprovedUrl(url)) {
    telemetry.per_url.push({ url, status: "host_not_allowed" });
    return null;
  }
  telemetry.attempted++;
  try {
    const { ok, status, text } = await fetchWithTimeout(url, timeoutMs);
    if (!ok) {
      telemetry.errors++;
      telemetry.per_url.push({ url, status: "http_error", http_status: status });
      return null;
    }
    // Extract <title> separately because it's high-signal.
    const titleM = text.match(/<title\b[^>]*>([\s\S]{0,400}?)<\/title>/i);
    const titleText = titleM ? decodeEntities(stripHtml(titleM[1])) : "";
    // Build a single high-signal blob: title + first chunk of body text.
    const bodyText = decodeEntities(stripHtml(text.slice(0, 16_000)));
    const blob = `${titleText}\n${bodyText}`;
    const docket = extractDocketFromText(blob);
    const parties = extractPartiesFromText(blob);
    const year = extractYearFromText(blob);
    const fullDate = extractFullDateFromText(blob);
    if (!docket && !parties) {
      telemetry.per_url.push({ url, status: "miss", http_status: status, detail: "no_fields_extracted" });
      return null;
    }
    telemetry.recovered++;
    telemetry.per_url.push({ url, status: "hit", http_status: status });
    return {
      prefix: docket?.prefix,
      docket: docket?.docket,
      party1: parties?.party1,
      party2: parties?.party2,
      year,
      fullDate,
      source_url: url,
    };
  } catch (e) {
    const isAbort = e instanceof DOMException && e.name === "AbortError";
    if (isAbort) telemetry.timeouts++;
    else telemetry.errors++;
    telemetry.per_url.push({
      url,
      status: isAbort ? "timeout" : "error",
      detail: (e as Error).message?.slice(0, 200),
    });
    return null;
  }
}

export function newFetcherTelemetry(): FetcherTelemetry {
  return { attempted: 0, recovered: 0, timeouts: 0, errors: 0, per_url: [] };
}

export { APPROVED_OFFICIAL_HOSTS, isApprovedUrl };
