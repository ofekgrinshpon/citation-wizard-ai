/** Rule explanations for tooltip display */
export const RULE_EXPLANATIONS: Record<string, string> = {
  // General rules
  "1.3": "כלל 1.3: עיצוב טקסט – הדגשה, הטייה וקו תחתון",
  "1.9": "כלל 1.9: פיסוק – פסיקים בין רכיבים, נקודה בסוף האזכור",
  "1.10": "כלל 1.10: טווחי מספרים נכתבים מימין לשמאל",

  // Legislation
  "2": "כלל 2: אזכור חקיקה ראשית",
  "2.1": "כלל 2.1: רכיבי אזכור חקיקה ראשית",
  "2.7": "כלל 2.7: שנת קובץ לחוקי יסוד",
  "4": "כלל 4: חוקי יסוד",
  "4.3": "כלל 4.3: חוק-יסוד נכתב עם מקף",
  "4.5": "כלל 4.5: [נוסח חדש] בסוגריים מרובעים",
  "4.6": "כלל 4.6: [נוסח משולב] בסוגריים מרובעים",
  "6": "כלל 6: אזכור חקיקת משנה",
  "8": "כלל 8: הצעות חוק",

  // Case law
  "18": "כלל 18: אזכור פסיקה שפורסמה בדפוס",
  "18.2": "כלל 18.2: מספר התיק – סוג ההליך ומספרו",
  "18.3": "כלל 18.3: ערכאה – אין לציין מיקום ביהמ״ש העליון; יש לציין לבתי משפט אחרים",
  "18.4": "כלל 18.4: שמות הצדדים – מודגשים, ללא תוארים",
  "18.5": "כלל 18.5: הפרדת צדדים עם 'נ׳' מודגש",
  "18.6": "כלל 18.6: סדרה, כרך ועמוד ראשון",
  "18.7": "כלל 18.7: שנת פרסום פסק הדין",
  "19": "כלל 19: פסיקה ממאגר מידע (נבו/פדאור)",
  "19.1": "כלל 19.1: ציון שם המאגר ותאריך מלא",

  // Literature
  "23": "כלל 23: אזכור ספרים",
  "23.1": "כלל 23.1: שם המחבר",
  "23.2": "כלל 23.2: שם הספר – מודגש",
  "23.9": "כלל 23.9: שנת פרסום הספר",
  "25": "כלל 25: מאמרים בכתבי עת",
  "25.1": "כלל 25.1: שם המחבר של מאמר",
  "25.2": "כלל 25.2: שם המאמר – בין מירכאות",
  "25.3": "כלל 25.3: שם כתב העת – מודגש",

  // Internet & other
  "30": "כלל 30: מקורות מהמרשתת",
  "32": "כלל 32: מקורות דתיים",
  "36": "כלל 36: מקורות לועזיים (לפי Bluebook)",
};

/**
 * Citation part patterns for contextual tooltips.
 * Each pattern matches a segment of a citation and maps it to a rule.
 * Ordered by specificity – first match wins.
 */
export interface CitationPartRule {
  pattern: RegExp;
  ruleKey: string;
  label: string;
}

/**
 * Which rule hints fit a citation line. Israeli rule hints describe Israeli
 * sources only, and the year hint (18.7) describes Israeli case law only.
 * - israeli_case_law: every hint
 * - israeli_other: every hint except the case-law year (18.7)
 * - foreign: only the foreign-source hint (36)
 */
export type TooltipScope = "israeli_case_law" | "israeli_other" | "foreign";

