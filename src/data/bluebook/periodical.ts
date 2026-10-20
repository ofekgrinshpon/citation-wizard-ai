/**
 * Stage 5 batch 3 — nonconsecutively paginated journals/magazines (general
 * Bluebook 21 R16.5) and print newspapers (R16.6(a),(b)) ONLY.
 *
 * Bounded supplied grammar (verbatim text, no dictionary lookups):
 *   [Author, ][Designation, ][Title, ]Periodical[ (Place)], DateOrIssue[ (Section)], at Page[, pins][tail]
 * A trailing ", at <page>" after a cover date / issue designation is required,
 * so consecutively paginated journals ("3 J.L. & Econ. 1 (1960)") never match.
 * Article vs newspaper is decided only by explicit structure; otherwise the
 * result is "ambiguous" and callers must preserve the input with a warning.
 */
import type { ForeignPeriodicalFields } from "./types";

const MON = String.raw`(?:Jan(?:uary|\.)?|Feb(?:ruary|\.)?|Mar(?:ch|\.)?|Apr(?:il|\.)?|May|June?|July?|Aug(?:ust|\.)?|Sept(?:ember|\.)?|Oct(?:ober|\.)?|Nov(?:ember|\.)?|Dec(?:ember|\.)?)`;
const YEAR = String.raw`(?:1[6-9]|20)\d{2}`;
const FULL_DATE = new RegExp(String.raw`^${MON}\s+\d{1,2},\s+${YEAR}$`);
const COVER_DATE = new RegExp(String.raw`^(?:${MON}(?:\s*[–\-/]\s*${MON})?\s+${YEAR}|(?:Spring|Summer|Fall|Autumn|Winter)(?:\s*[–\-/]\s*(?:Spring|Summer|Fall|Autumn|Winter))?\s+${YEAR}(?:\s*[–\-/]\s*(?:${YEAR}|\d{2}))?)$`);
const ISSUE = new RegExp(String.raw`^(?:vol\.\s+[\w.]+,\s+)?no\.\s+[\w.\-–]+(?:,\s+(?:${MON}\s+)?${YEAR})?$`, "i");
const DATE_SRC = String.raw`(?:${MON}\s+\d{1,2},\s+${YEAR}|${MON}(?:\s*[–\-/]\s*${MON})?\s+${YEAR}|(?:Spring|Summer|Fall|Autumn|Winter)(?:\s*[–\-/]\s*(?:Spring|Summer|Fall|Autumn|Winter))?\s+${YEAR}(?:\s*[–\-/]\s*(?:${YEAR}|\d{2}))?|(?:vol\.\s+[\w.]+,\s+)?no\.\s+[\w.\-–]+(?:,\s+(?:${MON}\s+)?${YEAR})?)`;
const PAGE = String.raw`[A-Z]{0,3}\d+[A-Z]?`;
const PIN = String.raw`${PAGE}(?:\s*[–\-]\s*${PAGE})?(?:\s+n\.\s*\d+)?`;
const DESIGNATION = /^(?:Editorial|Opinion|Op-Ed|Letter to the Editor)$/;
const SECTION = /^(?:§+\s*\S+|sec(?:tion|\.)\s*\S+.*|.+\s+sec(?:tion|\.))$/i;

export type PeriodicalKind = "journal_article" | "newspaper";
export interface PeriodicalParse {
  /** Structurally decided kind, or "ambiguous" when only shared structure was supplied. */
  kind: PeriodicalKind | "ambiguous";
  fields: ForeignPeriodicalFields;
  /** Structure only an R16.5 article has (cover season/month/range, issue no.). */
  articleSignal: boolean;
  /** Structure only an R16.6 newspaper has here (place or section parenthetical, designation). */
  newspaperSignal: boolean;
  /** A comma-split heading whose first part is not a recognizable personal name: author vs title unknown. */
  authorTitleAmbiguous: boolean;
}

