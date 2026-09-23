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
} from "./tables";
import {
  toSourceType,
  type ForeignFields,
  type ForeignJurisdiction,
  type ForeignSourceKind,
  type ForeignCaseFields,
  type ForeignArticleFields,
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
  /^(?<authors>[^,]{3,120}),\s*(?<title>.{3,220}?),\s*(?<vol>\d+)\s+(?<journal>[A-Z][A-Za-z.'&\s]{2,60}?)\s+(?<page>\d+)(?:,\s*(?<pin>\d+(?:\s*[–\-]\s*\d+)?))?\s*\((?<year>(?:18|19|20)\d{2})\)/u;

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

/** A traditional source that merely happens to be online is NOT an internet source. */
export function looksLikeTraditionalSourceOnline(text: string): boolean {
  return (
    US_REPORTER_SIGNAL.test(text) ||
    USC_SIGNAL.test(text) ||
    UK_NEUTRAL_SIGNAL.test(text) ||
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

  // 4. U.S. reporter citation
  if (US_REPORTER_SIGNAL.test(text)) {
    const f = extractUsCase(text);
    if (f) return build("case", "US", f);
  }

  // 5. Law-review article
  const art = extractJournalArticle(text);
  if (art) return build("journal_article", "OTHER", art);

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