const HEBREW_RE = /[\u0590-\u05FF]/;
const LATIN_RE = /[A-Za-z]/;
const ISRAELI_CASE_LINE_RE = /[א-ת]{1,3}["״][א-ת]\s*\d+\/\d+|פ["״]ד|נבו|פדאור|\sנ['׳]\s|\sנגד\s/;

/** Scope from the detected source type when known; otherwise from the line itself. */
export function tooltipScopeFor(sourceType: string | undefined, line: string): TooltipScope {
  if (sourceType && sourceType !== "unknown") {
    if (sourceType === "foreign" || sourceType.startsWith("foreign_")) return "foreign";
    return sourceType === "case_law_published" || sourceType === "case_law_database" ? "israeli_case_law" : "israeli_other";
  }
  const plain = line.replace(/\*\*|##|\^\^/g, "");
  if (LATIN_RE.test(plain) && !HEBREW_RE.test(plain)) return "foreign";
  return ISRAELI_CASE_LINE_RE.test(plain) ? "israeli_case_law" : "israeli_other";
}

/** The part rules allowed in a scope. */
export function citationPartRulesFor(scope: TooltipScope): CitationPartRule[] {
  if (scope === "foreign") return CITATION_PART_RULES.filter((r) => r.ruleKey === "36");
  if (scope === "israeli_other") return CITATION_PART_RULES.filter((r) => r.ruleKey !== "18.7");
  return CITATION_PART_RULES;
}

export const CITATION_PART_RULES: CitationPartRule[] = [
  // Parties (bold text around נ')
  { pattern: /\*\*[^*]+\*\*\s*נ['׳]\s*\*\*[^*]+\*\*/, ruleKey: "18.5", label: "שמות צדדים" },
  // Bold party name
  { pattern: /\*\*[^*]+\*\*/, ruleKey: "18.4", label: "שם צד" },
  // Case number (e.g., ע"א 248/86)
  { pattern: /[א-ת]["״][א-ת]\s+\d+\/\d+/, ruleKey: "18.2", label: "מספר תיק" },
  // Case type abbreviation without number
  { pattern: /^(ע"א|בג"ץ|רע"א|דנ"א|בש"פ|ע"פ|עת"מ|ת"א|ת"פ)/, ruleKey: "18.2", label: "סוג הליך" },
  // Reporter series (פ"ד, פד"ע, etc.)
  { pattern: /פ["״]ד|פד["״]ע|פ["״]מ/, ruleKey: "18.6", label: "סדרה וכרך" },
  // Database reference (נבו, פדאור)
  { pattern: /נבו|פדאור|אר["״]ש/, ruleKey: "19.1", label: "מאגר מידע" },
  // Law name with year
  { pattern: /חוק[- ]יסוד/, ruleKey: "4.3", label: "חוק יסוד" },
  // Section reference
  { pattern: /סעי?ף\s+\d+/, ruleKey: "2.1", label: "אזכור סעיף" },
  // Hebrew year (ה'תשנ"ד, התשכ"ח)
  { pattern: /[הה]['׳]?תש[א-ת]["״][א-ת]/, ruleKey: "2.1", label: "שנה עברית" },
  // Year range (תשנ"ד–1994)
  { pattern: /\d{4}[–-]\d{4}|\d{4}/, ruleKey: "18.7", label: "שנה" },
  // Book title (bold)
  { pattern: /\*\*[^*]{4,}\*\*/, ruleKey: "23.2", label: "שם ספר" },
  // Italic foreign source
  { pattern: /##[^#]+##/, ruleKey: "36", label: "מקור לועזי" },
  // Quoted article name
  { pattern: /"[^"]{4,}"/, ruleKey: "25.2", label: "שם מאמר" },
  // Page reference
  { pattern: /בעמ['׳]\s+\d+|עמ['׳]\s+\d+/, ruleKey: "1.9", label: "הפניה לעמוד" },
  // New/combined version
  { pattern: /\[נוסח חדש\]|\[נוסח משולב\]/, ruleKey: "4.5", label: "נוסח" },
  // Rule reference line
  { pattern: /📐\s*כלל/, ruleKey: "", label: "הפניה לכלל" },
  // ס"ח / ק"ת references
  { pattern: /ס["״]ח|ק["״]ת/, ruleKey: "2.1", label: "קובץ פרסום" },
];
