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
