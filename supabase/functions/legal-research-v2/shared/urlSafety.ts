/**
 * legal-research-v2 — deterministic outbound-URL safety gate.
 *
 * One job: decide whether a URL the agent (or a discovery result) supplied may
 * be handed to the HTTP fetch lane at all. It never ranks, never routes and
 * never widens anything: the court relay allowlist, the official-fetch profile
 * and the judgment-URL eligibility gate all still run afterwards, unchanged.
 *
 * Raw web search can return arbitrary URLs, so this gate is applied to every
 * HTTP acquisition — including the final URL after redirects.
 */

export type UnsafeUrlReason =
  | "unparseable_url"
  | "unsupported_protocol"
  | "missing_host"
  | "loopback_host"
  | "private_network_host"
  | "link_local_host"
  | "metadata_endpoint"
  | "non_public_tld";

export interface UrlSafetyVerdict {
  safe: boolean;
  reason?: UnsafeUrlReason;
  host?: string;
}

const LOOPBACK_NAMES = new Set(["localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback"]);

/** Host suffixes that never resolve to a public internet document. */
const NON_PUBLIC_SUFFIXES = [".local", ".internal", ".localdomain", ".home.arpa", ".onion"];

/** Well-known cloud instance-metadata endpoints. */
const METADATA_HOSTS = new Set([
  "169.254.169.254",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
]);

function ipv4Parts(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p >= 0 && p <= 255) ? parts : null;
}

function classifyIpv4(parts: number[]): UnsafeUrlReason | null {
  const [a, b] = parts;
  if (a === 127 || a === 0) return "loopback_host";
  if (a === 169 && b === 254) return "link_local_host";
  if (a === 10) return "private_network_host";
  if (a === 172 && b >= 16 && b <= 31) return "private_network_host";
  if (a === 192 && b === 168) return "private_network_host";
  if (a === 100 && b >= 64 && b <= 127) return "private_network_host";
  if (a >= 224) return "private_network_host";
  return null;
}

function classifyIpv6(host: string): UnsafeUrlReason | null {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (!h.includes(":")) return null;
  if (h === "::1" || h === "::") return "loopback_host";
  if (h.startsWith("fe80") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")) {
    return "link_local_host";
  }
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return "private_network_host";
  // IPv4-mapped forms (::ffff:127.0.0.1)
  const mapped = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h)?.[1];
  if (mapped) {
    const parts = ipv4Parts(mapped);
    if (parts) return classifyIpv4(parts);
  }
  return null;
}

export function checkUrlSafety(rawUrl: string): UrlSafetyVerdict {
  let u: URL;
  try {
    u = new URL(String(rawUrl ?? "").trim());
  } catch {
    return { safe: false, reason: "unparseable_url" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { safe: false, reason: "unsupported_protocol" };
  }
  const host = u.hostname.toLowerCase();
  if (!host) return { safe: false, reason: "missing_host" };
  if (METADATA_HOSTS.has(host)) return { safe: false, reason: "metadata_endpoint", host };
  if (LOOPBACK_NAMES.has(host)) return { safe: false, reason: "loopback_host", host };
  if (NON_PUBLIC_SUFFIXES.some((s) => host.endsWith(s))) {
    return { safe: false, reason: "non_public_tld", host };
  }
  const v4 = ipv4Parts(host);
  if (v4) {
    const bad = classifyIpv4(v4);
    if (bad) return { safe: false, reason: bad, host };
    return { safe: true, host };
  }
  const v6 = classifyIpv6(u.hostname);
  if (v6) return { safe: false, reason: v6, host };
  if (!host.includes(".")) return { safe: false, reason: "non_public_tld", host };
  return { safe: true, host };
}

export function isSafeFetchUrl(url: string): boolean {
  return checkUrlSafety(url).safe;
}
