/**
 * Repeat-citation rules (שם / שם, בעמ' / לעיל ה"ש) and citation-line
 * extraction. Extracted verbatim from BatchFootnoteBuilder so the batch
 * footnote builder and the V2 "אזכור אחיד" review layer share one
 * implementation instead of duplicating citation formatting logic.
 */
import { isLegislationInput, extractLawNameFromInput } from "@/lib/citationUtils";

export interface RepeatRuleCell {
  id: number;
  input: string;
  output: string | null;
}

export function applyRepeatCitationRules<T extends RepeatRuleCell>(cells: T[]): T[] {
  const seen = new Map<string, { index: number; fullCitation: string; isLegislation: boolean; lawName: string }>();
  let prevCellKey: string | null = null;

  return cells.map((cell, idx) => {
    if (!cell.output) {
      prevCellKey = null;
      return cell;
    }

    const citationOnly = extractCitationOnly(cell.output);
    const sourceKey = normalizeSourceKey(cell.input || citationOnly);
    if (!sourceKey) {
      prevCellKey = null;
      return cell;
    }

    const prior = seen.get(sourceKey);
    const referenceSuffix = extractReferenceSuffix(cell.input);
    const isLegislation = isLegislationInput(cell.input) || isLegislationInput(citationOnly);

    if (!prior) {
      const lawName = isLegislation
        ? (extractLawNameFromInput(cell.input) || extractLawNameFromInput(citationOnly))
        : "";
      seen.set(sourceKey, { index: idx + 1, fullCitation: citationOnly.trim(), isLegislation, lawName });
      prevCellKey = sourceKey;
      return cell;
    }

    const isAdjacentRepeat = prevCellKey === sourceKey;
    let nextCitation: string;

    if (prior.isLegislation) {
      // Rule 37.5 — never use לעיל ה"ש for legislation
      const sectionMatch = (cell.input || "").match(/סעיף\s+([\dא-ת()./\-–]+)/);
      const section = sectionMatch ? sectionMatch[1] : "";
      if (isAdjacentRepeat) {
        nextCitation = section ? `שם, בס' ${section}.` : `שם.`;
      } else {
        nextCitation = section && prior.lawName
          ? `ס' ${section} ל${prior.lawName}.`
          : prior.lawName
            ? `${prior.lawName}, לעיל ה"ש ${prior.index}.`
            : `שם.`;
      }
    } else {
      const bSuffix = referenceSuffix ? withBetPrefix(referenceSuffix) : "";
      if (isAdjacentRepeat) {
        nextCitation = bSuffix ? `שם, ${bSuffix}.` : `שם.`;
      } else {
        const label = extractShortSourceLabel(prior.fullCitation);
        nextCitation = `${label}, לעיל ה"ש ${prior.index}${bSuffix ? `, ${bSuffix}` : ""}.`;
      }
    }

    prevCellKey = sourceKey;
    return {
      ...cell,
      output: replaceCitationOnly(cell.output, nextCitation),
    };
  });
}

