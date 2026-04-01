/**
 * Citation Validation Bridge
 * 
 * Connects citationEngine.ts to the chat flow — provides post-AI validation,
 * rule metadata extraction, and missing-field analysis.
 */

import { CITATION_RULES, type CitationRuleSet, validateCitation, getRequiredFields } from "@/data/citationEngine";
import { type SourceType, RULE_REFERENCES } from "@/data/abbreviations";

// Map abbreviation.ts source types to citationEngine keys
const ENGINE_KEY_MAP: Record<SourceType, string> = {
  case_law_published: "case_law_published",
  case_law_database: "case_law_database",
  primary_legislation: "primary_legislation",
  basic_law: "basic_law",
  secondary_legislation: "secondary_legislation",
  bill: "bill",
  book: "book",
  article: "article",
  article_in_book: "article_in_book",
  internet: "internet",
  religious: "religious",
  foreign: "foreign",
  other: "other",
  unknown: "",
};

export interface CitationValidationResult {
  /** Whether the citation passes all required field checks */
  isComplete: boolean;
  /** List of missing required field keys */
  missingFields: string[];
  /** The primary rule governing this source type */
  primaryRule: string;
  /** Human-readable rule title */
  ruleTitle: string;
  /** The canonical template for this source type */
  template: string;
  /** The rule set details (null if unknown type) */
  ruleSet: CitationRuleSet | null;
}

/**
 * Get the citation engine rule set for a detected source type.
 */
export function getRuleSet(sourceType: SourceType): CitationRuleSet | null {
  const key = ENGINE_KEY_MAP[sourceType];
  if (!key) return null;
  return CITATION_RULES[key] || null;
}

/**
 * Get the enhanced rule reference string using the engine.
 * Falls back to the old RULE_REFERENCES if not found in engine.
 */
export function getEngineRuleReference(sourceType: SourceType): string {
  const ruleSet = getRuleSet(sourceType);
  if (ruleSet) return ruleSet.ruleTitle;
  return RULE_REFERENCES[sourceType] || "";
}

/**
 * Extract field values from an AI response by pattern matching.
 * Returns a partial map of detected fields.
 */
