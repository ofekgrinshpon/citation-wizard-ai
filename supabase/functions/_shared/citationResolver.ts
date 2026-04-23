/**
 * Citation Resolver (Deno-only) — Milestone C.
 *
 * Used by `legal-qa` Stage E.5 to validate Perplexity-completion candidates.
 * Replaces the brittle STATUTE_CITATION_RE Guard 1 with a structured engine
 * resolution. A candidate is "resolved" when:
 *   1. Classify    — declared Perplexity type ("statute"/"caselaw") maps to
 *                    one of 5 engine source types (basic_law / primary_leg /
 *                    secondary_leg / case_law_published / case_law_database).
 *   2. Extract     — regex extractors pull engine fields from the citation
 *                    text (ported field-for-field from src/lib/citationValidation.ts).
 *   3. Validate    — all REQUIRED fields for the chosen source type are
 *                    present and non-empty.
 *   4. Emit canonical — interpolate ruleSet.template with extracted values.
 *
 * Non-blocking: an unresolved candidate is NOT dropped here. The caller
 * (validatePerplexityCandidate in legal-qa/index.ts) keeps it because the
 * URL-allowlist guard already passed; it just flags engine_resolved=false.
 *
 * IMPORTANT: This logic does NOT exist in the React side. The React app
 * uses validateCitation directly on already-classified types. This file is
 * Deno-only and fully self-contained.
 */

import { CITATION_RULES, validateCitation } from "./citationEngine.ts";

export type EngineSourceType =
  | "primary_legislation"
  | "basic_law"
  | "secondary_legislation"
  | "case_law_published"
  | "case_law_database";

export type DeclaredType = "statute" | "caselaw";

export interface ResolveSuccess {
  resolved: true;
  sourceType: EngineSourceType;
  fields: Record<string, string>;
  /** Canonical citation re-emitted from the engine template. */
  canonical: string;
  missingFields: [];
}

export interface ResolveFailure {
  resolved: false;
  reason: "classify_failed" | "extract_failed" | "missing_required";
  missingFields: string[];
  partialFields: Record<string, string>;
  /** When reason=missing_required, the chosen sourceType is reported for telemetry. */
  attemptedType?: EngineSourceType;
}

export type ResolveResult = ResolveSuccess | ResolveFailure;

// ─── Classification regex (mirrors plan) ────────────────────────────
const BASIC_LAW_RE = /חוק[-\s]יסוד/;
const SECONDARY_LEG_RE = /\b(?:תקנות|צו|כללי)\b/;
const PUBLISHED_SERIES_RE = /פ["״]ד|פד["״]ע/;

/** Map Perplexity declared type → engine source type. Returns null if unknown. */
function classify(text: string, declared: DeclaredType): EngineSourceType | null {
  if (declared === "statute") {
    if (BASIC_LAW_RE.test(text)) return "basic_law";
    if (SECONDARY_LEG_RE.test(text)) return "secondary_legislation";
    return "primary_legislation";
  }
  if (declared === "caselaw") {
    if (PUBLISHED_SERIES_RE.test(text)) return "case_law_published";
    return "case_law_database";
  }
  return null;
}

// ─── Field extractors (ported from src/lib/citationValidation.ts) ──
// Behavior is intentionally identical to the React-side extractors for the
// 5 source types we support. Do not "improve" without porting back.

// Bare-section reference detector (e.g. "סעיף 17", "ס' 12(א)", "סעיפים 3-5")
const BARE_SECTION_RE = /^\s*(?:סעיפים?|ס['׳']\s*)\s*[\dא-ת()./\\\-–]+\s*$/;

function extractLegislation(text: string, titleHint?: string): Record<string, string> {
  const fields: Record<string, string> = {};
  // If the citation is just a bare section (no law name), pull law name from title
  const isBareSection = BARE_SECTION_RE.test(text);
  if (isBareSection && titleHint) {
    // Use the title's first segment-before-comma as the law name
    const titleMatch = titleHint.match(/^([^,]+)/);
    if (titleMatch) fields.lawName = titleMatch[1].trim();
    // Also try to pull year/collection from the title since the citation lacks them
    const titleYear = titleHint.match(/(הת[שׁש][א-ת]*["״׳][א-ת]["״׳]?[א-ת]?)/);
    if (titleYear) fields.hebrewYear = titleYear[1];
    const titleGreg = titleHint.match(/\b(\d{4})\b/);
    if (titleGreg) fields.gregorianYear = titleGreg[1];
    const titleColl = titleHint.match(/(ס["״]ח|ק["״]ת)/);
    if (titleColl) fields.collection = titleColl[1];
    const titlePage = titleHint.match(/(?:ס["״]ח|ק["״]ת)\s+(\d+)/);
    if (titlePage) fields.firstPage = titlePage[1];
    return fields;
  }
  // Law name = first segment before comma
  const lawMatch = text.match(/^([^,]+)/);
  if (lawMatch) fields.lawName = lawMatch[1].trim();
  // Hebrew year (התש... form)
  const hebrewYearMatch = text.match(/(הת[שׁש][א-ת]*["״׳][א-ת]["״׳]?[א-ת]?)/);
  if (hebrewYearMatch) fields.hebrewYear = hebrewYearMatch[1];
  // Gregorian year
  const gregMatch = text.match(/\b(\d{4})\b/);
  if (gregMatch) fields.gregorianYear = gregMatch[1];
  // Collection
  const collMatch = text.match(/(ס["״]ח|ק["״]ת)/);
  if (collMatch) fields.collection = collMatch[1];
  // First page (single number after collection)
  const pageMatch = text.match(/(?:ס["״]ח|ק["״]ת)\s+(\d+)/);
  if (pageMatch) fields.firstPage = pageMatch[1];
  return fields;
}