export function withBetPrefix(suffix: string): string {
  const trimmed = suffix.trim();
  if (/^(בעמ['״]|בס['״]|בפס['״])/.test(trimmed)) return trimmed;
  if (/^עמ['״]/.test(trimmed)) return trimmed.replace(/^עמ/, "בעמ");
  if (/^סעיף\b/.test(trimmed)) return trimmed.replace(/^סעיף\s*/, "בס' ");
  if (/^פסקה\b/.test(trimmed)) return trimmed.replace(/^פסקה\s*/, "בפס' ");
  return trimmed;
}

export function normalizeSourceKey(text: string): string {
  return text
    .trim()
    .replace(/^הערה\s*\d+:\s*/i, "")
    .replace(/^סעיף\s+[\dא-ת()./\-–]+\s+ל/, "")
    .replace(/^section\s+[A-Za-z0-9()./\-–]+\s+of\s+/i, "")
    .replace(/\bבעמ['״]?\s*[\d\-–]+/g, "")
    .replace(/\bעמ['״]?\s*[\d\-–]+/g, "")
    .replace(/\bפסקה\s*\d+/g, "")
    .replace(/\bpara\.?\s*\d+/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function extractReferenceSuffix(text: string): string {
  const trimmed = text.trim();
  const hebrewSection = trimmed.match(/סעיף\s+[\dא-ת()./\-–]+/);
  if (hebrewSection) return hebrewSection[0];
  const hebrewPage = trimmed.match(/בעמ['״]?\s*[\d\-–]+|עמ['״]?\s*[\d\-–]+/);
  if (hebrewPage) return hebrewPage[0];
  const hebrewParagraph = trimmed.match(/פסקה\s*\d+/);
  if (hebrewParagraph) return hebrewParagraph[0];
  const englishSection = trimmed.match(/section\s+[A-Za-z0-9()./\-–]+/i);
  if (englishSection) return englishSection[0];
  const englishPage = trimmed.match(/at\s+\d+(?:[\-–]\d+)?/i);
  if (englishPage) return englishPage[0];
  const englishParagraph = trimmed.match(/para\.?\s*\d+/i);
  if (englishParagraph) return englishParagraph[0];
  return "";
}

const GENERIC_PARTIES = /^(מדינת ישראל|פלוני|פלונית|אלמוני|אלמונית|היועץ המשפטי לממשלה|היועמ"ש|היועמ״ש|state of israel|attorney general)\b/i;

export function extractShortSourceLabel(text: string): string {
  const cleaned = text
    .replace(/\*\*/g, "")
    .replace(/##/g, "")
    .trim();

  const caseMatch = cleaned.match(/([^,\n()]+?)\s+נ['׳]\s+([^,\n()]+?)(?=\s*,|\s*\(|$)/);
  if (caseMatch) {
    const a = caseMatch[1].trim().replace(/^.*?\d+\/\d+\s+/, "").trim();
    const b = caseMatch[2].trim();
    const pick = GENERIC_PARTIES.test(b) ? (GENERIC_PARTIES.test(a) ? b : a) : b;
    return `עניין ${pick}`;
  }

  // Lead word must start a word: Hebrew has no \b, so require string start or a
  // separator — otherwise "צו" inside "שצורף" collapses a user-document label.
  const hebrewLaw = cleaned.match(/(?:^|[\s"'\u05f4\u05f3(\[])(חוק[\s-]יסוד[^,\n]*|חוק[^,\n]*|פקודת[^,\n]*|פקודה[^,\n]*|תקנות[^,\n]*|צו[\s-][^,\n]*)/);
  if (hebrewLaw) return hebrewLaw[1].trim();

  const englishLead = cleaned.match(/^([^,(\n]{3,80})/);
  if (englishLead) return englishLead[1].trim();

  return cleaned.split(",")[0].trim();
}

export function replaceCitationOnly(fullText: string, nextCitation: string): string {
  const lines = fullText.split("\n");
  const ruleLines = lines.filter((line) => /^📐|^כלל:/.test(line.trim()));
  const warningLines = lines.filter((line) => /^⚠️|\[חסר:|המערכת זיהתה/.test(line.trim()));
  return [nextCitation, ...ruleLines, ...warningLines].filter(Boolean).join("\n");
}

/**
 * Removes presentation-only warning lines (e.g. "⚠️ חסרים פרטים …") from text
 * destined for copy/export. Legitimate citation content, including [חסר:...]
 * placeholders that are part of the citation itself, is preserved.
 */
export function stripPresentationWarnings(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^⚠️/.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractCitationOnly(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (/^📐|^כלל:|^Based on Rule|^Rule \d|^מכיוון ש/.test(trimmed)) return false;
      if (/העוזר המשפטי/.test(trimmed)) return false;
      if (/יתחיל בעיבוד|אתחיל בעיבוד|אטפל בבקשתך/.test(trimmed)) return false;
      if (/^שלב \d|^זיהוי סוג|^נרמול|^יישום/.test(trimmed)) return false;
      if (/^---FOOTNOTE/i.test(trimmed)) return false;
      if (/\[חסר:/.test(trimmed) || /המערכת זיהתה/.test(trimmed)) return true;
      return true;
    })
    .join("\n")
    .replace(/\*\*/g, "")
    .replace(/##/g, "")
    .replace(/^\d+\.\s*/, "")
    .trim();
}
