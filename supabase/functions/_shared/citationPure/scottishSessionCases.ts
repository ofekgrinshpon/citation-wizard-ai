import { SCOTTISH_ID } from "./scottishDecision.ts";

export function sessionCasesRequested(raw: string): string | null {
  const match = /^(\[20\d{2}\][ \t]+(?:CSIH|CSOH)[ \t]+[1-9]\d{0,3}),[ \t]+Session Cases\.?$/i.exec(raw.trim());
  return match && sessionCasesSearchUrl(match[1]) ? match[1] : null;
}
export function sessionCasesRecordUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    return u.origin === ORIGIN && !u.username && !u.password && !u.search && !u.hash && /^\/report\/[1-9]\d{0,7}\/$/.test(u.pathname) ? u : null;
  } catch { return null; }
}
const ORIGIN = "https://sclr-index.scottishlawreports.org.uk";
export const SCLR_HTML_LIMIT = 240_000;
export function sessionCasesSearchUrl(id: string): URL | null {
  const m = SCOTTISH_ID.exec(id.trim());
  if (!m || Number(m[1]) < 2005) return null;
  const url = new URL("/", ORIGIN);
  url.searchParams.set("ncit", `[${m[1]}] ${m[2]} ${m[3]}`);
  return url;
}
const plain = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi," ").replace(/\s+/g," ").trim();
export type SessionCasesResult =
  | { state: "matched"; neutral: string; caption: string; reportYear: string; reporter: "SC"; firstPage: string; url: string }
  | { state: "no_exact_match" | "unverified" };
/** Publisher search is substring-based. All publication fields must come from the
 * one exact decision row in a complete results table, never adjacent records. */
export function readSessionCasesIndex(html: string, id: string): SessionCasesResult {
  const search = sessionCasesSearchUrl(id);
  if (!search || html.length > SCLR_HTML_LIMIT) return { state: "unverified" };
  const neutral = search.searchParams.get("ncit")!;
  if (!/<h2\b[^>]*>\s*Search Results\s*<\/h2>/i.test(html)) return { state: "unverified" };
  const table = /<table\b[^>]*>([\s\S]*?)<\/table>/i.exec(html)?.[1] ?? "";
  const header = /<thead\b[^>]*>([\s\S]*?)<\/thead>/i.exec(table)?.[1] ?? "";
  const names = [...header.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(c => plain(c[1]));
  const expected = ["Case Name", "Publication Ref", "Citation", "Court", "Date of Judgment"];
  if (names.length !== expected.length || names.some((n,i) => n !== expected[i])) return { state: "unverified" };
  const body = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i.exec(table)?.[1];
  if (!body) return { state: "unverified" };
  const total = Number(/<p\b[^>]*>\s*Total Reports:\s*(\d+)\s*<\/p>/i.exec(html)?.[1]);
  if (!Number.isSafeInteger(total) || total > 100) return { state: "unverified" };
  if (total === 0) return { state: plain(body) === "No reports found matching your criteria" ? "no_exact_match" : "unverified" };
  const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row =>
    [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => cell[1]));
  if (rows.length !== total || rows.some(cells=>cells.length !== 5)) return { state: "unverified" };
  const exact = rows.filter(cells => plain(cells[2]) === neutral);
  if (!exact.length) return { state: "no_exact_match" };
  if (exact.length !== 1) return { state: "unverified" };
  const [name, publication, , court, decision] = exact[0];
  const reportId = /<a\b[^>]*\bhref="(\/report\/[1-9]\d{0,7}\/)"/i.exec(name)?.[1];
  const ref = /^(20\d{2}) SC ([1-9]\d{0,5})$/.exec(plain(publication));
  const year = Number(neutral.slice(1,5));
  const decisionDate = /^\d{1,2} [A-Z][a-z]{2} (\d{4})$/.exec(plain(decision));
  const caption = plain(name).replace(/&amp;/g,"&").replace(/&#39;|&apos;/g,"'");
  if (!reportId || !ref || caption.length > 500 || !/^.+ v .+$/.test(caption) ||
      /&(?:#\w+|[a-z]+);/i.test(caption) || plain(court) !== "Ct of Sess" ||
      !decisionDate || Number(decisionDate[1]) !== year || Number(ref[1]) < year) return { state: "unverified" };
  return { state: "matched", neutral, caption, reportYear: ref[1], reporter: "SC", firstPage: ref[2], url: new URL(reportId, ORIGIN).href };
}
