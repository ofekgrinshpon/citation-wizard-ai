/**
 * Citation Engine — Deno port for Supabase Edge Functions.
 *
 * IMPORTANT: This is a STANDALONE COPY of `src/data/citationEngine.ts`.
 * The React app continues to import from its original location and is NOT
 * affected by this file. Any rule changes must be ported manually to BOTH
 * files (no auto-sync). See:
 *   .lovable/memory/logic/legal-qa/citation-engine-perplexity-resolver.md
 *
 * Used by: supabase/functions/legal-qa (Stage E.5 Perplexity-completion guard).
 *
 * Scope of this port: only the data registry + 4 helpers required by the
 * resolver are kept verbatim. Source-type entries beyond the 5 used by the
 * Perplexity flow (statutes + caselaw) are still included so future expansion
 * does not require re-porting.
 */

// ─── General Rules ────────────────────────────────────────────────
export const GENERAL_RULES = {
  "1.1": { title: "מבנה אזכור כללי", description: "כל אזכור כולל את רכיבי המקור בסדר קבוע, ומסתיים בנקודה." },
  "1.9": { title: "הפרדה בפסיק", description: "פסיק להפרדה בין מספרים/מילים עוקבות שאינן ניתנות להבחנה אחרת." },
  "1.10": { title: "טווחי מספרים", description: "בעברית: טווח מימין לשמאל (אכיפה: hebrewNumberRange.ts → normalizeHebrewNumberRanges)." },
} as const;

// ─── Interfaces ──────────────────────────────────────────────────
export interface CitationRuleSet {
  primaryRule: string;
  ruleTitle: string;
  components: CitationComponent[];
  template: string;
  example: string;
  notes?: string[];
}

export interface CitationComponent {
  field: string;
  rule: string;
  description: string;
  required: boolean;
  format?: "bold" | "italic" | "quotes" | "brackets" | "plain";
}

