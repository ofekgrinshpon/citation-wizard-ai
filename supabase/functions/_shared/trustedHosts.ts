/**
 * Shared trusted-host lists for Perplexity citation gating.
 *
 * TRUSTED_LEGAL  — high-authority Israeli legal/court/database sources.
 *                  This is the Tier-1 allowlist. Behaviour-equivalent to the
 *                  per-callsite `search_domain_filter` arrays in
 *                  `citation-chat/index.ts`. Do NOT widen this list — Tier-1
 *                  must keep its current source hierarchy.
 *
 * TRUSTED_PUB    — curated academic/policy publishers admitted ONLY by the
 *                  Tier-2 fallback (`citation-chat` open-web retry) after
 *                  Tier-1 returns no usable citations. Validated against the
 *                  perplexity-openweb-experiment results.
 *                  Explicitly excluded for now: Wikipedia, Scribd, mako PDFs,
 *                  a7.org, lawprofsforum, law-firm blogs, podcasts.
 *
 * isTrustedHost(url, set)  — host-or-subdomain match against the chosen set
 *                  (default = LEGAL ∪ PUB).
 */

export const TRUSTED_LEGAL: readonly string[] = [
  "nevo.co.il",
  "court.gov.il",
  "supreme.court.gov.il",
  "supremedecisions.court.gov.il",
  "takdin.co.il",
  "lite.takdin.co.il",
  "psakdin.co.il",
  "din.org.il",
  "knesset.gov.il",
  "reshumot.gov.il",
  "gov.il",
];

export const TRUSTED_PUB: readonly string[] = [
  // Law-faculty journals
  "taulawreview.sites.tau.ac.il",
  "lawjournal.huji.ac.il",
  "law.haifa.ac.il",
  "law.tau.ac.il",
  "law.huji.ac.il",
  "law.biu.ac.il",
  "law.idc.ac.il",
  "law.colman.ac.il",
  // Faculty / institutional hosts
  "tau.ac.il",
  "huji.ac.il",
  "biu.ac.il",
  "haifa.ac.il",
  "openu.ac.il",
  "idc.ac.il",
  "colman.ac.il",
  "mishpat.ac.il",
  // Policy / library
  "idi.org.il",
  "nli.org.il",
  "main.knesset.gov.il",
  "fs.knesset.gov.il",
  // Academic working-paper archive
  "papers.ssrn.com",
  "ssrn.com",
];

/**
 * Pre-electronic-era Supreme Court mirrors (cases filed before ~1995).
 * Used ONLY by the old-docket retry path, never by the default Tier-1/Tier-2
 * gate, and acceptance still requires that the docket appears literally in
 * the URL, title, or snippet. Keeps modern-case protection unchanged.
 */
export const TRUSTED_OLD_SUPREME_MIRRORS: readonly string[] = [
  "versa.cardozo.yu.edu",
  "he.wikipedia.org",
  "padi.gov.il",
];

