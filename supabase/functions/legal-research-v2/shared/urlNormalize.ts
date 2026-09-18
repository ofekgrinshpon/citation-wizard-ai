/**
 * legal-research-v2 — deterministic URL repair (academic_evidence_yield_v1).
 *
 * Observed in the literature-review acceptance run: an official Knesset PDF
 * was requested as `https://fs.knesset.gov.il/\7\law\...`. Windows-style
 * backslash separators leak in from document text, PDF link annotations and
 * model-restated paths. RFC 3986 has no backslash in a path, and the fetch
 * layer therefore failed the URL before any network call.
 *
 * This is URL hygiene only — no host allowlist, no rewriting between hosts,
 * no query invention. A URL that is not repairable is returned unchanged so
 * the existing safety gate can refuse it.
 */

export function normalizeMalformedUrl(raw: string | null | undefined): string {
  const input = String(raw ?? "").trim();
  if (!input) return "";
  // Strip wrapping quotes/brackets that survive text extraction.
  let s = input.replace(/^["'<(\[]+/, "").replace(/["'>)\]]+$/, "");
  // Scheme separator typo: "https:/host" or "https:\\host".
  s = s.replace(/^(https?):[\\/]{1,}/i, "$1://");
  const m = s.match(/^(https?:\/\/)([^/\\?#]+)([\s\S]*)$/i);
  if (!m) return s;
  const [, scheme, host, rest] = m;
  // Backslashes are never path separators in an http(s) URL.
  let tail = rest.replace(/\\/g, "/");
  // Collapse duplicated slashes inside the path only (never the scheme).
  const qIndex = tail.search(/[?#]/);
  const path = qIndex >= 0 ? tail.slice(0, qIndex) : tail;
  const query = qIndex >= 0 ? tail.slice(qIndex) : "";
  tail = path.replace(/\/{2,}/g, "/") + query;
  if (tail && !tail.startsWith("/") && !tail.startsWith("?") && !tail.startsWith("#")) {
    tail = `/${tail}`;
  }
  const out = `${scheme.toLowerCase()}${host}${tail}`.replace(/\s+/g, "%20");
  try {
    // Round-trip through URL so an unrepairable string stays unrepaired.
    return new URL(out).toString();
  } catch {
    return out;
  }
}
