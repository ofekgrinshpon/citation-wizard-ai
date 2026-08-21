// docket_aware_url_dedup_v1
//
// Israeli court/government document endpoints carry the document identity in
// the query string (e.g. supremedecisions.court.gov.il/Home/Download
// ?fileName=03086380_A11.txt&path=HebrewVerdicts/03/380/086/A11&type=2).
// A host+pathname dedupe key collapses every judgment served by such an
// endpoint into one key, so distinct judgments are dropped as `dup_url`.
//
// This module produces a dedupe key that preserves identity-bearing query
// params for *recognised* document endpoints only. Ordinary pages (SEO,
// law-firm, news, blogs, generic PDFs) keep the previous host+path behaviour.
//
// Pure module: no network, no model calls.

export type DedupeIdentitySource = "query_param" | "title_docket" | "normal_url";

export interface UrlDedupeKey {
  /** Final dedupe key (without the `url:` prefix). Empty when no URL. */
  key: string;
  /** Legacy host+path key, for telemetry / comparison. */
  normalized_url_old: string;
  identity_source: DedupeIdentitySource;
  /** Identity params actually folded into the key (lower-cased names). */
  identity_params_used: string[];
  /** Docket appended as fallback, when used. */
  title_docket?: string;
}

/**
 * Hosts whose document endpoints carry identity in the query string.
 * Matched on hostname suffix; optional `paths` narrows to the endpoints we
 * actually recognise (matched as a case-insensitive pathname prefix).
 */
const IDENTITY_ENDPOINTS: Array<{ host: string; paths?: string[] }> = [
  // Supreme Court decision archive (the primary offender).
  { host: "supremedecisions.court.gov.il", paths: ["/home/download", "/home/doc", "/verdict/download"] },
  { host: "elyon1.court.gov.il", paths: ["/files"] },
  { host: "elyon2.court.gov.il", paths: ["/files"] },
  // Courts administration / net-hamishpat document services.
  { host: "www.court.gov.il", paths: ["/ngcs.web.site", "/download", "/filesnet"] },
  { host: "court.gov.il", paths: ["/ngcs.web.site", "/download", "/filesnet"] },
  // Government publication collectors (docs differ only by query id).
  { host: "gov.il", paths: ["/he/departments/dynamiccollectors", "/he/service", "/blobfolder"] },
  { host: "www.gov.il", paths: ["/he/departments/dynamiccollectors", "/he/service", "/blobfolder"] },
  // Knesset legislative document services.
  { host: "main.knesset.gov.il", paths: ["/activity", "/en/activity"] },
  { host: "fs.knesset.gov.il" },
  // Nevo / legal DB document endpoints keyed by id.
  { host: "www.nevo.co.il", paths: ["/psakdin/fullview", "/law_html", "/psakdin"] },
];

/** Query params that carry document identity on those endpoints. */
const IDENTITY_PARAMS = [
  "filename",
  "path",
  "id",
  "docid",
  "documentid",
  "doc_id",
  "documentnumber",
  "caseid",
  "case_id",
  "itemid",
  "skn",
  "entityid",
  "fileid",
  "file",
  "verdictid",
  "lawitemid",
  "lawnumber",
];

/** Generic download-ish endpoints where the path alone is not an identity. */
const GENERIC_DOWNLOAD_PATH_RE =
  /(^|\/)(download|home\/download|blobfolder|getfile|fileupload|dynamiccollectors|viewdoc|doc|files?)(\/|$)/i;

// Docket regex reused for the title fallback (broader than the pool's,
// covers unquoted forms).
const TITLE_DOCKET_RE =
  /(בג"?״?ץ|דנג"?״?ץ|ע"?״?א|ע"?״?פ|רע"?״?א|רע"?״?פ|עע"?״?מ|עה"?״?ס|דנ"?״?א|דנ"?״?פ|בש"?״?פ|בש"?״?א|תמ"?״?ש|רמ"?״?ש|בר"?״?ם|בר"?״?ע|ת"?״?א|ת"?״?פ|HCJ|CA|CrimA|LCA|LCrimA)\s*(\d{1,6})[-\/](\d{2,4})/i;

export function detectTitleDocket(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(TITLE_DOCKET_RE);
  if (!m) return null;
  const prefix = m[1].replace(/["״]/g, "").toLowerCase();
  return `${prefix}:${Number(m[2])}/${m[3].slice(-2)}`;
}

function isIdentityEndpoint(host: string, pathname: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  const p = pathname.toLowerCase();
  for (const e of IDENTITY_ENDPOINTS) {
    const eh = e.host.toLowerCase().replace(/^www\./, "");
    if (h !== eh && !h.endsWith(`.${eh}`)) continue;
    if (!e.paths || e.paths.length === 0) return true;
    if (e.paths.some((pp) => p.startsWith(pp.toLowerCase()))) return true;
  }
  return false;
}

function legacyKey(u: URL): string {
  return (u.hostname + u.pathname).replace(/\/+$/, "").toLowerCase();
}

/**
 * Build a dedupe key for a candidate URL, docket-aware for recognised
 * Israeli court/government document endpoints.
 */
export function buildUrlDedupeKey(
  rawUrl: string | null | undefined,
  title?: string | null,
): UrlDedupeKey {
  if (!rawUrl) {
    return { key: "", normalized_url_old: "", identity_source: "normal_url", identity_params_used: [] };
  }
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    const flat = String(rawUrl).toLowerCase().trim();
    return { key: flat, normalized_url_old: flat, identity_source: "normal_url", identity_params_used: [] };
  }

  const base = legacyKey(u);
  const recognised = isIdentityEndpoint(u.hostname, u.pathname);

  if (recognised) {
    const used: Array<[string, string]> = [];
    for (const [name, value] of u.searchParams.entries()) {
      const n = name.toLowerCase();
      if (!IDENTITY_PARAMS.includes(n)) continue;
      const v = (value || "").trim().toLowerCase();
      if (!v) continue;
      used.push([n, v]);
    }
    if (used.length > 0) {
      used.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      return {
        key: `${base}?${used.map(([n, v]) => `${n}=${v}`).join("&")}`,
        normalized_url_old: base,
        identity_source: "query_param",
        identity_params_used: used.map(([n]) => n),
      };
    }
    // No identity params: fall back to the docket in the title when the path
    // itself is a generic download endpoint.
    if (GENERIC_DOWNLOAD_PATH_RE.test(u.pathname)) {
      const dk = detectTitleDocket(title);
      if (dk) {
        return {
          key: `${base}#${dk}`,
          normalized_url_old: base,
          identity_source: "title_docket",
          identity_params_used: [],
          title_docket: dk,
        };
      }
    }
  }

  return { key: base, normalized_url_old: base, identity_source: "normal_url", identity_params_used: [] };
}
