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
  internet_comment: "internet_comment",
  religious: "religious",
  treaty: "treaty",
  regulation: "regulation",
  government_decision: "government_decision",
  expert_opinion: "expert_opinion",
  planning_plan: "planning_plan",
  collective_agreement: "collective_agreement",
  court_pleading: "court_pleading",
  encyclopedia_entry: "encyclopedia_entry",
  academic_work: "academic_work",
  correspondence: "correspondence",
  interview: "interview",
  lecture: "lecture",
  press_release: "press_release",
  film: "film",
  tv_show: "tv_show",
  radio: "radio",
  foreign: "foreign",
  foreign_constitution: "foreign_constitution",
  foreign_statute_us: "foreign_statute_us",
  foreign_statute_uk: "foreign_statute_uk",
  foreign_case_us: "foreign_case_us",
  foreign_case_other: "foreign_case_other",
  foreign_book: "foreign_book",
  foreign_journal_article: "foreign_journal_article",
  foreign_book_chapter: "foreign_book_chapter",
  foreign_internet: "foreign_internet",
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
  /** The source type actually used for validation (may differ from input after inference) */
  effectiveSourceType?: SourceType;
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
  const citationLine = getCitationLine(response);
  const hasTrustedLegislationPage = (
    sourceType === "primary_legislation" ||
    sourceType === "basic_law" ||
    sourceType === "secondary_legislation"
  ) && /(?:ס["״]ח|ק["״]ת)\s+\d+/.test(citationLine);

  // Case law patterns
  if (sourceType === "case_law_published" || sourceType === "case_law_database") {
    // Case type + number: e.g., ע"א 248/86, רע"פ 9142/01, בג"ץ 1514/01
    const caseMatch = response.match(/([א-ת]{1,3}["״׳']+[א-ת]{1,2})\s+(\d+[\/\-]\d+)/);
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
    // Database name (Rule 19.1 + extended canonical names from source URLs)
    if (/נבו/.test(response)) fields.database = "נבו";
    else if (/תקדין/.test(response)) fields.database = "תקדין";
    else if (/אר["״\u05F4]ש/.test(response)) fields.database = "אר\u05F4ש";
    else if (/פדאור/.test(response)) fields.database = "פדאור";
    else if (/דינים/.test(response)) fields.database = "דינים";
    else if (/פסקדין/.test(response)) fields.database = "פסקדין";
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
    const hebrewYearMatch = response.match(/(הת[שׁש][א-ת]*["״׳][א-ת]["״׳]?[א-ת]?)/);
    if (hebrewYearMatch) fields.hebrewYear = hebrewYearMatch[1];
    // Gregorian year
    const gregMatch = response.match(/(\d{4})/);
    if (gregMatch) fields.gregorianYear = gregMatch[1];
    // Collection (ס"ח / ק"ת)
    const collMatch = response.match(/(ס["״]ח|ק["״]ת)/);
    if (collMatch) fields.collection = collMatch[1];
    // First page — single number right after collection name (Rule 2.8)
    const pageMatch = response.match(/(?:ס["״]ח|ק["״]ת)\s+(\d+)/);
    if (pageMatch) fields.firstPage = pageMatch[1];
  }

  // Book patterns
  if (sourceType === "book") {
    const authorMatch = response.match(/^([^*"]+?)\s+\*\*/);
    if (authorMatch) fields.author = authorMatch[1].trim();
    const titleMatch = response.match(/\*\*([^*]+)\*\*/);
    if (titleMatch) fields.bookTitle = titleMatch[1];
    const yearMatch = response.match(/\((?:[^)]*?)(\d{4}|הת[שׁש][א-ת]*["״׳][א-ת]["״׳]?[א-ת]?)\)$/);
    if (yearMatch) fields.year = yearMatch[1];
    // Volume (כרך)
    const volMatch = response.match(/כרך\s+([א-ת]+|\d+)/);
    if (volMatch) fields.volume = volMatch[1];
    // Edition (מהדורה)
    const editionMatch = response.match(/מהדורה\s+[^\s),]+(?:\s+[^\s),]+)*/);
    if (editionMatch) fields.edition = editionMatch[0];
    // Editor (עורך/עורכת/עורכים/עורכות)
    const editorMatch = response.match(/([^,(]+?)\s+עורכ(?:ת|ים|ות|)/);
    if (editorMatch) fields.editor = editorMatch[0].trim();
    // Translator (מתרגם/מתרגמת/מתרגמים/מתרגמות)
    const translatorMatch = response.match(/([^,(]+?)\s+מתרגמ(?:ת|ים|ות|)/);
    if (translatorMatch) fields.translator = translatorMatch[0].trim();
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
    const pageMatch = response.match(/\*\*[^*]+\*\*\s+(?:[א-ת]+|\d+)\s*(?:\([^)]+\))?\s+(\d+)/);
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

  // Government decision (כלל 15) patterns
  if (sourceType === "government_decision") {
    // Deciding body
    const bodyMatch = response.match(/(?:של\s+)([^\s"][^\n"]+?)(?:\s*")/);
    if (bodyMatch) fields.decidingBody = bodyMatch[1].trim();
    // Decision name in quotes
    const nameMatch = response.match(/"([^"]+)"/);
    if (nameMatch) fields.decisionName = nameMatch[1];
    // Decision number (optional)
    const numMatch = response.match(/החלטה\s+(\d+(?:\s*\([^)]+\))?)/);
    if (numMatch) fields.decisionNumber = numMatch[1];
    // Full date
    const dateMatch = response.match(/\((\d{1,2}\.\d{1,2}\.\d{4})\)/);
    if (dateMatch) fields.fullDate = dateMatch[1];
  }

  // Expert opinion (חוות דעת) patterns
  if (sourceType === "expert_opinion") {
    // Opinion name in quotes
    const nameMatch = response.match(/"([^"]+)"/);
    if (nameMatch) fields.opinionName = nameMatch[1];
    // Author after "חוות דעת של"
    const authorMatch = response.match(/חוות דעת של\s+([^\d(]+?)(?:\s+\d{1,2}\.\d{1,2}\.\d{4}|\s*\()/);
    if (authorMatch) fields.opinionAuthor = authorMatch[1].trim();
    // Full date
    const dateMatch = response.match(/(\d{1,2}\.\d{1,2}\.\d{4})/);
    if (dateMatch) fields.fullDate = dateMatch[1];
    // Opinion number (16.4)
    const numMatch = response.match(/חוות דעת\s+(\d+\/\d+|\d+)/);
    if (numMatch) fields.opinionNumber = numMatch[1];
  }

  // Planning plan (כלל 17.1) patterns
  if (sourceType === "planning_plan") {
    // Plan number
    const numMatch = response.match(/תכנית\s+מפורטת\s+([^\s]+)/);
    if (numMatch) fields.planNumber = numMatch[1];
    // Deciding body (committee name after "של")
    const bodyMatch = response.match(/של\s+([^\s"][^\n"]+?)(?:\s*")/);
    if (bodyMatch) fields.decidingBody = bodyMatch[1].trim();
    // Plan name in quotes
    const nameMatch = response.match(/"([^"]+)"/);
    if (nameMatch) fields.decisionName = nameMatch[1];
    // Date/year
    const dateMatch = response.match(/\((\d{1,2}\.\d{1,2}\.\d{4}|\d{4})\)/);
    if (dateMatch) fields.fullDate = dateMatch[1];
  }

  // Collective agreement (כלל 17.2) patterns
  if (sourceType === "collective_agreement") {
    // Agreement number
    const numMatch = response.match(/הסכם\s+קיבוצי\s+מס['׳']?\s*(\S+)/);
    if (numMatch) fields.agreementNumber = numMatch[1];
    // Party 1 (between "בין" and "ל")
    const party1Match = response.match(/בין\s+(.+?)\s+ל(?!עניין)/);
    if (party1Match) fields.party1 = party1Match[1].trim();
    // Party 2 (between "ל" and "בעניין")
    const party2Match = response.match(/\sל(.+?)\s+בעניין/);
    if (party2Match) fields.party2 = party2Match[1].trim();
    // Subject (after "בעניין")
    const subjectMatch = response.match(/בעניין\s+(.+?)\s*\(/);
    if (subjectMatch) fields.agreementSubject = subjectMatch[1].trim();
    // Date
    const dateMatch = response.match(/\((\d{1,2}\.\d{1,2}\.\d{4})\)/);
    if (dateMatch) fields.fullDate = dateMatch[1];
  }

  // Court pleading (כתב טענות) patterns
  if (sourceType === "court_pleading") {
    // Pleading title: text between "ל" and "ב" + case type, or starts with כתב/טיעונים/סיכומים/בקשה
    const titleMatch = response.match(/(?:ל(כתב[^\n]+?|טיעונים[^\n]+?|סיכומים[^\n]+?|בקשה[^\n]+?)\s+ב)|^(כתב\s+\S+|טיעונים\s+\S+|סיכומים\s+\S+)/);
    if (titleMatch) fields.pleadingTitle = (titleMatch[1] || titleMatch[2] || "").trim();
    // Also detect standalone pleading title at start
    if (!fields.pleadingTitle) {
      const standaloneMatch = response.match(/^(?:ס['׳']\s*\d+\s*ל)?(כתב\s+\S+|טיעונים[^\n]*?|סיכומים[^\n]*?)(?:\s+ב(?:[א-ת]["״׳']+[א-ת]))/);
      if (standaloneMatch) fields.pleadingTitle = standaloneMatch[1].trim();
    }
    // Case type + number
    const caseMatch = response.match(/([א-ת]{1,3}["״׳']+[א-ת]{1,2})\s+(\d+[\/\-]\d+)/);
    if (caseMatch) {
      fields.caseType = caseMatch[1];
      fields.caseNumber = caseMatch[2];
    }
    // Parties
    const partyMatch = response.match(/(\S+)\s+נ['׳']\s+(\S+)/);
    if (partyMatch) {
      fields.party1 = partyMatch[1];
      fields.party2 = partyMatch[2];
    }
    // Full date
    const dateMatch = response.match(/(\d{1,2}\.\d{1,2}\.\d{4})/);
    if (dateMatch) fields.fullDate = dateMatch[1];
  }

  // Regulation (תקנון) patterns
  if (sourceType === "regulation") {
    // Regulation name after "ל"
    const nameMatch = response.match(/ל(תקנון[^\s(,]+(?:\s+[^\s(,]+)*|תקשי"ר)/);
    if (nameMatch) fields.regulationName = nameMatch[1];
    // Full date in parentheses
    const dateMatch = response.match(/\((\d{1,2}\.\d{1,2}\.\d{4})\)/);
    if (dateMatch) fields.fullDate = dateMatch[1];
  }

  // Treaty patterns
  if (sourceType === "treaty") {
    // Treaty name
    const nameMatch = response.match(/^(?:ס['׳']\s*\d+\s*ל)?(.+?),\s*כ["״]א/);
    if (nameMatch) fields.treatyName = nameMatch[1].trim();
    // Volume (כ"א number)
    const volMatch = response.match(/כ["״]א\s+(\d+)/);
    if (volMatch) fields.volume = volMatch[1];
    // First page
    const pageMatch = response.match(/כ["״]א\s+\d+(?:\(\d+\))?,\s*(\d+)/);
    if (pageMatch) fields.firstPage = pageMatch[1];
    // Signing type and year
    if (/נפתחה לחתימה ב-/.test(response)) fields.signingType = "multilateral";
    if (/נחתמה ב-/.test(response)) fields.signingType = "bilateral";
    const yearMatch = response.match(/(?:נפתחה לחתימה|נחתמה) ב-(\d{4})/);
    if (yearMatch) fields.signingYear = yearMatch[1];
  }

  // Check for [חסר:...] markers — these mean the field is explicitly missing
  const missingMarkers = [...response.matchAll(/\[חסר:\s*([^\]]+)\]/g)];
  for (const marker of missingMarkers) {
    const desc = marker[1].toLowerCase();
    if (
      desc.includes("עמוד") ||
      desc.includes("ס\"ח") ||
      desc.includes("ס״ח") ||
      desc.includes("ק\"ת") ||
      desc.includes("ק״ת")
    ) {
      if (!(hasTrustedLegislationPage && fields.firstPage)) delete fields.firstPage;
    }
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

function getCitationLine(response: string): string {
  return response
    .split("\n")
    .map(line => line.trim())
    .find(line => line && !/^📐/.test(line) && !/^⚠️/.test(line)) || response.trim();
}

const JOURNAL_NAME_RE = /משפטים|עיוני משפט|הפרקליט|מחקרי משפט|דין ודברים|משפט וממשל|משפט ועסקים|חוקים|תיאוריה וביקורת|המשפט|עלי משפט|מאזני משפט|רפואה ומשפט|ביטחון סוציאלי|הארת דין|משפט וצבא/;

/**
 * Infer the actual rendered citation type from its text. Used to stop the
 * validator from running book rules (23.x) against an article output and vice
 * versa when the upstream sourceType disagrees with what was rendered.
 */
export function inferSourceTypeFromCitation(
  citationLine: string,
  fallback: SourceType,
): SourceType {
  if (!citationLine) return fallback;
  // article-in-book: explicit "בתוך" connector
  if (/"\s*בתוך\s+/.test(citationLine) || /"\s+בתוך\s+/.test(citationLine)) {
    return "article_in_book";
  }
  // journal article: quoted title + journal-ish token + volume + page + (year)
  const hasQuotedTitle = /["'״׳][^"'״׳\n]{2,}["'״׳]/.test(citationLine);
  const hasYear = /\(\s*\d{4}\s*\)/.test(citationLine);
  const hasJournalName = JOURNAL_NAME_RE.test(citationLine);
  const hasVolumePage = /["'״׳]\s+[^,(]{2,}?\s+[\u05D0-\u05EAא-ת0-9]+(?:\(\d+\))?\s+\d+\s*\(\d{4}\)/.test(citationLine);
  if (hasQuotedTitle && hasYear && (hasJournalName || hasVolumePage)) {
    return "article";
  }
  return fallback;
}

type OtherSubtype = "knesset" | "provisional_council";

const OTHER_MISSING_FIELD_LABELS: Record<string, string> = {
  volumeHebrew: "כרך באותיות עבריות (כלל 8.2)",
  sessionNumber: "מספר ישיבה (כלל 8.2)",
  page: "עמוד",
  fullDate: "תאריך לועזי מלא",
};

function detectOtherSubtype(response: string): OtherSubtype | null {
  const citationLine = getCitationLine(response);
  if (/מועצת המדינה(?:\s+הזמנית)?/.test(citationLine)) return "provisional_council";
  if (/ד["״]כ|דברי הכנסת|דברי כנסת/.test(citationLine)) return "knesset";
  return null;
}

function validateOtherResponse(response: string): string[] {
  const citationLine = getCitationLine(response);
  const subtype = detectOtherSubtype(response);
  if (!subtype) return [];

  if (subtype === "knesset") {
    const missingFields: string[] = [];
    const hasFullDate = /\d{1,2}\.\d{1,2}\.\d{4}/.test(citationLine) && !/\[חסר:\s*תאריך/i.test(citationLine);
    const hasPage = /,\s*\d+\s*\.?$/.test(citationLine) && !/\[חסר:\s*עמוד/i.test(citationLine);

    if (!hasFullDate) missingFields.push("fullDate");
    if (!hasPage) missingFields.push("page");

    return missingFields;
  }

  const missingFields: string[] = [];
  const hasVolume = /מועצת המדינה(?:\s+הזמנית)?\s+[א-ת]+/.test(citationLine) && !/\[חסר:\s*כרך/i.test(citationLine);
  const hasSession = /ישיבה\s+[א-ת0-9]+/.test(citationLine) && !/\[חסר:\s*מספר ישיבה/i.test(citationLine);
  const pageMatch = citationLine.match(/ישיבה\s+[א-ת0-9]+,\s*(\d+)\s*\(/);
  const pageValue = pageMatch?.[1] ?? "";
  const citationYear = citationLine.match(/\((?:\d{1,2}\.\d{1,2}\.)?(\d{4})\)/)?.[1] ?? "";
  const looksLikeYearInsteadOfPage = /^(19|20)\d{2}$/.test(pageValue) || (Boolean(citationYear) && pageValue === citationYear);
  const hasPage = Boolean(pageValue) && !/\[חסר:\s*עמוד/i.test(citationLine) && !looksLikeYearInsteadOfPage;
  const hasFullDate = /\(\d{1,2}\.\d{1,2}\.\d{4}\)/.test(citationLine) && !/\[חסר:\s*תאריך לועזי מלא/i.test(citationLine);

  if (!hasVolume) missingFields.push("volumeHebrew");
  if (!hasSession) missingFields.push("sessionNumber");
  if (!hasPage) missingFields.push("page");
  if (!hasFullDate) missingFields.push("fullDate");

  return missingFields;
}

/**
 * Validate an AI-generated citation against the engine's rules.
 * Returns completeness info, missing fields, and rule metadata.
 */
export function validateAIResponse(
  response: string,
  sourceType: SourceType
): CitationValidationResult {
  // Skip validation for repeated citations (לעיל ה"ש / שם)
  if (/לעיל ה["״'׳]?ש/.test(response) || /^שם([.,\s]|$)/.test(response.trim())) {
    const ruleSet = getRuleSet(sourceType);
    return {
      isComplete: true,
      missingFields: [],
      primaryRule: ruleSet?.primaryRule || "",
      ruleTitle: ruleSet?.ruleTitle || RULE_REFERENCES[sourceType] || "",
      template: ruleSet?.template || "",
      ruleSet: ruleSet || null,
    };
  }

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

  if (sourceType === "other") {
    const otherSubtype = detectOtherSubtype(response);
    if (otherSubtype) {
      const missingFields = validateOtherResponse(response);
      const isProvisionalCouncil = otherSubtype === "provisional_council";

      return {
        isComplete: missingFields.length === 0,
        missingFields,
        primaryRule: isProvisionalCouncil ? "8.2" : "8",
        ruleTitle: isProvisionalCouncil ? "כלל 8.2 – מועצת המדינה הזמנית" : "כלל 8 – דברי כנסת",
        template: isProvisionalCouncil
          ? "מועצת המדינה הזמנית {כרך באותיות עבריות}, ישיבה {מספר ישיבה}, {עמוד} ({תאריך לועזי מלא})."
          : 'ד"כ {תאריך לועזי מלא}, {עמוד}.',
        ruleSet,
      };
    }

    // Rule-15 decision shape rendered under the generic "אחר" type
    // (e.g. החלטה 40 של הכנסת "כינון חוקה לישראל" (13.6.1950)).
    // Validate it against the government-decision rule set instead of the
    // generic `other` engine, whose synthetic `citation` field is never
    // extracted and therefore always reported as missing.
    if (looksLikeGovernmentDecision(response)) {
      const decisionRuleSet = getRuleSet("government_decision") || ruleSet;
      const decisionFields = extractFieldsFromResponse(response, "government_decision");
      const missingFields = validateCitation("government_decision", decisionFields);
      return {
        isComplete: missingFields.length === 0,
        missingFields,
        primaryRule: decisionRuleSet.primaryRule,
        ruleTitle: decisionRuleSet.ruleTitle,
        template: decisionRuleSet.template,
        ruleSet: decisionRuleSet,
        effectiveSourceType: "government_decision",
      };
    }
  }

  // Infer the actual rendered type from the citation line so we don't validate
  // an article output against book rules (or vice versa) when the upstream
  // sourceType disagrees with what was actually rendered.
  const citationLine = getCitationLine(response);
  const effectiveType = inferSourceTypeFromCitation(citationLine, sourceType);
  const effectiveRuleSet = getRuleSet(effectiveType) || ruleSet;

  const engineKey = ENGINE_KEY_MAP[effectiveType] || ENGINE_KEY_MAP[sourceType];
  const extractedFields = extractFieldsFromResponse(response, effectiveType);
  // The generic `other` engine has a single synthetic required component named
  // `citation` that no extractor ever fills. Never report it as missing.
  if (engineKey === "other") {
    return {
      isComplete: true,
      missingFields: [],
      primaryRule: effectiveRuleSet.primaryRule,
      ruleTitle: effectiveRuleSet.ruleTitle,
      template: effectiveRuleSet.template,
      ruleSet: effectiveRuleSet,
      effectiveSourceType: effectiveType,
    };
  }
  const missingFields = validateCitation(engineKey, extractedFields);


  return {
    isComplete: missingFields.length === 0,
    missingFields,
    primaryRule: effectiveRuleSet.primaryRule,
    ruleTitle: effectiveRuleSet.ruleTitle,
    template: effectiveRuleSet.template,
    ruleSet: effectiveRuleSet,
    effectiveSourceType: effectiveType,
  };
}

/**
 * Generate a human-readable summary of what's missing in a citation.
 */
export function getMissingFieldsSummary(
  sourceType: SourceType,
  missingFields: string[]
): string {
  if (missingFields.length === 0) return "";

  if (sourceType === "other") {
    const descriptions = missingFields.map(field => OTHER_MISSING_FIELD_LABELS[field] || field);
    return `חסרים ${descriptions.length} רכיבי חובה: ${descriptions.join("، ")}`;
  }

  const ruleSet = getRuleSet(sourceType);
  if (!ruleSet) return "";

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
