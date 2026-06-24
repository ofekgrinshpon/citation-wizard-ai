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
 * Shared docket parser/matcher. Accepts dockets like "4769/24", "4769-24",
 * with ASCII or Hebrew quotes between case-type letters. Returns the bare
 * {num, year} pair (the two segments URL fragments typically use).
 */
const DOCKET_RE_SHARED =
  /([א-ת]{1,4}(?:["״׳']?[א-ת]?)?)\s*(\d{1,6})\s*[\/\-\u2013]\s*(\d{2,4})/;

export function extractDocket(
  s: unknown,
): { full: string; num: string; year: string } | null {
  if (typeof s !== "string" || !s) return null;
  const m = s.match(DOCKET_RE_SHARED);
  if (!m) return null;
  return { full: `${m[2]}/${m[3]}`, num: m[2], year: m[3] };
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
  docket: { num: string; year: string },
): { ok: boolean; via: DocketAnchorVia } {
  if (typeof url !== "string" || !url) return { ok: false, via: "none" };
  let host: string | null = null;
  try { host = new URL(url).hostname.toLowerCase(); } catch { host = null; }

  let decoded = url;
  try { decoded = decodeURIComponent(url); } catch { /* keep raw */ }
  const u = decoded.toLowerCase();
  const { num, year } = docket;

  // Channel 1: plain NUM/YY (after URL-decode, %2F became /).
  const plainPatterns = [`${num}/${year}`, `${num}-${year}`, `${num}_${year}`];
  if (plainPatterns.some((p) => u.includes(p))) return { ok: true, via: "plain" };

  // Supreme-only channels below.
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
  docket: { num: string; year: string },
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
  docket: { num: string; year: string },
): boolean {
  if (typeof text !== "string" || !text) return false;
  const t = text.normalize("NFKC");
  const { num, year } = docket;
  const yf = yearForms(year);
  const years = yf ? Array.from(new Set([year, yf.yy, yf.yyyy])) : [year];
  for (const y of years) {
    if (!y) continue;
    if (
      t.includes(`${num}/${y}`) ||
      t.includes(`${num}-${y}`) ||
      t.includes(`${num}_${y}`)
    ) {
      return true;
    }
  }
  return false;
}

/** First non-"none" via among the urls, else "none". */
export function anyUrlContainsDocketVia(
  urls: unknown,
  docket: { num: string; year: string },
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
  docket: { num: string; year: string },
): boolean {
  return anyUrlContainsDocketVia(urls, docket) !== "none";
}
