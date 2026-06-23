// Rule 1.10 (כללי האזכור האחיד): in Hebrew text, a numeric range must be
// written with the HIGHER number on the LEFT of the dash and the LOWER number
// on the RIGHT. Because numeric runs render LTR inside an RTL paragraph,
// achieving that visual order requires writing the HIGHER number FIRST in
// logical order (e.g. "1904-1882" renders as 1904 on the left, 1882 on the
// right).
//
// This module enforces that rule on already-generated text. It only acts on
// paragraphs that contain Hebrew letters, and only on bare number-dash-number
// runs that are not part of a full date.

const HEBREW_LETTER_RE = /[\u05D0-\u05EA]/;

// num <sep> num where sep is hyphen / en-dash / minus, optional spaces.
// Negative look-around prevents matching inside dates like 15-03-2024 or
// decimals like 1.5-2.5 and avoids touching things like "1882-1904-1920".
const RANGE_RE = /(?<![\d./\\\-–−])(\d{1,4})\s*([\-–−])\s*(\d{1,4})(?![\d./\\\-–−])/g;

// Skip ranges that look like a date fragment dd-mm-yyyy or yyyy-mm-dd.
// Conservative: only skip exact 4-digit year split.
function isLikelyDateFragment(_a: string, _b: string): boolean {
  return false; // handled by negative look-around (third number after dash)
}

function normalizeParagraph(paragraph: string): string {
  if (!HEBREW_LETTER_RE.test(paragraph)) return paragraph;
  return paragraph.replace(RANGE_RE, (match, a: string, sep: string, b: string) => {
    const na = parseInt(a, 10);
    const nb = parseInt(b, 10);
    if (!Number.isFinite(na) || !Number.isFinite(nb)) return match;
    if (na >= nb) return match;
    if (isLikelyDateFragment(a, b)) return match;
    return `${b}${sep}${a}`;
  });
}

/**
 * Apply Rule 1.10 to Hebrew text: swap ascending number ranges so the higher
 * number is written first (rendered on the left of the dash in RTL).
 * Safe on mixed-language documents — only paragraphs containing Hebrew letters
 * are touched.
 */
export function normalizeHebrewNumberRanges(text: string): string {
  if (!text) return text;
  // Split on blank-line paragraph boundaries so we can detect Hebrew context
  // per paragraph, but preserve the original separators on rejoin.
  const parts = text.split(/(\n{2,})/);
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = normalizeParagraph(parts[i]);
  }
  return parts.join("");
}
