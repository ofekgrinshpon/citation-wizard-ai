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
  "1.10": { title: "טווחי מספרים", description: "בעברית: טווח מימין לשמאל." },
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
      { field: "database", rule: "19.1", description: "שם המאגר (אופציונלי)", required: false, format: "plain" },
      { field: "fullDate", rule: "19.1", description: "תאריך פרסום מלא", required: true, format: "plain" },
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
