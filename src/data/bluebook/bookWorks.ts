/**
 * Stage 5 batch 4 — books (general Bluebook 21 R15.1–15.4(a)) and chapters in
 * collections by various authors (R15.5.1(a)); Israeli 36.6 / 36.8 corroborate.
 *
 * Bounded grammars (verbatim supplied text; no dictionaries, no lookups):
 *   Labelled:  Key: value; Key: value; …   (≥ 2 segments, first key known)
 *   Book:      [Vol ]Heading[, at Pin | § N | ¶ N] (Paren)[tail]
 *   Chapter:   Author, Title, in [Vol ]Collection[ First][, Pin | , at Pin] (Paren)[tail]
 *   Paren:     [Ed ed[s]., ][Tr trans., ][Nd ed. ]YYYY
 *
 * The author/title boundary is never inferred from name shape. A free-text
 * book heading is kept whole (author and title share small caps, so the
 * output is identical); a chapter needs exactly one comma before ", in"
 * (R15.5.1(a) components carry an author), otherwise the input is preserved.
 * A bare trailing page after a title ending in a numeral, or a bare roman
 * numeral, is ambiguous (title vs pinpoint) and needs ", at".
 * Supplied publishers render only with an explicit non-original status;
 * free-text publishers, unknown status and pre-1900 editions are preserved.
 */
import type { ForeignBookFields, ForeignChapterFields } from "./types";

export type BookWorkKind = "book" | "chapter";
export interface BookWorkParse {
  kind: BookWorkKind;
  fields: ForeignBookFields & ForeignChapterFields;
  /** Set when the input must be preserved unformatted, with this reason code. */
  preserve?: "ambiguous_pinpoint" | "ambiguous_author" | "publisher_unknown" | "pre1900";
  /** Explicit book/chapter structure (labels, contributors, edition, ", in", ", at", §/¶). */
  signal: boolean;
}

const ROMAN = String.raw`[ivxlcdm]{1,8}`;
const PINTOK = String.raw`(?:\d{1,5}|${ROMAN})(?:\s*[–\-]\s*(?:\d{1,5}|${ROMAN}))?(?:\s+n\.\s*\d+)?`;
const PIN = String.raw`${PINTOK}(?:,\s*${PINTOK})*`;
const SECT = String.raw`(?:§§?|¶¶?)\s*[\w.]+(?:\s*[–\-]\s*[\w.]+)?`;
const EDITION = String.raw`\d+(?:st|nd|d|rd|th)`;
const normPin = (s: string) => s.replace(/\s*[–\-]\s*/g, "–").replace(/\s*,\s*/g, ", ").trim();

interface Paren { editors?: string; translators?: string; edition?: string; year: string; publisher?: string; contributors: boolean }
function parseParen(inner: string): Paren | null {
  const comps = inner.trim().split(/,\s+/);
  const last = comps.pop()!.match(new RegExp(String.raw`^(?:(.+?)\s+)??(?:(${EDITION})\s+ed\.\s+)?((?:1[5-9]|20)\d{2})$`));
  if (!last) return null;
  const out: Paren = { year: last[3], contributors: false };
  if (last[1]) out.publisher = last[1];
  if (last[2]) out.edition = last[2];
  for (const c of comps) {
    const ed = c.match(/^(.+?)\s+eds?\.$/);
    const tr = c.match(/^(.+?)\s+trans\.$/);
    if (ed && !out.editors && !/\d/.test(ed[1])) out.editors = ed[1];
    else if (tr && !out.translators && !/\d/.test(tr[1])) out.translators = tr[1];
    else return null;
    out.contributors = true;
  }
  return out;
}

const LABELS: Record<string, string> = {
  author: "authors", authors: "authors", editor: "editors", editors: "editors",
  translator: "translators", translators: "translators", title: "bookTitle", book: "bookTitle",
  in: "bookTitle", collection: "bookTitle", chapter: "chapterTitle", volume: "volume",
  edition: "edition", year: "year", publisher: "publisher", "publisher status": "publisherStatus",
  "original year": "originalYear", "first page": "firstPage", pinpoint: "pinpoint",
  section: "section", paragraph: "paragraph",
};

function parseLabelled(text: string): BookWorkParse | null {
  const segs = text.split(/;\s*/).map((s) => s.trim()).filter(Boolean);
  if (segs.length < 2) return null;
  const kv = segs.map((s) => s.match(/^([A-Za-z ]+?):\s*(.*)$/));
  if (!kv[0] || !LABELS[kv[0][1].toLowerCase()]) return null;
  const f: Record<string, string> = {};
  const extra: string[] = [];
  segs.forEach((s, i) => {
    const m = kv[i];
    const key = m && LABELS[m[1].toLowerCase()];
    if (!m || !key || !m[2].trim() || f[key]) extra.push(s);
    else f[key] = m[2].trim();
  });
  const fields: BookWorkParse["fields"] = {};
  for (const k of ["authors", "editors", "translators", "bookTitle", "chapterTitle", "volume", "year", "publisher", "originalYear", "firstPage"] as const) {
    if (f[k]) fields[k] = f[k];
  }
  if (f.edition) fields.edition = f.edition.replace(/\s+ed\.?$/, "");
  const pins = [f.pinpoint && normPin(f.pinpoint), f.section && `§ ${f.section.replace(/^§+\s*/, "")}`, f.paragraph && `¶ ${f.paragraph.replace(/^¶+\s*/, "")}`].filter(Boolean);
  if (pins.length > 1) extra.push(`pinpoint: ${pins.join(" / ")}`);
  else if (pins[0]) fields.pinpoint = pins[0] as string;
  if (extra.length) fields.unparsedRemainder = extra.join("; ");
  const kind: BookWorkKind = fields.chapterTitle ? "chapter" : "book";
  const p: BookWorkParse = { kind, fields, signal: true };
  if (fields.publisher) {
    const st = (f.publisherStatus ?? "").toLowerCase();
    if (/^(?:non-original|not original|reprint)$/.test(st)) fields.publisherStatus = "non-original";
    else if (st === "original") fields.publisherStatus = "original";
    else p.preserve = "publisher_unknown";
  }
  if (fields.year && /^\d{4}$/.test(fields.year) && +fields.year < 1900) p.preserve ??= "pre1900";
  return p;
}

