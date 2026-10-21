/** Pure acceptance boundary for the existing server extraction envelope. No IO. */
import { buildPastedCitation, citationBindingText } from "../../supabase/functions/_shared/pastedCitation";
import { articleFieldMatches, parseForeignArticleInput } from "../../supabase/functions/_shared/foreignArticle";

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
  /** Transient exact supplied local source fields, separate from provider-added fields. */
  suppliedFields?: Record<string, { value: string; spans: Array<{ start: number; end: number }> }>;
  quarantined: string[];
  identityConfirmed: boolean;
  jurisdiction: "US" | "UK" | "OTHER" | null;
  missing: string[];
  conflicts: string[];
  completeness: "complete" | "partial" | "unconfirmed";
  reason?: "binding" | "jurisdiction" | "malformed" | "unavailable" | "identity" | "chapter_identity" | "ambiguous";
}
/** Older responses need no new version/raw echo, but must carry their existing extraction evidence. */
export function acceptCitationCompletion(request: Record<string, unknown>, raw: string, response: unknown): CompletionAcceptance {
  const r = record(response), identity = record(r.identity), supplied = record(request.parsedFields);
  const out: CompletionAcceptance = { fields: {}, provenance: {}, quarantined: [], identityConfirmed: false, jurisdiction: null, missing: [], conflicts: [], completeness: "unconfirmed" };
  const fail = (reason: CompletionAcceptance["reason"]) => ({ ...out, reason });
  if (typeof request.rawInput !== "string" || citationBindingText(request.rawInput) !== citationBindingText(raw) ||
    (r.rawInput !== undefined && (typeof r.rawInput !== "string" || citationBindingText(r.rawInput) !== citationBindingText(raw)))) return fail("binding");
  if (r.kind !== request.kind || !fieldsByKind[text(request.kind)] ||
    (request.kind === "statute" && r.statuteResponseVersion !== 1)) return fail("malformed");
  if (r.error !== undefined) return fail("unavailable");
  const jur = identity.jurisdiction ?? r.jurisdiction;
  if (request.kind === "case") {
    const evidence = buildPastedCitation(raw).evidence;
    if (evidence.some(e => e.jurisdiction !== jur)) {
      out.conflicts.push("supplied_jurisdiction_conflict");
      return fail("jurisdiction");
    }
  }
  if ((r.jurisdiction !== undefined && identity.jurisdiction !== undefined && r.jurisdiction !== identity.jurisdiction) ||
    (["US", "UK"].includes(text(request.jurisdiction)) && jur !== request.jurisdiction) ||
    (request.kind !== "case" && request.jurisdiction === "OTHER" && r.jurisdiction !== "OTHER")) return fail("binding");
  out.jurisdiction = jur === "US" || jur === "UK" || jur === "OTHER" ? jur : null;
  if (Array.isArray(r.disambiguation) && r.disambiguation.length > 1) return fail("ambiguous");
  const anchors = Array.isArray(identity.anchors) ? identity.anchors.filter((v): v is string => typeof v === "string") : [];
  const sources = Array.isArray(r.sources) ? r.sources.map(record) : [];
  const chapterSourceMatches = (source: Record<string, unknown>) => {
    const evidence = ` ${norm(`${text(source.title)} ${text(source.snippet)}`)} `;
    return [supplied.chapterTitle, supplied.bookTitle].every(v => typeof v === "string" && v.trim().length > 0 && evidence.includes(` ${norm(v)} `));
  };
  if (request.kind === "book_chapter" && (
    !["chapter", "title"].some(prefix => anchors.some(a => norm(a) === norm(`${prefix}:${text(supplied.chapterTitle)}`))) ||
    !anchors.some(a => norm(a) === norm(`title:${text(supplied.bookTitle)}`)) ||
    !sources.some(chapterSourceMatches))) {
    out.conflicts.push("chapter_identity_unconfirmed"); return fail("chapter_identity");
  }
  // Server splitParties excludes supplied court/year parentheticals.
  const name = text(supplied.caseName).split(/[([]/)[0].trim();
  const identifierArticle = request.kind === "journal_article" && (supplied.doi || supplied.sourceUrl) ? parseForeignArticleInput(raw) : null;
  const expected = request.kind === "case" && name ? [`parties:${party(name.split(/\s+v(?:s)?\.?\s+/i)[0])} v ${party(name.split(/\s+v(?:s)?\.?\s+/i)[1] ?? "")}`]
    : ["articleTitle", "chapterTitle", "bookTitle", "statuteName", "doi", "sourceUrl"].filter(k => (identifierArticle ?? supplied)[k]).map(k => `${k === "doi" || k === "sourceUrl" ? k : "title"}:${text((identifierArticle ?? supplied)[k])}`);
  const conflicts = Array.isArray(identity.conflicts) ? identity.conflicts : null;
  // Explicit field conflicts quarantine only that field; identity/record conflicts stop acceptance.
  const fieldConflicts = (conflicts ?? []).filter((v): v is string => typeof v === "string" && /^(conflicting_statute_|(?:year|journal|volume|firstPage):)/.test(v));
  const matchingAnchor = expected.some(a => anchors.some(b => norm(a) === norm(b)));
  const contradictedAnchor = anchors.some(a => {
    const prefix = a.slice(0, a.indexOf(":") + 1);
    const sameKind = expected.filter(e => e.startsWith(prefix));
    return sameKind.length > 0 && !sameKind.some(e => norm(e) === norm(a));
  });
  if (identity.matched !== true || !conflicts || conflicts.length !== fieldConflicts.length || !matchingAnchor || contradictedAnchor ||
    (request.kind === "case" && out.jurisdiction !== "US" && out.jurisdiction !== "UK")) return fail("identity");
  out.identityConfirmed = true;
  const fields = record(r.fields), grounded = record(r.grounded), provenance = record(r.provenance);
  const identityFields = request.kind === "case" ? ["caseName", "docket"] : request.kind === "book_chapter" ? ["chapterTitle", "bookTitle"] : ["articleTitle", "bookTitle", "statuteName", "doi", "sourceUrl"];
  if (identityFields.some(key => (identifierArticle ?? supplied)[key] !== undefined && fields[key] !== undefined && citationBindingText(text((identifierArticle ?? supplied)[key])) !== citationBindingText(text(fields[key])))) {
    out.identityConfirmed = false; return fail("identity");
  }
  for (const [key, value] of Object.entries(fields)) {
    // Compatible full bylines confirm an abbreviated supplied byline, but never replace it.
    if (request.kind === "journal_article" && key === "authors" && typeof value === "string" && typeof supplied[key] === "string" && articleFieldMatches(key, supplied[key], value)) continue;
    const p = record(provenance[key]);
    const source = sources.find(s => s.url === p.sourceUrl);
    const title = text(source?.title), donorTitle = text(p.sourceTitle);
    let urlValid = false;
    try { urlValid = ["https:", "http:"].includes(new URL(text(p.sourceUrl)).protocol); } catch { /* not evidence */ }
    const meaningful = title.trim().length >= 8 && /[A-Za-z]{3}/.test(title) && !/^(home|search|result|untitled|document)\s*$/i.test(title.trim());
    const identityWords = expected.flatMap(a => norm(a.slice(a.indexOf(":") + 1)).split(" ")).filter(w => w.length > 3);
    const confirmedTitle = text(fields.articleTitle);
    const titleRelated = identityWords.some(w => norm(title).includes(w)) ||
      (!!identifierArticle && grounded.articleTitle === true && record(provenance.articleTitle).value === confirmedTitle &&
       record(provenance.articleTitle).sourceUrl === p.sourceUrl && confirmedTitle.length >= 6 && norm(title).includes(norm(confirmedTitle)));
    // The existing structured/document extraction basis is retained when its
    // result heading differs from the cited title; bare discovery titles are not enough.
    const recordEvidence = titleRelated || ["structured_metadata", "document_inspection", "publisher_metadata", "repository_metadata"].includes(text(p.basis));
    if (!fieldsByKind[text(request.kind)].includes(key) || typeof value !== "string" || !value.trim() ||
      fieldConflicts.some(c => c === `conflicting_statute_${key}` || c.startsWith(`${key}:`)) ||
      (supplied[key] !== undefined && citationBindingText(text(supplied[key])) !== citationBindingText(value)) ||
      grounded[key] !== true || p.value !== value || !bases.has(text(p.basis)) || !urlValid || !source || !meaningful || !recordEvidence || norm(title) !== norm(donorTitle) ||
      (request.kind === "book_chapter" && !chapterSourceMatches(source))) {
      out.quarantined.push(key); continue;
    }
    // Supplied values stay exact; confirmation is not permission to rewrite them.
    if (supplied[key] === undefined) { out.fields[key] = value; out.provenance[key] = p; }
  }
  if (request.kind === "case") {
    const evidence = buildPastedCitation([out.fields.court, out.fields.reporter, out.fields.neutral, out.fields.parallel].filter(Boolean).join(" ")).evidence;
    if (evidence.some(e => e.jurisdiction !== jur)) {
      out.fields = {}; out.provenance = {}; out.identityConfirmed = false;
      out.conflicts.push("grounded_jurisdiction_conflict");
      return fail("jurisdiction");
    }
  }
  out.conflicts.push(...fieldConflicts);
  return out;
}