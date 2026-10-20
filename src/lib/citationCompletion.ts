/** Pure acceptance boundary for the existing server extraction envelope. No IO. */
import { citationBindingText } from "../../supabase/functions/_shared/pastedCitation";
import { articleFieldMatches } from "../../supabase/functions/_shared/foreignArticle";

const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown): string => typeof v === "string" ? v : "";
const norm = (v: string) => v.toLowerCase().replace(/[.,'"’‘:;()\[\]]/g, " ").replace(/\s+/g, " ").trim();
const party = (v: string) => norm(v).replace(/\b(inc|llc|llp|plc|ltd|corp|corporation|co|company|the|of|and)\b/g, " ").replace(/\s+/g, " ").trim();
const fieldsByKind: Record<string, string[]> = {
  case: ["caseName", "court", "reporter", "ukSeries", "ukVolume", "volume", "reporterVolume", "firstPage", "year", "docket", "neutral", "decisionDate", "parallel", "pinpoint", "paragraph"],
  statute: ["statuteName", "titleNumber", "code", "section", "sections", "year", "chapter"],
  journal_article: ["authors", "articleTitle", "journal", "volume", "firstPage", "year", "doi", "sourceUrl"],
  book: ["authors", "bookTitle", "year", "edition", "volume", "editors", "translators"],
  book_chapter: ["authors", "chapterTitle", "bookTitle", "year", "edition", "firstPage", "editors", "translators"],
};
const bases = new Set(["official_record", "structured_metadata", "publisher_metadata", "repository_metadata", "search_result_explicit", "document_inspection"]);
export interface CompletionAcceptance {
  fields: Record<string, string>;
  provenance: Record<string, unknown>;
  quarantined: string[];
  identityConfirmed: boolean;
  jurisdiction: "US" | "UK" | "OTHER" | null;
  reason?: "binding" | "malformed" | "unavailable" | "identity" | "ambiguous";
}
/** Older responses need no new version/raw echo, but must carry their existing extraction evidence. */
export function acceptCitationCompletion(request: Record<string, unknown>, raw: string, response: unknown): CompletionAcceptance {
  const r = record(response), identity = record(r.identity), supplied = record(request.parsedFields);
  const out: CompletionAcceptance = { fields: {}, provenance: {}, quarantined: [], identityConfirmed: false, jurisdiction: null };
  const fail = (reason: CompletionAcceptance["reason"]) => ({ ...out, reason });
  if (typeof request.rawInput !== "string" || citationBindingText(request.rawInput) !== citationBindingText(raw) ||
    (r.rawInput !== undefined && (typeof r.rawInput !== "string" || citationBindingText(r.rawInput) !== citationBindingText(raw)))) return fail("binding");
  if (r.kind !== request.kind || !fieldsByKind[text(request.kind)] ||
    (request.kind === "statute" && r.statuteResponseVersion !== 1)) return fail("malformed");
  if (r.error !== undefined) return fail("unavailable");
  const jur = identity.jurisdiction ?? r.jurisdiction;
  if ((r.jurisdiction !== undefined && identity.jurisdiction !== undefined && r.jurisdiction !== identity.jurisdiction) ||
    (["US", "UK"].includes(text(request.jurisdiction)) && jur !== request.jurisdiction) ||
    (request.kind !== "case" && request.jurisdiction === "OTHER" && r.jurisdiction !== "OTHER")) return fail("binding");
  out.jurisdiction = jur === "US" || jur === "UK" || jur === "OTHER" ? jur : null;
  if (Array.isArray(r.disambiguation) && r.disambiguation.length > 1) return fail("ambiguous");
  const anchors = Array.isArray(identity.anchors) ? identity.anchors.filter((v): v is string => typeof v === "string") : [];
  // Server splitParties excludes supplied court/year parentheticals.
  const name = text(supplied.caseName).split(/[([]/)[0].trim();
  const expected = request.kind === "case" && name ? [`parties:${party(name.split(/\s+v(?:s)?\.?\s+/i)[0])} v ${party(name.split(/\s+v(?:s)?\.?\s+/i)[1] ?? "")}`]
    : ["articleTitle", "chapterTitle", "bookTitle", "statuteName", "doi", "sourceUrl"].filter(k => supplied[k]).map(k => `${k === "doi" || k === "sourceUrl" ? k : "title"}:${text(supplied[k])}`);
  const conflicts = Array.isArray(identity.conflicts) ? identity.conflicts : null;
  // Explicit field conflicts quarantine only that field; identity/record conflicts stop acceptance.
  const fieldConflicts = (conflicts ?? []).filter((v): v is string => typeof v === "string" && /^(conflicting_statute_|(?:year|journal|volume|firstPage):)/.test(v));
  if (identity.matched !== true || !conflicts || conflicts.length !== fieldConflicts.length || !expected.some(a => anchors.some(b => norm(a) === norm(b))) ||
    (request.kind === "case" && out.jurisdiction !== "US" && out.jurisdiction !== "UK")) return fail("identity");
  out.identityConfirmed = true;
  const fields = record(r.fields), grounded = record(r.grounded), provenance = record(r.provenance);
  const identityFields = request.kind === "case" ? ["caseName", "docket"] : request.kind === "book_chapter" ? ["chapterTitle", "bookTitle"] : ["articleTitle", "bookTitle", "statuteName", "doi", "sourceUrl"];
  if (identityFields.some(key => supplied[key] !== undefined && fields[key] !== undefined && citationBindingText(text(supplied[key])) !== citationBindingText(text(fields[key])))) {
    out.identityConfirmed = false; return fail("identity");
  }
  const sources = Array.isArray(r.sources) ? r.sources.map(record) : [];
  for (const [key, value] of Object.entries(fields)) {
    // Compatible full bylines confirm an abbreviated supplied byline, but never replace it.
    if (request.kind === "journal_article" && key === "authors" && typeof value === "string" && typeof supplied[key] === "string" && articleFieldMatches(key, supplied[key], value)) continue;
    const p = record(provenance[key]);
    const source = sources.find(s => s.url === p.sourceUrl);
    const title = text(source?.title), donorTitle = text(p.sourceTitle);
    let urlValid = false;
    try { urlValid = ["https:", "http:"].includes(new URL(text(p.sourceUrl)).protocol); } catch { /* not evidence */ }
    const meaningful = title.trim().length >= 8 && /[A-Za-z]{3}/.test(title) && !/^(home|search|result|untitled|document)\s*$/i.test(title.trim());
    if (!fieldsByKind[text(request.kind)].includes(key) || typeof value !== "string" || !value.trim() ||
      fieldConflicts.some(c => c === `conflicting_statute_${key}` || c.startsWith(`${key}:`)) ||
      (supplied[key] !== undefined && citationBindingText(text(supplied[key])) !== citationBindingText(value)) ||
      grounded[key] !== true || p.value !== value || !bases.has(text(p.basis)) || !urlValid || !source || !meaningful || norm(title) !== norm(donorTitle)) {
      out.quarantined.push(key); continue;
    }
    // Supplied values stay exact; confirmation is not permission to rewrite them.
    if (supplied[key] === undefined) { out.fields[key] = value; out.provenance[key] = p; }
  }
  return out;
}