function applyParen(fields: BookWorkParse["fields"], paren: Paren): BookWorkParse["preserve"] {
  fields.year = paren.year;
  if (paren.editors) fields.editors = paren.editors;
  if (paren.translators) fields.translators = paren.translators;
  if (paren.edition) fields.edition = paren.edition;
  if (paren.publisher) fields.publisher = paren.publisher;
  if (+paren.year < 1900) return "pre1900";
  return paren.publisher ? "publisher_unknown" : undefined;
}

export function extractBookWork(raw: string): BookWorkParse | null {
  const text = raw.trim().replace(/\.$/, "");
  if (!text || /[\u0590-\u05FF]/.test(text) || /https?:|\bv\.\s/.test(text)) return null;
  if (/^[A-Za-z ]+:\s/.test(text) && text.includes(";")) return parseLabelled(text);
  const m = text.match(/^(.+?)\s*\(([^()]+)\)(.*)$/);
  if (!m) return null;
  const [, pre, parenRaw, tailRaw] = m;
  const paren = parseParen(parenRaw);
  if (!paren) return null;
  const fields: BookWorkParse["fields"] = {};
  const tail = tailRaw.trim();
  if (tail) fields.unparsedRemainder = tail;
  const inAt = pre.search(/,\s+in\s+/);
  if (inAt >= 0) {
    const head = pre.slice(0, inAt);
    let coll = pre.slice(inAt).replace(/^,\s+in\s+/, "");
    const vm = coll.match(/^(\d{1,3})\s+(?=\D)/);
    if (vm) { fields.volume = vm[1]; coll = coll.slice(vm[0].length); }
    const at = coll.match(new RegExp(String.raw`^(.+?),\s+at\s+(${PIN})$`));
    const pages = coll.match(new RegExp(String.raw`^(.+?)\s+(\d{1,5}|${ROMAN})(?:,\s+(${PIN}))?$`));
    if (at) { fields.bookTitle = at[1]; fields.pinpoint = normPin(at[2]); }
    else if (pages) { fields.bookTitle = pages[1]; fields.firstPage = pages[2]; if (pages[3]) fields.pinpoint = normPin(pages[3]); }
    else fields.bookTitle = coll;
    const parts = head.split(/,\s+/);
    let preserve: BookWorkParse["preserve"];
    if (parts.length === 2) { fields.authors = parts[0]; fields.chapterTitle = parts[1]; }
    else if (parts.length === 1) fields.chapterTitle = head;
    else { fields.chapterTitle = head; preserve = "ambiguous_author"; }
    preserve ??= applyParen(fields, paren);
    return { kind: "chapter", fields, preserve, signal: true };
  }
  // Article shape ("…, 3 J.L. & Econ. 1") belongs to the journal path.
  if (/,\s*\d+\s+[A-Z][A-Za-z.'&\s]{2,60}?\s+\d+$/.test(pre)) return null;
  let head = pre;
  const vm = head.match(/^(\d{1,2})\s+(?=\D)/);
  if (vm) { fields.volume = vm[1]; head = head.slice(vm[0].length); }
  let preserve: BookWorkParse["preserve"];
  let signal = paren.contributors || !!paren.edition;
  const at = head.match(new RegExp(String.raw`^(.+?),\s+at\s+(${PIN}|${SECT})$`));
  const sect = head.match(new RegExp(String.raw`^(.+?)\s+(${SECT})$`));
  if (at) { head = at[1]; fields.pinpoint = normPin(at[2]); signal = true; }
  else if (sect) { head = sect[1]; fields.pinpoint = normPin(sect[2]); signal = true; }
  else {
    // A bare trailing page is a pinpoint only when the remaining title does not
    // itself end in a numeral; bare roman numerals always need ", at".
    const bare = head.match(/^(.+?)\s+(\d{1,5}(?:\s*[–\-]\s*\d{1,5})?)$/);
    if (bare && !/\d$/.test(bare[1])) { head = bare[1]; fields.pinpoint = normPin(bare[2]); }
    else if (new RegExp(String.raw`\s(?:${PIN})$`).test(head)) preserve = "ambiguous_pinpoint";
  }
  if (/,/.test(head)) fields.heading = head;
  else fields.bookTitle = head;
  preserve ??= applyParen(fields, paren);
  return { kind: "book", fields, preserve, signal };
}