function extractBasicLaw(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  // For basic laws, lawName is everything after "חוק-יסוד:" and before the first comma
  const m = text.match(/חוק[-\s]יסוד\s*:?\s*([^,]+)/);
  if (m) fields.lawName = m[1].trim();
  // Reuse legislation patterns for the rest
  const rest = extractLegislation(text);
  if (rest.hebrewYear) fields.hebrewYear = rest.hebrewYear;
  if (rest.gregorianYear) fields.gregorianYear = rest.gregorianYear;
  if (rest.collection) fields.collection = rest.collection;
  if (rest.firstPage) fields.firstPage = rest.firstPage;
  return fields;
}

function extractSecondaryLeg(text: string): Record<string, string> {
  const fields = extractLegislation(text);
  // Rename lawName → regulationName to match the secondary_legislation schema
  if (fields.lawName) {
    fields.regulationName = fields.lawName;
    delete fields.lawName;
  }
  return fields;
}

function extractCaseLawCommon(
  text: string,
  caseNumberHint?: string,
): Record<string, string> {
  const fields: Record<string, string> = {};
  // Case type + number — same regex as React side
  const caseMatch = text.match(/([א-ת]{1,3}["״׳']+[א-ת]{1,2})\s+(\d+[/\-]\d+)/);
  if (caseMatch) {
    fields.caseType = caseMatch[1];
    fields.caseNumber = caseMatch[2];
  } else if (caseNumberHint) {
    // Fall back to the structured case_number field if Perplexity put it there
    const hintMatch = caseNumberHint.match(/([א-ת]{1,3}["״׳']+[א-ת]{1,2})\s+(\d+[/\-]\d+)/);
    if (hintMatch) {
      fields.caseType = hintMatch[1];
      fields.caseNumber = hintMatch[2];
    }
  }
  // Parties — bolded **X** OR plain "X נ' Y"
  const boldParties = [...text.matchAll(/\*\*([^*]+)\*\*/g)];
  if (boldParties.length >= 2) {
    fields.party1 = boldParties[0][1].trim();
    fields.party2 = boldParties[1][1].trim();
  } else {
    const plain = text.match(/([^\n,*]+?)\s+נ['׳']\s+([^\n,*(.]+)/);
    if (plain) {
      fields.party1 = plain[1].trim();
      fields.party2 = plain[2].trim();
    }
  }
  return fields;
}

function extractCaseLawPublished(
  text: string,
  caseNumberHint?: string,
): Record<string, string> {
  const fields = extractCaseLawCommon(text, caseNumberHint);
  // Series
  const seriesMatch = text.match(/(פ["״]ד|פד["״]ע|פ["״]מ)/);
  if (seriesMatch) fields.series = seriesMatch[1];
  // Volume (after series)
  const volMatch = text.match(/(?:פ["״]ד|פד["״]ע|פ["״]מ)\s+([א-ת]+|\d+)/);
  if (volMatch) fields.volume = volMatch[1];
  // First page (number after closing paren OR after volume)
  const pageMatch = text.match(/\)\s+(\d+)/) || text.match(/(?:פ["״]ד|פד["״]ע|פ["״]מ)\s+(?:[א-ת]+|\d+)\s+(\d+)/);
  if (pageMatch) fields.firstPage = pageMatch[1];
  // Year in parens
  const yearMatch = text.match(/\((\d{4})\)/);
  if (yearMatch) fields.year = yearMatch[1];
  return fields;
}

function extractCaseLawDatabase(
  text: string,
  caseNumberHint?: string,
  decisionDateHint?: string,
): Record<string, string> {
  const fields = extractCaseLawCommon(text, caseNumberHint);
  // Database name (optional per schema)
  if (/נבו/.test(text)) fields.database = "נבו";
  else if (/פדאור/.test(text)) fields.database = "פדאור";
  else if (/דינים/.test(text)) fields.database = "דינים";
  else if (/תקדין|takdin/i.test(text)) fields.database = "תקדין";
  // Full date — accept dd.mm.yyyy from text OR fall back to decisionDateHint
  const dateMatch = text.match(/(\d{1,2}\.\d{1,2}\.\d{4})/);
  if (dateMatch) fields.fullDate = dateMatch[1];
  else if (decisionDateHint) {
    const hintMatch = decisionDateHint.match(/(\d{1,2}\.\d{1,2}\.\d{4})/);
    if (hintMatch) fields.fullDate = hintMatch[1];
    else if (/^\d{4}-\d{2}-\d{2}$/.test(decisionDateHint.trim())) {
      // ISO yyyy-mm-dd → dd.mm.yyyy
      const [y, m, d] = decisionDateHint.trim().split("-");
      fields.fullDate = `${parseInt(d, 10)}.${parseInt(m, 10)}.${y}`;
    }
  }
  return fields;
}

// ─── Canonical emission ──────────────────────────────────────────
/**
 * Interpolate `template` placeholders `{field}` with `fields` values.
 * Missing placeholders collapse to empty, then we tidy stray whitespace
 * and dangling punctuation so a missing optional field doesn't leave a
 * lone comma or double-space.
 */
function emitCanonical(template: string, fields: Record<string, string>): string {
  let out = template.replace(/\{(\w+)\}/g, (_, k) => fields[k] ?? "");
  // Collapse whitespace
  out = out.replace(/[ \t]+/g, " ");
  // Remove sequences like ", ," or " ,," produced by missing optional fields
  out = out.replace(/,\s*,/g, ",");
  out = out.replace(/\(\s*,/g, "(");
  out = out.replace(/,\s*\)/g, ")");
  out = out.replace(/\(\s*\)/g, "");
  // Tidy spaces around punctuation
  out = out.replace(/\s+,/g, ",");
  out = out.replace(/\s+\./g, ".");
  out = out.replace(/\s+\)/g, ")");
  out = out.replace(/\(\s+/g, "(");
  // Remove repeated dots
  out = out.replace(/\.{2,}/g, ".");
  return out.trim();
}

// ─── Public API ──────────────────────────────────────────────────
export interface ResolveCitationOptions {
  /** Optional `case_number` field from the Perplexity candidate. */
  caseNumberHint?: string;
  /** Optional `decision_date` field (ISO or dd.mm.yyyy). */
  decisionDateHint?: string;
}

/**
 * Resolve a Perplexity-completion candidate into a structured citation.
 *
 * @param candidateText  The raw `citation` string returned by Perplexity.
 * @param declaredType   Perplexity's `type` field ("statute" | "caselaw").
 * @param opts           Extra hint fields (case_number, decision_date).
 */
export function resolveCitation(
  candidateText: string,
  declaredType: DeclaredType,
  opts: ResolveCitationOptions = {},
): ResolveResult {
  const text = (candidateText || "").trim();
  if (!text) {
    return {
      resolved: false,
      reason: "extract_failed",
      missingFields: [],
      partialFields: {},
    };
  }

  // 1) Classify
  const sourceType = classify(text, declaredType);
  if (!sourceType) {
    return {
      resolved: false,
      reason: "classify_failed",
      missingFields: [],
      partialFields: {},
    };
  }

  // 2) Extract
  let fields: Record<string, string>;
  switch (sourceType) {
    case "basic_law":
      fields = extractBasicLaw(text);
      break;
    case "secondary_legislation":
      fields = extractSecondaryLeg(text);
      break;
    case "primary_legislation":
      fields = extractLegislation(text);
      break;
    case "case_law_published":
      fields = extractCaseLawPublished(text, opts.caseNumberHint);
      break;
    case "case_law_database":
      fields = extractCaseLawDatabase(text, opts.caseNumberHint, opts.decisionDateHint);
      break;
  }

  if (Object.keys(fields).length === 0) {
    return {
      resolved: false,
      reason: "extract_failed",
      missingFields: [],
      partialFields: {},
      attemptedType: sourceType,
    };
  }

  // 3) Validate
  const missing = validateCitation(sourceType, fields);
  if (missing.length > 0) {
    return {
      resolved: false,
      reason: "missing_required",
      missingFields: missing,
      partialFields: fields,
      attemptedType: sourceType,
    };
  }

  // 4) Emit canonical
  const ruleSet = CITATION_RULES[sourceType];
  const canonical = emitCanonical(ruleSet.template, fields);

  return {
    resolved: true,
    sourceType,
    fields,
    canonical,
    missingFields: [],
  };
}