const authorLike = (s: string) => /^[\p{Lu}]/u.test(s) && !/\d/.test(s) && s.split(/\s+/).length <= 8;
const NAME_TOKEN = /^(?:(?:\p{Lu}\.){1,3}|\p{Lu}[\p{Ll}'’]+(?:-\p{Lu}[\p{Ll}'’]+)?|Jr\.|Sr\.|II|III|IV)$/u;
/** Structural personal-name shape only: each author is 2–4 name tokens (given + family). */
const personalName = (s: string) => s.split(/\s+(?:&|and)\s+/).every((n) => {
  const t = n.trim().split(/\s+/);
  return t.length >= 2 && t.length <= 4 && t.every((x) => NAME_TOKEN.test(x));
});

export function extractPeriodical(raw: string): PeriodicalParse | null {
  const text = raw.trim().replace(/\.$/, "");
  if (!text || /[\u0590-\u05FF]/.test(text)) return null; // Israeli rules govern Hebrew sources.
  const atRe = new RegExp(String.raw`^(.*?),\s+(${DATE_SRC})(?:\s+\(([^()]+)\))?,\s+at\s+(${PAGE})((?:\s*,\s*${PIN})*)(.*)$`);
  const m = text.match(atRe);
  if (!m) return null;
  const [, left, dateOrIssue, sectionRaw, firstPage, pinsRaw, tail] = m;
  if (sectionRaw && !SECTION.test(sectionRaw.trim())) return null;
  const pm = left.match(/^(.*),\s+([^,()]+?)(?:\s+\(([^()\d]+)\))?$/) ?? left.match(/^()([^,()]+?)(?:\s+\(([^()\d]+)\))?$/);
  if (!pm) return null;
  const [, head, periodical, place] = pm;
  const f: ForeignPeriodicalFields = { periodical: periodical.trim(), firstPage };
  if (place) f.place = place.trim();
  if (sectionRaw) f.section = sectionRaw.trim();
  const full = FULL_DATE.test(dateOrIssue);
  if (full || COVER_DATE.test(dateOrIssue)) f.date = dateOrIssue;
  else if (ISSUE.test(dateOrIssue)) {
    // R16.5 → R16.4: a supplied volume goes before the periodical, not in the issue.
    const vm = dateOrIssue.match(/^vol\.\s+([\w.]+),\s+(.*)$/i);
    if (vm) { f.volume = vm[1]; f.issue = vm[2]; } else f.issue = dateOrIssue;
  }
  else return null;
  const pins = pinsRaw.replace(/^\s*,\s*/, "").trim();
  if (pins) f.pinpoint = pins.replace(/\s*[–\-]\s*/g, "–").replace(/\s*,\s*/g, ", ");
  const rest = tail.trim();
  if (rest) f.unparsedRemainder = rest;

  const parts = head ? head.split(/,\s+/) : [];
  let authorTitleAmbiguous = false;
  if (parts.length && DESIGNATION.test(parts[0])) {
    f.designation = parts[0];
    if (parts.length > 1) f.title = parts.slice(1).join(", ");
  } else if (parts.length > 1 && authorLike(parts[0]) && !personalName(parts[0])) {
    // Never claim an uncertain name-like heading as an identified author.
    authorTitleAmbiguous = true;
    f.title = head.trim();
  } else if (parts.length > 1 && DESIGNATION.test(parts[1]) && authorLike(parts[0])) {
    f.authors = parts[0];
    f.designation = parts[1];
    if (parts.length > 2) f.title = parts.slice(2).join(", ");
  } else if (parts.length > 1 && authorLike(parts[0])) {
    f.authors = parts[0];
    f.title = parts.slice(1).join(", ");
  } else if (head) f.title = head.trim();

  const articleSignal = !full;
  const newspaperSignal = !!(f.place || f.section || f.designation);
  const kind = authorTitleAmbiguous ? "ambiguous" : articleSignal && !newspaperSignal ? "journal_article"
    : newspaperSignal && !articleSignal && (f.place || f.section) ? "newspaper" : "ambiguous";
  return { kind, fields: f, articleSignal, newspaperSignal, authorTitleAmbiguous };
}
