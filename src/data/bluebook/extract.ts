/**
 * Deterministic foreign-source detection + field extraction (Bluebook 22, M1).
 *
 * Conservative fast paths only: a pattern must be unmistakable before we skip
 * the LLM classifier. Anything else falls through to the existing pipeline.
 *
 * NOTE: this module imports only TYPES from abbreviations.ts, so
 * abbreviations.ts may import it back without a runtime cycle.
 */

import type { SourceType } from "@/data/abbreviations";
import {
  US_REPORTERS,
  REPORTER_IMPLIES_COURT,
  normalizeCourt,
  normalizeReporter,
  normalizeJournalName,
  isKnownJournal,
  journalJurisdiction,
  BLUEBOOK_MONTHS,
  UK_REPORT_SERIES,
  UK_VOLUMED_SERIES,
  UK_REPORT_COURTS,
} from "./tables";
import {
  toSourceType,
  type ForeignFields,
  type ForeignJurisdiction,
  type ForeignSourceKind,
  type ForeignCaseFields,
  type ForeignArticleFields,
  type ForeignBookFields,
  type ForeignChapterFields,
} from "./types";

export interface ForeignDetection {
  sourceType: SourceType;
  kind: ForeignSourceKind;
  jurisdiction: ForeignJurisdiction;
  fields: ForeignFields;
  /** "deterministic" = safe fast path; "shape" = weaker structural signal. */
  confidence: "deterministic" | "shape";
}

function esc(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const REPORTER_ALTERNATION = Object.values(US_REPORTERS)
  .sort((a, b) => b.length - a.length)
  .map((r) => esc(r).replace(/\\\.\s/g, "\\.\\s*"))
  .join("|");

const US_CASE_RE = new RegExp(
  String.raw`^(?<name>.{3,200}?),\s*(?<vol>\d+)\s+(?<rep>${REPORTER_ALTERNATION})\s+(?<page>\d+)` +
    String.raw`(?:,\s*(?<pin>\d+(?:\s*[–\-]\s*\d+)?))?` +
    String.raw`(?:\s*¶+\s*(?<para>[\d.\-–]+))?` +
    String.raw`(?:\s*\((?<paren>[^)]{0,60})\))?`,
  "u",
);

/** Bare reporter citation used for a quick classification check. */
export const US_REPORTER_SIGNAL = new RegExp(
  String.raw`\d+\s+(?:${REPORTER_ALTERNATION})\s+\d+`,
);

export const USC_SIGNAL = /\b\d+\s+U\.\s?S\.\s?C\.(?:A\.)?\s*§{1,2}/;
export const US_CONST_SIGNAL = /\b(?:U\.\s?S\.|[A-Z][a-z.]{1,6})\s?CONST\b/i;
export const UK_NEUTRAL_SIGNAL = /\[(?:19|20)\d{2}\]\s*(?:UKSC|UKHL|UKPC|EWCA|EWHC)\b/;

const PROC_PREFIX_RE = /^(In re|Ex parte|In the Matter of)\s+/i;

function splitParenthetical(paren?: string): { court?: string; year?: string } {
  if (!paren) return {};
  const m = paren.trim().match(/^(.*?)\s*((?:19|20|18|17)\d{2})$/);
  if (m) {
    const court = m[1].trim();
    return { court: court || undefined, year: m[2] };
  }
  if (/^(?:19|20|18|17)\d{2}$/.test(paren.trim())) return { year: paren.trim() };
  return { court: paren.trim() };
}

export function extractUsCase(text: string): ForeignCaseFields | null {
  const m = US_CASE_RE.exec(text.trim());
  if (!m?.groups) return null;
  const g = m.groups;
  const { court, year } = splitParenthetical(g.paren);
  const reporter = normalizeReporter(g.rep.replace(/\s+/g, " ").trim());
  const fields: ForeignCaseFields = {
    caseName: g.name.trim(),
    volume: g.vol,
    reporter,
    firstPage: g.page,
    pinpoint: g.pin ? g.pin.replace(/\s*[–\-]\s*/, "–") : undefined,
    paragraph: g.para,
    court: normalizeCourt(court),
    year,
  };
  const dk = text.match(/\bNo\.\s*([\d:\-cvCV]+)/);
  if (dk) fields.docket = dk[1];
  const db = text.match(/\b((?:19|20)\d{2}\s+(?:WL|U\.S\. App\. LEXIS|U\.S\. Dist\. LEXIS)\s+\d+)/);
  if (db) fields.databaseIdentifier = db[1];
  return fields;
}

export function extractUkCase(text: string) {
  const m = text
    .trim()
    .match(
      /^(?<name>.{3,200}?)\s*\[(?<year>(?:19|20)\d{2})\]\s*(?<court>UKSC|UKHL|UKPC|EWCA|EWHC)\s*(?:\((?<div>[^)]{1,20})\)\s*)?(?<num>\d+)(?:\s*(?:,|\s)\s*\[(?<ryear>(?:19|20)\d{2})\]\s*(?<rep>[A-Z][A-Za-z.\s]{1,10}?)\s*(?<page>\d+))?/u,
    );
  if (!m?.groups) return null;
  const g = m.groups;
  const pin = text.match(/(?:\bat\s+)?\[(\d+(?:\s*[–\-]\s*\d+)?)\]\s*$/);
  return {
    caseName: g.name.replace(/,\s*$/, "").trim(),
    year: g.year,
    neutral: `${g.court}${g.div ? ` (${g.div})` : ""} ${g.num}`,
    reporter: g.rep?.trim(),
    volume: g.ryear,
    firstPage: g.page,
    paragraph: pin ? pin[1].replace(/\s*[–\-]\s*/, "–") : undefined,
  };
}