export function hostOf(url: unknown): string | null {
  if (typeof url !== "string" || !url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isTrustedHost(
  url: unknown,
  set: readonly string[] = [...TRUSTED_LEGAL, ...TRUSTED_PUB],
): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return set.some((d) => host === d || host.endsWith("." + d));
}

export function countTrustedCitations(
  citations: unknown,
  set: readonly string[] = [...TRUSTED_LEGAL, ...TRUSTED_PUB],
): number {
  if (!Array.isArray(citations)) return 0;
  let n = 0;
  for (const u of citations) if (isTrustedHost(u, set)) n++;
  return n;
}

export function untrustedHosts(
  citations: unknown,
  set: readonly string[] = [...TRUSTED_LEGAL, ...TRUSTED_PUB],
): string[] {
  if (!Array.isArray(citations)) return [];
  const out: string[] = [];
  for (const u of citations) {
    const h = hostOf(u);
    if (h && !set.some((d) => h === d || h.endsWith("." + d))) out.push(h);
  }
  return out;
}

/**
 * Shared docket identity. Two-part dockets ("4769/24") carry {num, year};
 * three-part lower-court dockets ("1477-12-22") additionally carry `month`
 * and their identity is ALL three segments — never collapsed to num/month.
 * Backward compatible: existing callers reading {full, num, year} still work.
 */
export interface DocketId {
  full: string;
  num: string;
  year: string;
  /** Present only for three-part dockets; canonical two-digit "01".."12". */
  month?: string;
}

const SEP_SRC = "\\s*[\\/\\-\\u2013_]\\s*";

/**
 * Parse a bare docket number (no prefix). Accepts "/", "-", en-dash, "_"
 * separators with optional whitespace. Three-part: month 1–12 (leading zero
 * optional, normalized to two digits), year exactly 2 or 4 digits. Anything
 * malformed returns null — no partial two-part fallback for a three-part input.
 */
export function parseDocketNumber(s: unknown): DocketId | null {
  if (typeof s !== "string") return null;
  const t = s.normalize("NFKC").trim();
  const m3 = t.match(new RegExp(`^(\\d{1,6})${SEP_SRC}(\\d{1,2})${SEP_SRC}(\\d+)$`));
  if (m3) return buildThreePart(m3[1], m3[2], m3[3]);
  const m2 = t.match(new RegExp(`^(\\d{1,6})${SEP_SRC}(\\d{2,4})$`));
  if (m2) return { full: `${m2[1]}/${m2[2]}`, num: m2[1], year: m2[2] };
  return null;
}

function buildThreePart(num: string, month: string, year: string): DocketId | null {
  const mo = parseInt(month, 10);
  if (!/^\d{1,2}$/.test(month) || mo < 1 || mo > 12) return null;
  if (!/^(?:\d{2}|\d{4})$/.test(year)) return null;
  const mm = String(mo).padStart(2, "0");
  return { full: `${num}-${mm}-${year}`, num, year, month: mm };
}

const DOCKET_RE_SHARED = new RegExp(
  `([א-ת]{1,4}(?:["״׳']?[א-ת]?)?)\\s*(\\d{1,6})${SEP_SRC}(\\d+)(?:${SEP_SRC}(\\d+))?(?!\\d)(${SEP_SRC}\\d)?`,
);

export function extractDocket(s: unknown): DocketId | null {
  if (typeof s !== "string" || !s) return null;
  const m = s.normalize("NFKC").match(DOCKET_RE_SHARED);
  if (!m) return null;
  if (m[5]) return null; // four+ segments → malformed
  if (m[4] !== undefined) return buildThreePart(m[2], m[3], m[4]);
  if (!/^\d{2,4}$/.test(m[3])) return null;
  return { full: `${m[2]}/${m[3]}`, num: m[2], year: m[3] };
}

/** True for a three-part (lower-court) docket identity. */
export function isThreePartDocket(d: { month?: string } | null | undefined): boolean {
  return !!d && typeof d.month === "string" && d.month.length > 0;
}

/** Human/log label: "1477-12-22" or "4769/24". */
export function docketLabel(d: { num: string; year: string; month?: string }): string {
  return d.month ? `${d.num}-${d.month}-${d.year}` : `${d.num}/${d.year}`;
}

function escRe(x: string): string {
  return x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Regex SOURCE matching the docket as a complete numeric token. Two-part
 * never matches the first two segments of a three-part number; three-part
 * requires all three segments in order. Leading zeros on num/month tolerated.
 */
export function docketPatternSource(
  d: { num: string; year: string; month?: string },
  opts: { yearAliases?: boolean } = {},
): string {
  const num = `0*${escRe(d.num.replace(/^0+(?=\d)/, ""))}`;
  const yf = opts.yearAliases ? yearForms(d.year) : null;
  const years = yf ? Array.from(new Set([d.year, yf.yy, yf.yyyy])) : [d.year];
  const yAlt = `(?:${years.map(escRe).join("|")})`;
  if (d.month) {
    const mo = `0?${parseInt(d.month, 10)}`;
    return `(?<!\\d)(?<!\\d[\\-\\u2013_]\\s*)${num}${SEP_SRC}${mo}${SEP_SRC}${yAlt}(?!\\d)(?!${SEP_SRC}\\d)`;
  }
  return `(?<!\\d)${num}${SEP_SRC}${yAlt}(?!\\d)(?!${SEP_SRC}\\d)`;
}

/**
 * Telemetry channel for which encoding satisfied the docket-anchor gate.
 *  - plain                     → NUM/YY (or -, _, %2F variants), any host
 *  - supreme_hebrew_verdicts   → /HebrewVerdicts/YY/<sec>/<first>/… path
 *                                (supreme.court.gov.il + supremedecisions)
 *  - supreme_net_verdicts      → /YYYY-X-NUM-… NetVerdicts path
 *  - supreme_filename          → YY{first}{second}.<ext> filename token
 *  - none                      → no match
 */
export type DocketAnchorVia =
  | "plain"
  | "supreme_hebrew_verdicts"
  | "supreme_net_verdicts"
  | "supreme_filename"
  | "none";

const SUPREME_HOSTS = ["supreme.court.gov.il", "supremedecisions.court.gov.il"];

function isSupremeHost(host: string | null): boolean {
  if (!host) return false;
  return SUPREME_HOSTS.some((d) => host === d || host.endsWith("." + d));
}

/**
 * Encode docket NUM into Supreme Court's internal 6-digit form.
 * Rule (verified against 13 real (docket,URL) pairs in reports/):
 *   D6 = leftpad(NUM, 5, '0') + '0'
 *   firstHalf  = D6.slice(0,3)   secondHalf = D6.slice(3,6)
 * E.g. 8987 → "089870" → first="089" sec="870"; 4769 → "047690" → "047"/"690".
 * NUM up to 5 digits supported (observed up to 18615).
 */
function supremeEncodeNum(numStr: string): { first: string; second: string } | null {
  if (!/^\d{1,5}$/.test(numStr)) return null;
  const d6 = numStr.padStart(5, "0") + "0";
  return { first: d6.slice(0, 3), second: d6.slice(3, 6) };
}

/** Normalize an arbitrary year string to {yy, yyyy} candidates. */
function yearForms(yearStr: string): { yy: string; yyyy: string } | null {
  if (!/^\d{2,4}$/.test(yearStr)) return null;
  if (yearStr.length === 4) return { yy: yearStr.slice(2), yyyy: yearStr };
  if (yearStr.length === 2) {
    const n = parseInt(yearStr, 10);
    // Supreme e-filing started ~1990s. Treat <70 as 20YY, else 19YY.
    const yyyy = (n < 70 ? 2000 + n : 1900 + n).toString();
    return { yy: yearStr, yyyy };
  }
  const yyyy = yearStr.padStart(4, "0");
  return { yy: yyyy.slice(2), yyyy };
}

/**
 * Returns the channel by which `url` references `docket`, or "none".
 * Plain channel works on any host. Supreme encodings are gated to
 * supreme.court.gov.il / supremedecisions.court.gov.il to avoid
 * false positives elsewhere.
 */
export function urlContainsDocketVia(
  url: unknown,
  docket: { num: string; year: string; month?: string },
): { ok: boolean; via: DocketAnchorVia } {
  if (typeof url !== "string" || !url) return { ok: false, via: "none" };
  let host: string | null = null;
  try { host = new URL(url).hostname.toLowerCase(); } catch { host = null; }

  let decoded = url;
  try { decoded = decodeURIComponent(url); } catch { /* keep raw */ }
  const u = decoded.toLowerCase();
  const { num, year } = docket;
  // Explicit percent-encoded separators (covers malformed-% URLs where
  // decodeURIComponent threw and we kept the raw string).
  const uNorm = u.replace(/%2f/g, "/").replace(/%2d/g, "-").replace(/%5f/g, "_").replace(/%20/g, " ");

  // Channel 1: plain NUM/YY (after URL-decode, %2F became /).
  if (new RegExp(docketPatternSource(docket), "i").test(uNorm)) return { ok: true, via: "plain" };

  // Supreme-only channels below — genuine two-part dockets only.
  if (isThreePartDocket(docket)) return { ok: false, via: "none" };
  if (!isSupremeHost(host)) return { ok: false, via: "none" };

  const enc = supremeEncodeNum(num);
  const yf = yearForms(year);
  if (!enc || !yf) return { ok: false, via: "none" };

  const { first, second } = enc;
  const { yy, yyyy } = yf;

  // Channel 2: HebrewVerdicts path. Separators may be `/` or `\` after decode.
  const hvRe = new RegExp(
    `hebrewverdicts[\\/\\\\]${yy}[\\/\\\\]${second}[\\/\\\\]${first}[\\/\\\\]`,
    "i",
  );
  if (hvRe.test(u)) return { ok: true, via: "supreme_hebrew_verdicts" };

  // Channel 3: filename YY{first}{second} (8 digits) followed by . or _.
  const fn = `${yy}${first}${second}`;
  const fnRe = new RegExp(`(?:^|[^0-9])${fn}(?=[._])`, "i");
  if (fnRe.test(u)) return { ok: true, via: "supreme_filename" };

  // Channel 4: NetVerdicts. Pattern: /YYYY-<digits>-NUM-<digits>-
  const numEsc = num.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nvRe = new RegExp(
    `netverdicts[\\/\\\\][^?]*[\\/\\\\-]${yyyy}-\\d+-${numEsc}-`,
    "i",
  );
  if (nvRe.test(u)) return { ok: true, via: "supreme_net_verdicts" };

  return { ok: false, via: "none" };
}

/** Backward-compatible boolean wrapper. */
export function urlContainsDocket(
  url: unknown,
  docket: { num: string; year: string; month?: string },
): boolean {
  return urlContainsDocketVia(url, docket).ok;
}

/**
 * Snippet/title anchor — accepts the literal docket `NUM/YY`, `NUM-YY`, or
 * `NUM_YY` anywhere in the text (after Unicode normalization). Use this only
 * for results already known to be on a trusted host (callers must gate),
 * since plain text matches on untrusted sources are easy to fake.
 *
 * Also recognizes a 4-digit year form (`NUM/YYYY`) so old Supreme Court
 * docs that spell out the year in prose still anchor.
 */
export function textContainsDocket(
  text: unknown,
  docket: { num: string; year: string; month?: string },
): boolean {
  if (typeof text !== "string" || !text) return false;
  const t = text.normalize("NFKC");
  return new RegExp(docketPatternSource(docket, { yearAliases: true })).test(t);
}

/** First non-"none" via among the urls, else "none". */
export function anyUrlContainsDocketVia(
  urls: unknown,
  docket: { num: string; year: string; month?: string },
): DocketAnchorVia {
  if (!Array.isArray(urls)) return "none";
  for (const u of urls) {
    const r = urlContainsDocketVia(u, docket);
    if (r.ok) return r.via;
  }
  return "none";
}

export function anyUrlContainsDocket(
  urls: unknown,
  docket: { num: string; year: string; month?: string },
): boolean {
  return anyUrlContainsDocketVia(urls, docket) !== "none";
}
