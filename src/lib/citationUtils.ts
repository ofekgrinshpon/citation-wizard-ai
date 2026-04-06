export interface YearPreferences {
  hasHebrewYear: boolean;
  hasGregorianYear: boolean;
}

/**
 * Strip Hebrew year (התש...) or Gregorian year from a citation based on prefs.
 */
export function applyYearPreferences(citation: string, prefs: YearPreferences): string {
  let result = citation;
  if (!prefs.hasHebrewYear) {
    result = result.replace(/,?\s*הת[שׁ]["\u05F4\u201C\u201D״]?[א-ת]["\u05F4\u201C\u201D״]?[א-ת]?/g, "");
    result = result.replace(/,\s*,/g, ",").replace(/,\s*$/, "").replace(/,\s*\./, ".").trim();
  }
  if (!prefs.hasGregorianYear) {
    result = result.replace(/[–\-]\s*\d{4}/g, "");
    result = result.replace(/,?\s*\d{4}/g, "");
    result = result.replace(/,\s*,/g, ",").replace(/,\s*$/, "").replace(/,\s*\./, ".").trim();
  }
  return result;
}

const LEGISLATION_DETECT = /^(חוק|פקודת|פקודה|תקנות|צו|כללי|הוראות|חוק[\s-]יסוד|סעיף\s+[\dא-ת]+\s+ל)/;

export function isLegislationInput(text: string): boolean {
  return LEGISLATION_DETECT.test(text.trim());
}

export function extractLawNameFromInput(text: string): string {
  let cleaned = text.trim().replace(/^סעיף\s+[\dא-ת()./\\–-]+\s+ל/, "").trim();
  return cleaned.split(",")[0]?.trim() || cleaned;
}

/**
 * Extract the actual citation line from an AI response,
 * stripping step-by-step explanations, rule references, and warnings.
 */
export function extractCitationFromResponse(response: string): string {
  const lines = response.split("\n").map((l) => l.trim()).filter(Boolean);

  const citationLines = lines.filter((line) => {
    if (/^שלב \d/.test(line)) return false;
    if (/^📐/.test(line)) return false;
    if (/^⚠️/.test(line)) return false;
    if (/^🏷️/.test(line)) return false;
    if (/^✓/.test(line)) return false;
    if (/^העוזר המשפטי/.test(line)) return false;
    if (/^מכיוון ש/.test(line)) return false;
    if (/^הנוסחה ל/.test(line)) return false;
    return true;
  });

  return citationLines.length > 0 ? citationLines[citationLines.length - 1] : "";
}