// ─── Source Type Rule Map (only types used by Perplexity resolver) ───
export const CITATION_RULES: Record<string, CitationRuleSet> = {
  // ─── חקיקה ראשית ──────────────
  primary_legislation: {
    primaryRule: "2",
    ruleTitle: "כלל 2 – חקיקה ראשית",
    template: "{lawName}, {hebrewYear}-{gregorianYear}, {collection} {firstPage}.",
    example: 'חוק העונשין, התשל"ז-1977, ס"ח 226.',
    components: [
      { field: "lawName", rule: "2.1", description: "שם החוק המלא", required: true, format: "plain" },
      { field: "hebrewYear", rule: "2.4", description: "שנה עברית (התש...)", required: true, format: "plain" },
      { field: "gregorianYear", rule: "2.4", description: "שנה לועזית", required: true, format: "plain" },
      { field: "collection", rule: "2.5", description: 'קובץ פרסום (ס"ח/ק"ת)', required: false, format: "plain" },
      { field: "firstPage", rule: "2.6", description: "עמוד ראשון בקובץ הפרסום", required: false, format: "plain" },
    ],
  },

  // ─── חוק יסוד ─────────────────
  basic_law: {
    primaryRule: "4",
    ruleTitle: "כלל 4 – חוק יסוד",
    template: "חוק-יסוד: {lawName}, {collection} {firstPage}.",
    example: 'חוק-יסוד: כבוד האדם וחירותו, ס"ח 150.',
    components: [
      { field: "lawName", rule: "4.3", description: "שם חוק היסוד (אחרי 'חוק-יסוד:')", required: true, format: "plain" },
      { field: "hebrewYear", rule: "4.4", description: "שנה עברית", required: false, format: "plain" },
      { field: "gregorianYear", rule: "4.4", description: "שנה לועזית", required: false, format: "plain" },
      { field: "collection", rule: "2.5", description: 'ס"ח', required: false, format: "plain" },
      { field: "firstPage", rule: "2.6", description: "עמוד ראשון", required: false, format: "plain" },
    ],
  },

  // ─── חקיקת משנה ───────────────
  secondary_legislation: {
    primaryRule: "6",
    ruleTitle: "כלל 6 – חקיקת משנה",
    template: "{regulationName}, {hebrewYear}-{gregorianYear}, {collection} {firstPage}.",
    example: 'תקנות התעבורה, התשכ"א-1961, ק"ת 1128.',
    components: [
      { field: "regulationName", rule: "6.1", description: "שם התקנות", required: true, format: "plain" },
      { field: "hebrewYear", rule: "6.2", description: "שנה עברית", required: true, format: "plain" },
      { field: "gregorianYear", rule: "6.2", description: "שנה לועזית", required: true, format: "plain" },
      { field: "collection", rule: "6.3", description: 'ק"ת', required: false, format: "plain" },
      { field: "firstPage", rule: "2.6", description: "עמוד ראשון", required: false, format: "plain" },
    ],
  },

  // ─── פסיקה מדפוס ──────────────
  case_law_published: {
    primaryRule: "18",
    ruleTitle: "כלל 18 – פסיקה שפורסמה בדפוס",
    template: "{caseType} {caseNumber} {party1} נ' {party2}, {series} {volume} {firstPage} ({year}).",
    example: 'ע"א 2401/08 מדינת ישראל נ\' גיספן, פ"ד סד 202 (2011).',
    components: [
      { field: "caseType", rule: "18.2", description: "סוג ההליך", required: true, format: "plain" },
      { field: "caseNumber", rule: "18.2", description: "מספר התיק", required: true, format: "plain" },
      { field: "party1", rule: "18.4", description: "שם צד א'", required: true, format: "bold" },
      { field: "party2", rule: "18.4", description: "שם צד ב'", required: true, format: "bold" },
      { field: "series", rule: "18.6", description: 'סדרת פרסום (פ"ד וכו\')', required: true, format: "plain" },
      { field: "volume", rule: "18.6", description: "כרך", required: true, format: "plain" },
      { field: "firstPage", rule: "18.8", description: "עמוד ראשון", required: true, format: "plain" },
      { field: "year", rule: "18.7", description: "שנה (בסוגריים)", required: true, format: "plain" },
    ],
  },

  // ─── פסיקה ממאגר ──────────────
  case_law_database: {
    primaryRule: "19",
    ruleTitle: "כלל 19 – פסיקה ממאגר מידע",
    template: "{caseType} {caseNumber} {party1} נ' {party2} (פורסם ב{database}, {fullDate}).",
    example: 'ת"א 1234/05 ישראלי נ\' כהן (פורסם בנבו, 15.3.2010).',
    components: [
      { field: "caseType", rule: "18.2", description: "סוג ההליך", required: true, format: "plain" },
      { field: "caseNumber", rule: "18.2", description: "מספר התיק", required: true, format: "plain" },
      { field: "party1", rule: "18.4", description: "שם צד א'", required: true, format: "bold" },
      { field: "party2", rule: "18.4", description: "שם צד ב'", required: true, format: "bold" },
      { field: "database", rule: "19.1", description: "שם המאגר (נבו, תקדין, אר\u05F4ש, פדאור, דינים, פסקדין)", required: false, format: "plain" },
      { field: "fullDate", rule: "19.1", description: "תאריך פרסום מלא", required: true, format: "plain" },
    ],
  },

  // ─── Foreign sources — Israeli Rule 35.1 incorporates the CURRENT Bluebook
  // (internally: ruleset `foreign_bluebook_v22`). The 36.x numbers below are the
  // Israeli guide's example numbering, NOT Bluebook rule numbers.
  // Minimal Deno mirror.
  // Keep in sync with src/data/citationEngine.ts (no auto-sync). Required-fields
  // only; full notes/templates live on the React side.
  foreign_constitution: {
    primaryRule: "36.1",
    ruleTitle: "כלל 36.1 – חוקות (ארה\"ב)",
    template: "{jurisdiction} CONST. {division} {section}.",
    example: "U.S. CONST. amend. XV, § 1.",
    components: [
      { field: "jurisdiction", rule: "36.1", description: "תחום שיפוט", required: true, format: "plain" },
      { field: "division", rule: "36.1", description: "amend./art.", required: true, format: "plain" },
      { field: "section", rule: "36.1", description: "סעיף", required: true, format: "plain" },
    ],
  },
  foreign_statute_us: {
    primaryRule: "36.2",
    ruleTitle: "כלל 36.2 – חוקים (ארה\"ב)",
    template: "[{statuteName}, ]{title} {code} § {section} ({year}).",
    example: "Sherman Act, 15 U.S.C. §§ 1–7.",
    components: [
      { field: "statuteName", rule: "36.2", description: "שם החוק", required: false, format: "plain" },
      { field: "title", rule: "36.2", description: "title", required: true, format: "plain" },
      { field: "code", rule: "36.2", description: "U.S.C.", required: true, format: "plain" },
      { field: "section", rule: "36.2", description: "סעיף", required: true, format: "plain" },
      { field: "year", rule: "36.2", description: "שנת הקודקס", required: false, format: "plain" },
    ],
  },
  foreign_statute_uk: {
    primaryRule: "36.3",
    ruleTitle: "כלל 36.3 – חוקים (אנגליה)",
    template: "{statuteName} {year}, [{regnalYear} {monarch} ]c. {chapter}[, § {section}].",
    example: "Habeas Corpus Act 1679, 31 Car. 2 c. 2.",
    components: [
      { field: "statuteName", rule: "36.3", description: "שם החוק", required: true, format: "plain" },
      { field: "year", rule: "36.3", description: "שנה", required: true, format: "plain" },
      { field: "regnalYear", rule: "36.3", description: "שנת מלכות (עד 1962)", required: false, format: "plain" },
      { field: "monarch", rule: "36.3", description: "קיצור שם מלך/ה", required: false, format: "plain" },
      { field: "chapter", rule: "36.3", description: "chapter", required: true, format: "plain" },
      { field: "section", rule: "36.3", description: "סעיף", required: false, format: "plain" },
    ],
  },
  foreign_case_us: {
    primaryRule: "36.4",
    ruleTitle: "כלל 36.4 – פסיקה (ארה\"ב)",
    template: "[##{procPrefix}## ]{party1} v. {party2}, {volume} {reporter} {firstPage}[, {pinpoint}] ([{court} ]{year}).",
    example: "Atkins v. Virginia, 536 U.S. 304 (2002).",
    components: [
      { field: "party1", rule: "36.4", description: "צד א'", required: true, format: "plain" },
      { field: "party2", rule: "36.4", description: "צד ב'", required: true, format: "plain" },
      { field: "volume", rule: "36.4", description: "כרך", required: true, format: "plain" },
      { field: "reporter", rule: "36.4", description: "סדרה", required: true, format: "plain" },
      { field: "firstPage", rule: "36.4", description: "עמוד ראשון", required: true, format: "plain" },
      { field: "court", rule: "36.4", description: "ערכאה", required: false, format: "plain" },
      { field: "year", rule: "36.4", description: "שנה", required: true, format: "plain" },
    ],
  },
  foreign_case_other: {
    primaryRule: "36.5",
    ruleTitle: "כלל 36.5 – פסיקה (מדינות אחרות)",
    template: "{party1} v. {party2} {volumeOrYear} {reporter} {firstPage}[, {pinpoint}] ({courtAndJurisdiction}).",
    example: "Young v. Bristol Aeroplane Co. [1944] KB 718 (CA).",
    components: [
      { field: "party1", rule: "36.5", description: "צד א'", required: true, format: "plain" },
      { field: "party2", rule: "36.5", description: "צד ב'", required: true, format: "plain" },
      { field: "volumeOrYear", rule: "36.5", description: "כרך/שנה", required: true, format: "plain" },
      { field: "reporter", rule: "36.5", description: "סדרה", required: true, format: "plain" },
      { field: "firstPage", rule: "36.5", description: "עמוד ראשון", required: true, format: "plain" },
      { field: "courtAndJurisdiction", rule: "36.5", description: "ערכאה ושיפוט", required: true, format: "plain" },
    ],
  },
  foreign_book: {
    primaryRule: "36.6",
    ruleTitle: "כלל 36.6 – ספרים לועזיים",
    template: "[{volume} ]##{authors}##, ##{bookTitle}##[: ##{subtitle}##][ {pinpoint}] ([{edition}, ][{editor} eds., ][{translator} trans., ][{publisher} ]{year}).",
    example: "HAZEL GENN, JUDGING CIVIL JUSTICE (2010).",
    components: [
      { field: "authors", rule: "36.6", description: "מחברים", required: true, format: "italic" },
      { field: "bookTitle", rule: "36.6", description: "שם הספר", required: true, format: "italic" },
      { field: "year", rule: "36.6", description: "שנה", required: true, format: "plain" },
    ],
  },
  foreign_journal_article: {
    primaryRule: "36.7",
    ruleTitle: "כלל 36.7 – מאמרים בכתבי עת לועזיים",
    template: "{authors}, ##{articleTitle}##[: ##{subtitle}##], {volume} ##{journal}## {firstPage}[, {pinpoint}] ({year}).",
    example: "Ruth Gavison, Privacy and the Limits of Law, 89 YALE L.J. 421 (1980).",
    components: [
      { field: "authors", rule: "36.7", description: "מחברים", required: true, format: "plain" },
      { field: "articleTitle", rule: "36.7", description: "שם המאמר", required: true, format: "italic" },
      { field: "volume", rule: "36.7", description: "כרך", required: true, format: "plain" },
      { field: "journal", rule: "36.7", description: "כתב עת", required: true, format: "italic" },
      { field: "firstPage", rule: "36.7", description: "עמוד ראשון", required: true, format: "plain" },
      { field: "year", rule: "36.7", description: "שנה", required: true, format: "plain" },
    ],
  },
  foreign_book_chapter: {
    primaryRule: "36.8",
    ruleTitle: "כלל 36.8 – מאמרים בספרים לועזיים",
    template: "{authors}, ##{articleTitle}##, in ##{bookTitle}## {firstPage}[, {pinpoint}] ({editor} eds., {year}).",
    example: "Ayelet Shachar, Constituting Citizens, in CANADA IN THE WORLD 123 (Albert & Cameron eds., 2018).",
    components: [
      { field: "authors", rule: "36.8", description: "מחברים", required: true, format: "plain" },
      { field: "articleTitle", rule: "36.8", description: "שם המאמר", required: true, format: "italic" },
      { field: "bookTitle", rule: "36.8", description: "שם הספר", required: true, format: "italic" },
      { field: "firstPage", rule: "36.8", description: "עמוד ראשון", required: true, format: "plain" },
      { field: "editor", rule: "36.8", description: "עורך", required: false, format: "plain" },
      { field: "year", rule: "36.8", description: "שנה", required: true, format: "plain" },
    ],
  },
  foreign_internet: {
    primaryRule: "36.9",
    ruleTitle: "כלל 36.9 – מקורות במרשתת לועזיים",
    template: "[{author} ([@{handle}]), ]##{title}##, [{contentType} ]##{site}## ({date}), {url}.",
    example: "Katy Barnett, News, OPINIONS ON HIGH (Mar. 22, 2019), https://shorturl.at/ersHN.",
    components: [
      { field: "author", rule: "36.9", description: "מחבר", required: false, format: "plain" },
      { field: "title", rule: "36.9", description: "שם העמוד", required: true, format: "italic" },
      { field: "site", rule: "36.9", description: "שם האתר", required: true, format: "italic" },
      { field: "date", rule: "36.9", description: "תאריך", required: false, format: "plain" },
      { field: "url", rule: "36.9", description: "URL", required: true, format: "plain" },
    ],
  },
};

// ─── Validation helpers ─────────────────────────────────────
export function getRequiredFields(sourceType: string): string[] {
  const ruleSet = CITATION_RULES[sourceType];
  if (!ruleSet) return [];
  return ruleSet.components.filter((c) => c.required).map((c) => c.field);
}

export function getFieldFormat(
  sourceType: string,
  field: string,
): CitationComponent["format"] | undefined {
  const ruleSet = CITATION_RULES[sourceType];
  if (!ruleSet) return undefined;
  return ruleSet.components.find((c) => c.field === field)?.format;
}

export function getFieldRule(sourceType: string, field: string): string | undefined {
  const ruleSet = CITATION_RULES[sourceType];
  if (!ruleSet) return undefined;
  return ruleSet.components.find((c) => c.field === field)?.rule;
}

/** Returns the list of REQUIRED field keys that are missing/empty. */
export function validateCitation(
  sourceType: string,
  fields: Record<string, string | undefined>,
): string[] {
  const required = getRequiredFields(sourceType);
  return required.filter((f) => !fields[f]?.trim());
}