export function extractUsStatute(text: string) {
  const m = text.match(
    /(?<title>\d+)\s+(?<code>U\.\s?S\.\s?C\.(?:A\.)?)\s*(?<sign>§{1,2})\s*(?<sec>[\w.\-–()]+(?:\s*(?:to|[-–])\s*[\w.()\-]+)?)(?:\s*\((?<year>(?:19|20)\d{2})\))?/,
  );
  if (!m?.groups) return null;
  const g = m.groups;
  const before = text.slice(0, m.index).trim().replace(/,\s*$/, "");
  return {
    statuteName: before && /[A-Za-z]{3}/.test(before) ? before : undefined,
    titleNumber: g.title,
    code: g.code.replace(/\s+/g, ""),
    section: g.sec.replace(/\s*(?:to|-)\s*/, "–").trim(),
    multi: g.sign === "§§" || /[–]/.test(g.sec),
    year: g.year,
  };
}

const ROMAN = /(?:[IVXLCDM]+)/;

export function extractUsConstitution(text: string) {
  const m = text.match(
    new RegExp(
      String.raw`(?<jur>U\.\s?S\.|[A-Z][A-Za-z.]{1,12})\s*CONST\.?\s*(?<div>amend\.|art\.|pmbl\.)?\s*(?<num>${ROMAN.source}|\d+)?` +
        String.raw`(?:,\s*§+\s*(?<sec>[\w.]+))?(?:,\s*cl\.\s*(?<cl>[\w.]+))?`,
      "i",
    ),
  );
  if (!m?.groups) return null;
  const g = m.groups;
  return {
    jurisdiction: g.jur.replace(/\s+/g, ""),
    division: g.div ? g.div.toLowerCase() : undefined,
    number: g.num,
    section: g.sec,
    clause: g.cl,
  };
}