function extractFieldsFromResponse(response: string, sourceType: SourceType): Record<string, string | undefined> {
  const fields: Record<string, string | undefined> = {};

  // Case law patterns
  if (sourceType === "case_law_published" || sourceType === "case_law_database") {
    // Case type + number: e.g., ע"א 248/86
    const caseMatch = response.match(/([א-ת]["״][א-ת])\s+(\d+\/\d+)/);
    if (caseMatch) {
      fields.caseType = caseMatch[1];
      fields.caseNumber = caseMatch[2];
    }
    // Parties (bold): **name**
    const partyMatches = [...response.matchAll(/\*\*([^*]+)\*\*/g)];
    if (partyMatches.length >= 1) fields.party1 = partyMatches[0][1];
    if (partyMatches.length >= 2) fields.party2 = partyMatches[1][1];
    // Year in parentheses
    const yearMatch = response.match(/\((\d{4})\)/);
    if (yearMatch) fields.year = yearMatch[1];
  }

  if (sourceType === "case_law_published") {
    // Series (פ"ד, פד"ע)
    const seriesMatch = response.match(/(פ["״]ד|פד["״]ע|פ["״]מ)/);
    if (seriesMatch) fields.series = seriesMatch[1];
    // Volume
    const volMatch = response.match(/(?:פ["״]ד|פד["״]ע|פ["״]מ)\s+([א-ת]+|\d+)/);
    if (volMatch) fields.volume = volMatch[1];
    // First page
    const pageMatch = response.match(/\)\s+(\d+)/);
    if (pageMatch) fields.firstPage = pageMatch[1];
  }

  if (sourceType === "case_law_database") {
    // Database name
    if (/נבו/.test(response)) fields.database = "נבו";
    else if (/פדאור/.test(response)) fields.database = "פדאור";
    // Full date
    const dateMatch = response.match(/(\d{1,2}\.\d{1,2}\.\d{4})/);
    if (dateMatch) fields.fullDate = dateMatch[1];
  }

  // Legislation patterns
  if (sourceType === "primary_legislation" || sourceType === "basic_law" || sourceType === "secondary_legislation") {
    // Law name (first segment before comma)
    const lawMatch = response.match(/^([^,]+)/);
    if (lawMatch) fields.lawName = lawMatch[1].trim();
    // Hebrew year
    const hebrewYearMatch = response.match(/(הת[שׁ]["״׳][א-ת]["״׳]?[א-ת]?)/);
    if (hebrewYearMatch) fields.hebrewYear = hebrewYearMatch[1];
    // Gregorian year
    const gregMatch = response.match(/(\d{4})/);
    if (gregMatch) fields.gregorianYear = gregMatch[1];
    // Collection (ס"ח / ק"ת)
    const collMatch = response.match(/(ס["״]ח|ק["״]ת)/);
    if (collMatch) fields.collection = collMatch[1];
    // First page after collection + number
    const pageMatch = response.match(/(?:ס["״]ח|ק["״]ת)\s+\d+[,\s]+(\d+)/);
    if (pageMatch) fields.firstPage = pageMatch[1];
  }

  // Book patterns
  if (sourceType === "book") {
    const authorMatch = response.match(/^([^*"]+?)\s+\*\*/);
    if (authorMatch) fields.author = authorMatch[1].trim();
    const titleMatch = response.match(/\*\*([^*]+)\*\*/);
    if (titleMatch) fields.bookTitle = titleMatch[1];
    const yearMatch = response.match(/\((?:[^)]*?)(\d{4})\)/);
    if (yearMatch) fields.year = yearMatch[1];
  }

  // Article patterns
  if (sourceType === "article") {
    const authorMatch = response.match(/^([^"]+?)\s+"/);
    if (authorMatch) fields.author = authorMatch[1].trim();
    const articleMatch = response.match(/"([^"]+)"/);
    if (articleMatch) fields.articleTitle = articleMatch[1];
    const journalMatch = response.match(/\*\*([^*]+)\*\*/);
    if (journalMatch) fields.journalName = journalMatch[1];
    const volMatch = response.match(/\*\*[^*]+\*\*\s+([א-ת]+|\d+)/);
    if (volMatch) fields.volume = volMatch[1];
    const pageMatch = response.match(/\*\*[^*]+\*\*\s+(?:[א-ת]+|\d+)\s+(\d+)/);
    if (pageMatch) fields.firstPage = pageMatch[1];
    const yearMatch = response.match(/\((\d{4})\)/);
    if (yearMatch) fields.year = yearMatch[1];
  }

  // Internet
  if (sourceType === "internet") {
    if (/https?:\/\//.test(response)) fields.url = "present";
    const siteMatch = response.match(/\*\*([^*]+)\*\*/);
    if (siteMatch) fields.siteName = siteMatch[1];
    const titleMatch = response.match(/"([^"]+)"/);
    if (titleMatch) fields.title = titleMatch[1];
    if (/נדלה ביום/.test(response)) fields.accessDate = "present";
  }

  // Check for [חסר:...] markers — these mean the field is explicitly missing
  const missingMarkers = [...response.matchAll(/\[חסר:\s*([^\]]+)\]/g)];
  for (const marker of missingMarkers) {
    const desc = marker[1].toLowerCase();
    if (desc.includes("עמוד") || desc.includes("ס\"ח")) delete fields.firstPage;
    if (desc.includes("כרך")) delete fields.volume;
    if (desc.includes("שנה עברית")) delete fields.hebrewYear;
    if (desc.includes("שנה")) delete fields.year;
    if (desc.includes("מאגר")) delete fields.database;
    if (desc.includes("תאריך")) delete fields.fullDate;
    if (desc.includes("צד") || desc.includes("מערער") || desc.includes("עותר")) delete fields.party1;
    if (desc.includes("משיב")) delete fields.party2;
    if (desc.includes("תיק")) delete fields.caseNumber;
  }

  return fields;
}

/**
 * Validate an AI-generated citation against the engine's rules.
 * Returns completeness info, missing fields, and rule metadata.
 */
export function validateAIResponse(
  response: string,
  sourceType: SourceType
): CitationValidationResult {
  const ruleSet = getRuleSet(sourceType);

  if (!ruleSet) {
    return {
      isComplete: true,
      missingFields: [],
      primaryRule: "",
      ruleTitle: RULE_REFERENCES[sourceType] || "",
      template: "",
      ruleSet: null,
    };
  }

  const engineKey = ENGINE_KEY_MAP[sourceType];
  const extractedFields = extractFieldsFromResponse(response, sourceType);
  const missingFields = validateCitation(engineKey, extractedFields);

  return {
    isComplete: missingFields.length === 0,
    missingFields,
    primaryRule: ruleSet.primaryRule,
    ruleTitle: ruleSet.ruleTitle,
    template: ruleSet.template,
    ruleSet,
  };
}

/**
 * Generate a human-readable summary of what's missing in a citation.
 */
export function getMissingFieldsSummary(
  sourceType: SourceType,
  missingFields: string[]
): string {
  const ruleSet = getRuleSet(sourceType);
  if (!ruleSet || missingFields.length === 0) return "";

  const descriptions = missingFields.map(field => {
    const component = ruleSet.components.find(c => c.field === field);
    return component ? `${component.description} (כלל ${component.rule})` : field;
  });

  return `חסרים ${descriptions.length} רכיבי חובה: ${descriptions.join("، ")}`;
}

/**
 * Build a structured prompt enhancement for the AI based on the detected source type.
 * This injects the engine's template and required fields into the prompt.
 */
export function buildEnginePromptHint(sourceType: SourceType): string {
  const ruleSet = getRuleSet(sourceType);
  if (!ruleSet) return "";

  const requiredFields = ruleSet.components
    .filter(c => c.required)
    .map(c => `• ${c.description} (כלל ${c.rule})`)
    .join("\n");

  const formatNotes = ruleSet.components
    .filter(c => c.format && c.format !== "plain")
    .map(c => {
      const fmt = c.format === "bold" ? "מודגש" : c.format === "quotes" ? "מירכאות" : c.format === "italic" ? "הטייה" : c.format === "brackets" ? "סוגריים מרובעים" : "";
      return `• ${c.description}: ${fmt}`;
    })
    .join("\n");

  let hint = `\n══ מנוע אזכור (${ruleSet.ruleTitle}) ══\n`;
  hint += `תבנית: ${ruleSet.template}\n`;
  hint += `דוגמה: ${ruleSet.example}\n`;
  hint += `\nרכיבי חובה:\n${requiredFields}\n`;
  if (formatNotes) {
    hint += `\nעיצוב:\n${formatNotes}\n`;
  }
  if (ruleSet.notes?.length) {
    hint += `\nהערות:\n${ruleSet.notes.map(n => `• ${n}`).join("\n")}\n`;
  }
  hint += `══════════════════════════════════\n`;

  return hint;
}
