/**
 * Bluebook 22 foreign-source integration — internal source model.
 *
 * Israeli Rule 35.1 is the operative rule: foreign sources cited inside an
 * Israeli paper are formatted according to the current Bluebook. Rule 36 in the
 * Israeli guide supplies examples only — its numbering is NOT Bluebook rule
 * numbering. Internally we therefore identify the ruleset as
 * `foreign_bluebook_v22` and keep Bluebook rule numbers out of the Israeli
 * numbering space.
 */

import type { SourceType } from "@/data/abbreviations";

export const FOREIGN_RULESET_ID = "foreign_bluebook_v22" as const;

/** Bounded internal family model — NOT one enum value per country. */
export type ForeignSourceKind =
  | "case"
  | "constitution"
  | "statute"
  | "book"
  | "journal_article"
  | "book_chapter"
  | "internet"
  | "other";

export type ForeignJurisdiction = "US" | "UK" | "OTHER";

export interface ForeignIdentity {
  kind: ForeignSourceKind;
  jurisdiction: ForeignJurisdiction;
}

/** Legacy compatibility-facing SourceType values → internal identity. */
export const FOREIGN_TYPE_IDENTITY: Partial<Record<SourceType, ForeignIdentity>> = {
  foreign_case_us: { kind: "case", jurisdiction: "US" },
  foreign_case_other: { kind: "case", jurisdiction: "OTHER" },
  foreign_constitution: { kind: "constitution", jurisdiction: "US" },
  foreign_statute_us: { kind: "statute", jurisdiction: "US" },
  foreign_statute_uk: { kind: "statute", jurisdiction: "UK" },
  foreign_book: { kind: "book", jurisdiction: "OTHER" },
  foreign_journal_article: { kind: "journal_article", jurisdiction: "OTHER" },
  foreign_book_chapter: { kind: "book_chapter", jurisdiction: "OTHER" },
  foreign_internet: { kind: "internet", jurisdiction: "OTHER" },
  foreign: { kind: "other", jurisdiction: "OTHER" },
};

export function toForeignIdentity(t: SourceType): ForeignIdentity | null {
  return FOREIGN_TYPE_IDENTITY[t] ?? null;
}

export function isForeignSourceType(t: SourceType): boolean {
  return t === "foreign" || t.startsWith("foreign_");
}

/** Internal identity → the compatibility-facing public SourceType. */
export function toSourceType(
  kind: ForeignSourceKind,
  jurisdiction: ForeignJurisdiction,
): SourceType {
  switch (kind) {
    case "case":
      return jurisdiction === "US" ? "foreign_case_us" : "foreign_case_other";
    case "constitution":
      return "foreign_constitution";
    case "statute":
      return jurisdiction === "UK" ? "foreign_statute_uk" : "foreign_statute_us";
    case "book":
      return "foreign_book";
    case "journal_article":
      return "foreign_journal_article";
    case "book_chapter":
      return "foreign_book_chapter";
    case "internet":
      return "foreign_internet";
    default:
      return "foreign";
  }
}

/** Structured field shapes (Milestone 1 families). */
export interface ForeignCaseFields {
  caseName?: string;
  volume?: string;
  reporter?: string;
  firstPage?: string;
  pinpoint?: string;
  paragraph?: string;
  court?: string;
  year?: string;
  docket?: string;
  /**
   * Alternative publication identifier (Westlaw / Lexis), e.g.
   * "2019 WL 1234567". NOT a reporter, volume, first page or pinpoint.
   */
  databaseIdentifier?: string;
  /**
   * Star-page pinpoint inside a database-only case ("at *5" → "5").
   * Kept separate from the reporter-page `pinpoint`.
   */
  starPinpoint?: string;
  /** Exact decision date in Bluebook form, e.g. "Mar. 22, 2019" (database cases). */
  decisionDate?: string;
  /** Volume number inside a UK report year, e.g. "1" in "[1990] 1 WLR 1". */
  reporterVolume?: string;
  /** Neutral citation body for UK sources, e.g. "UKSC 41". */
  neutral?: string;
}

export interface ForeignConstitutionFields {
  jurisdiction?: string; // "U.S." | "N.Y." ...
  division?: string; // "amend." | "art."
  number?: string; // "XIV"
  section?: string;
  clause?: string;
}

export interface ForeignStatuteFields {
  statuteName?: string;
  titleNumber?: string;
  code?: string;
  section?: string;
  sections?: string[];
  subsection?: string;
  chapter?: string; // UK
  year?: string;
  regnalYear?: string;
  monarch?: string;
}

export interface ForeignArticleFields {
  authors?: string;
  articleTitle?: string;
  volume?: string;
  journal?: string;
  firstPage?: string;
  pinpoint?: string;
  year?: string;
}

export interface ForeignBookFields {
  authors?: string;
  bookTitle?: string;
  volume?: string;
  edition?: string;
  editors?: string;
  translators?: string;
  pinpoint?: string;
  year?: string;
}

export interface ForeignChapterFields {
  authors?: string;
  chapterTitle?: string;
  bookTitle?: string;
  firstPage?: string;
  pinpoint?: string;
  editors?: string;
  edition?: string;
  year?: string;
}

export interface ForeignInternetFields {
  author?: string;
  title?: string;
  site?: string;
  date?: string;
  url?: string;
}

export type ForeignFields =
  | ForeignCaseFields
  | ForeignConstitutionFields
  | ForeignStatuteFields
  | ForeignArticleFields
  | ForeignBookFields
  | ForeignChapterFields
  | ForeignInternetFields;