export function extractUkStatute(text: string) {
  const m = text
    .trim()
    .match(
      /^(?<name>[A-Z][A-Za-z'’\s(),.\-]{3,120}?(?:Act|Bill|Measure|Order))\s+(?<year>(?:1[6-9]|20)\d{2})(?:,\s*c\.\s*(?<chapter>[\w]+))?(?:,\s*(?:§|s\.)\s*(?<section>[\w().]+))?/,
    );
  if (!m?.groups) return null;
  const g = m.groups;
  return {
    statuteName: g.name.trim(),
    year: g.year,
    chapter: g.chapter,
    section: g.section,
  };
}

const ARTICLE_RE =
  /^(?<authors>[^,]{3,120}(?:,\s*(?:Jr\.|Sr\.|II|III|IV))?),\s*(?<title>.{3,220}?),\s*(?<vol>\d+)\s+(?<journal>[A-Z][A-Za-z.'&\s]{2,60}?)\s+(?<page>\d+)(?:,\s*(?<pin>\d+(?:\s*[–\-]\s*\d+)?))?\s*\((?<year>(?:18|19|20)\d{2})\)/u;

export function extractJournalArticle(text: string): ForeignArticleFields | null {
  const m = ARTICLE_RE.exec(text.trim());
  if (!m?.groups) return null;
  const g = m.groups;
  const journalRaw = g.journal.trim();
  if (!isKnownJournal(journalRaw)) return null;
  return {
    authors: g.authors.trim(),
    articleTitle: g.title.trim(),
    volume: g.vol,
    journal: normalizeJournalName(journalRaw),
    firstPage: g.page,
    pinpoint: g.pin ? g.pin.replace(/\s*[–\-]\s*/, "–") : undefined,
    year: g.year,
  };
}


// ─── M2A: U.S. database-only cases (Westlaw / Lexis) ─────────────
const DB_ID_SRC = String.raw`(?:19|20)\d{2}\s+(?:WL|U\.\s?S\.\s?Dist\.\s?LEXIS|U\.\s?S\.\s?App\.\s?LEXIS)\s+\d+`;
export const US_DB_SIGNAL = new RegExp(String.raw`\b${DB_ID_SRC}\b`);

const MONTH_MAP: Record<string, string> = {
  jan: "Jan.", feb: "Feb.", mar: "Mar.", apr: "Apr.", may: "May", jun: "June",
  jul: "July", aug: "Aug.", sep: "Sept.", oct: "Oct.", nov: "Nov.", dec: "Dec.",
};

/** "March 22, 2019" / "Mar. 22, 2019" → "Mar. 22, 2019"; anything else → null. */
export function normalizeBluebookDate(raw: string): { date: string; year: string } | null {
  const m = raw.trim().match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),\s*((?:19|20)\d{2})$/);
  if (!m) return null;
  const key = m[1].slice(0, 3).toLowerCase();
  const mon = MONTH_MAP[key];
  if (!mon) return null;
  // Reject non-month words that share a prefix (e.g. "Mayor").
  const full = ["january","february","march","april","may","june","july","august","september","sept","october","november","december"];
  const w = m[1].toLowerCase();
  if (!(w.length === 3 || w === "sept" || full.includes(w)) || !BLUEBOOK_MONTHS.includes(mon)) return null;
  return { date: `${mon} ${Number(m[2])}, ${m[3]}`, year: m[3] };
}

const US_DB_CASE_RE = new RegExp(
  String.raw`^(?<name>.{3,200}?),\s*No\.\s*(?<docket>[\w:\-–./]+(?:\s*\([A-Za-z]+\))?),\s*(?<db>${DB_ID_SRC})` +
    String.raw`(?:,\s*at\s*\*\s*(?<star>\d+(?:\s*[–\-]\s*\*?\d+)?))?` +
    String.raw`\s*\((?<court>[^()]{2,40}?)\s+(?<date>[A-Za-z]{3,9}\.?\s+\d{1,2},\s*(?:19|20)\d{2})\)\.?$`,
  "u",
);

/**
 * Database-only U.S. case. Declines (null) unless case name, docket number,
 * database identifier, court and exact decision date are ALL present.
 */
export function extractUsDbCase(text: string): ForeignCaseFields | null {
  const m = US_DB_CASE_RE.exec(text.trim());
  if (!m?.groups) return null;
  const g = m.groups;
  const d = normalizeBluebookDate(g.date);
  if (!d) return null;
  const db = g.db.replace(/\s+/g, " ").replace(/U\.\s?S\.\s?(Dist|App)\.\s?LEXIS/, "U.S. $1. LEXIS");
  // The database year must agree with the decision year — otherwise decline.
  if (db.slice(0, 4) !== d.year) return null;
  const court = normalizeCourt(g.court.trim());
  if (!court || /\d{4}/.test(court)) return null;
  return {
    caseName: g.name.trim(),
    docket: g.docket.trim(),
    databaseIdentifier: db,
    starPinpoint: g.star ? g.star.replace(/\s*[–\-]\s*\*?/, "–*").replace(/\s+/g, "") : undefined,
    court,
    decisionDate: d.date,
    year: d.year,
  };
}

// ─── M2A: traditional UK Law Reports (no neutral citation) ────────
const UK_SERIES_ALT = [...UK_REPORT_SERIES].sort((a, b) => b.length - a.length).map(esc).join("|");
const UK_COURT_ALT = [...UK_REPORT_COURTS].sort((a, b) => b.length - a.length).map(esc).join("|");
const UK_TRAD_RE = new RegExp(
  String.raw`^(?<name>.{3,200}?)\s*\[(?<year>(?:18|19|20)\d{2})\]\s*(?:(?<vol>[1-4])\s+)?(?<series>${UK_SERIES_ALT})\s+(?<page>\d{1,5})` +
    String.raw`(?:,\s*(?<pin>\d{1,5}(?:\s*[–\-]\s*\d{1,5})?))?` +
    String.raw`(?:\s*\((?<court>${UK_COURT_ALT})\))?\.?$`,
  "u",
);
export const UK_TRAD_SIGNAL = new RegExp(String.raw`\[(?:18|19|20)\d{2}\]\s*(?:[1-4]\s+)?(?:${UK_SERIES_ALT})\s+\d`);
const UK_CASE_NAME_RE = /^(?:[A-Z][\w'’.&\-]*(?:\s+[\w'’.&()\-]+)*\s+v\.?\s+[A-Z(][\w'’.&()\-]*.*|R\s*\([^)]+\)\s+v\.?\s+.+|R\s+v\.?\s+[A-Z].*|(?:Re|In re)\s+[A-Z].*)$/;

export function extractUkTraditionalCase(text: string): ForeignCaseFields | null {
  const t = text.trim();
  if (UK_NEUTRAL_SIGNAL.test(t)) return null; // neutral path owns these (M1)
  const m = UK_TRAD_RE.exec(t);
  if (!m?.groups) return null;
  const g = m.groups;
  const name = g.name.replace(/,\s*$/, "").trim();
  if (!UK_CASE_NAME_RE.test(name)) return null;
  const volumed = UK_VOLUMED_SERIES.has(g.series);
  // WLR / All ER require an in-year volume; AC/QB/KB/Ch/Fam must not have one.
  if (volumed !== !!g.vol) return null;
  return {
    caseName: name,
    year: g.year,
    reporterVolume: g.vol,
    reporter: g.series,
    firstPage: g.page,
    pinpoint: g.pin ? g.pin.replace(/\s*[–\-]\s*/, "–") : undefined,
    court: g.court,
  };
}

// ─── M2A: free-text books and book chapters ──────────────────────
/** Personal author(s): 2–5 name tokens each, joined by "&" / ","; no digits. */
const NAME = String.raw`[A-Z][A-Za-z.'’\-]*(?:\s+[A-Z][A-Za-z.'’\-]*){1,4}`;
const AUTHORS_RE = new RegExp(String.raw`^${NAME}(?:(?:,\s*|\s+&\s+|,\s*&\s+)${NAME})*$`);
const ORDINAL_ED = String.raw`\d+(?:st|nd|d|rd|th)\s+ed\.`;

interface ParsedParen {
  editors?: string;
  translators?: string;
  edition?: string;
  year: string;
}

/** Parse "(Jane Doe ed., 2d ed. 1994)" style parentheticals. Unknown parts → null. */
function parseSecondaryParen(inner: string): ParsedParen | null {
  let t = inner.trim();
  const y = t.match(/(?:^|[\s,])((?:1[5-9]|20)\d{2})$/);
  if (!y) return null;
  const out: ParsedParen = { year: y[1] };
  t = t.slice(0, t.length - y[1].length).trim();
  const ed = t.match(new RegExp(String.raw`(?:^|,\s*)(${ORDINAL_ED})$`));
  if (ed) {
    out.edition = ed[1].replace(/\s+ed\.$/, "");
    t = t.slice(0, t.length - ed[0].length).trim();
  }
  const m = { groups: { rest: t } };
  const rest = (m.groups.rest || "").trim().replace(/,$/, "").trim();
  if (rest) {
    for (const part of rest.split(/,\s*(?=[A-Z])/)) {
      const p = part.trim();
      const ed = p.match(new RegExp(String.raw`^(?<n>${NAME}(?:\s*(?:&|,)\s*${NAME})*)\s+eds?\.$`));
      const tr = p.match(new RegExp(String.raw`^(?<n>${NAME}(?:\s*(?:&|,)\s*${NAME})*)\s+trans\.$`));
      if (ed?.groups && !out.editors) out.editors = ed.groups.n;
      else if (tr?.groups && !out.translators) out.translators = tr.groups.n;
      else return null; // unrecognised component → decline
    }
  }
  return out;
}

function titleLooksSafe(title: string): boolean {
  return (
    /[A-Za-z]{2}/.test(title) &&
    !/[,;]|https?:|\bv\.?\s/.test(title) &&
    !/^\d/.test(title) &&
    title.length <= 200
  );
}

const CHAPTER_RE = /^(?<authors>[^,]{3,120}(?:,\s*[^,]{3,60}&[^,]{3,60})?),\s*(?<ctitle>[^]{3,220}?),\s*in\s+(?<btitle>.{3,220}?)\s+(?<page>\d{1,5})(?:,\s*(?<pin>\d{1,5}(?:\s*[–\-]\s*\d{1,5})?))?\s*\((?<paren>[^()]{4,120})\)\.?$/u;

export function extractBookChapter(text: string): ForeignChapterFields | null {
  const m = CHAPTER_RE.exec(text.trim());
  if (!m?.groups) return null;
  const g = m.groups;
  const authors = g.authors.trim();
  if (!AUTHORS_RE.test(authors)) return null;
  const ctitle = g.ctitle.trim();
  const btitle = g.btitle.trim();
  if (!/[A-Za-z]{2}/.test(ctitle) || /https?:|\bv\.?\s/.test(ctitle)) return null;
  if (!titleLooksSafe(btitle)) return null;
  const paren = parseSecondaryParen(g.paren);
  if (!paren || paren.translators) return null;
  return {
    authors,
    chapterTitle: ctitle,
    bookTitle: btitle,
    firstPage: g.page,
    pinpoint: g.pin ? g.pin.replace(/\s*[–\-]\s*/, "–") : undefined,
    editors: paren.editors,
    edition: paren.edition,
    year: paren.year,
  };
}

const BOOK_RE = /^(?:(?<vol>\d{1,2})\s+)?(?<authors>[^,]{3,120}(?:,\s*[^,]*&[^,]{3,60})?),\s*(?<title>[^,()]{2,200}?)(?:\s+(?<pin>\d{1,5}(?:\s*[–\-]\s*\d{1,5})?))?\s*\((?<paren>[^()]{4,120})\)\.?$/u;

export function extractBook(text: string): ForeignBookFields | null {
  const t = text.trim();
  // Chapters and articles have their own paths — never collapse them into a book.
  if (/,\s*in\s+[A-Z]/.test(t)) return null;
  if (/,\s*\d+\s+[A-Z][A-Za-z.'&\s]{2,60}?\s+\d+/.test(t)) return null;
  const m = BOOK_RE.exec(t);
  if (!m?.groups) return null;
  const g = m.groups;
  const authors = g.authors.trim();
  if (!AUTHORS_RE.test(authors)) return null;
  const title = g.title.trim();
  if (!titleLooksSafe(title)) return null;
  // A title ending in a bare number is ambiguous (pinpoint vs. title) — decline.
  if (/\s\d+$/.test(title)) return null;
  const paren = parseSecondaryParen(g.paren);
  if (!paren) return null;
  return {
    authors,
    bookTitle: title,
    volume: g.vol,
    edition: paren.edition,
    editors: paren.editors,
    translators: paren.translators,
    pinpoint: g.pin ? g.pin.replace(/\s*[–\-]\s*/, "–") : undefined,
    year: paren.year,
  };
}

/** A traditional source that merely happens to be online is NOT an internet source. */
export function looksLikeTraditionalSourceOnline(text: string): boolean {
  return (
    US_REPORTER_SIGNAL.test(text) ||
    USC_SIGNAL.test(text) ||
    UK_NEUTRAL_SIGNAL.test(text) ||
    US_DB_SIGNAL.test(text) ||
    UK_TRAD_SIGNAL.test(text) ||
    !!extractJournalArticle(text.replace(/https?:\/\/\S+/g, "").trim())
  );
}

/**
 * Deterministic foreign classification. Returns null when no safe fast path
 * applies — the caller then continues with the existing classifier chain.
 */
export function detectForeignSource(raw: string): ForeignDetection | null {
  const text = raw.trim();
  if (!text) return null;
  // Hebrew-dominant text is never routed through the Bluebook fast paths.
  const hebrewChars = (text.match(/[\u0590-\u05FF]/g) || []).length;
  const latinChars = (text.match(/[A-Za-z]/g) || []).length;
  if (hebrewChars > latinChars) return null;

  const build = (
    kind: ForeignSourceKind,
    jurisdiction: ForeignJurisdiction,
    fields: ForeignFields,
    confidence: ForeignDetection["confidence"] = "deterministic",
  ): ForeignDetection => ({
    kind,
    jurisdiction,
    fields,
    sourceType: toSourceType(kind, jurisdiction),
    confidence,
  });

  // 1. U.S. Constitution
  if (US_CONST_SIGNAL.test(text)) {
    const f = extractUsConstitution(text);
    if (f) return build("constitution", "US", f);
  }

  // 2. U.S.C. / U.S.C.A.
  if (USC_SIGNAL.test(text)) {
    const f = extractUsStatute(text);
    if (f) return build("statute", "US", f);
  }

  // 3. UK neutral citation
  if (UK_NEUTRAL_SIGNAL.test(text)) {
    const f = extractUkCase(text);
    if (f) return build("case", "UK", f);
  }

  // 3b. Traditional UK Law Reports (no neutral citation) — M2A
  if (UK_TRAD_SIGNAL.test(text)) {
    const f = extractUkTraditionalCase(text);
    if (f) return build("case", "UK", f);
  }

  // 3c. U.S. database-only case (Westlaw / Lexis) — M2A
  if (US_DB_SIGNAL.test(text) && !US_REPORTER_SIGNAL.test(text)) {
    const f = extractUsDbCase(text);
    if (f) return build("case", "US", f);
  }

  // 4. U.S. reporter citation
  if (US_REPORTER_SIGNAL.test(text)) {
    const f = extractUsCase(text);
    if (f) return build("case", "US", f);
  }

  // 5a. Book chapter (before article/book so "in <Book>" never collapses) — M2A
  const chap = extractBookChapter(text);
  if (chap) return build("book_chapter", "OTHER", chap);

  // 5. Law-review article — jurisdiction from known-journal metadata only (M2A)
  const art = extractJournalArticle(text);
  if (art) return build("journal_article", journalJurisdiction(art.journal), art);

  // 5b. Book — M2A
  const book = extractBook(text);
  if (book) return build("book", "OTHER", book);

  // 6. UK statute (modern form)
  const ukAct = extractUkStatute(text);
  if (ukAct && /\b(?:UK|United Kingdom|England)\b/i.test(text) === false && ukAct.chapter) {
    return build("statute", "UK", ukAct);
  }
  if (ukAct && /\bc\.\s*\d+/.test(text)) return build("statute", "UK", ukAct);

  // 7. Foreign case shape without a recognized reporter (weaker signal).
  if (/^[A-Z][\w'’.\-]+.{0,120}?\sv\.?\s[A-Z]/.test(text)) {
    const usCase = extractUsCase(text);
    if (usCase) return build("case", "US", usCase);
    const procName = PROC_PREFIX_RE.test(text);
    return build(
      "case",
      /\b(?:UKSC|UKHL|EWCA|EWHC|AC|WLR|QB|KB)\b/.test(text) ? "UK" : "OTHER",
      { caseName: text.replace(/\.$/, "") , ...(procName ? {} : {}) },
      "shape",
    );
  }

  return null;
}

export { REPORTER_IMPLIES_COURT };
