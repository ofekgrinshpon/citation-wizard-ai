// Client-side mirror of supabase/functions/_shared/hebrewNumberRange.ts.
// Keep the two files in sync. See that file for the rule's rationale.

const HEBREW_LETTER_RE = /[\u05D0-\u05EA]/;
const RANGE_RE = /(?<![\d\-–−])(?<!\d\.)(\d{1,4})\s*([\-–−])\s*(\d{1,4})(?![\d\-–−])(?!\.\d)/g;

function normalizeParagraph(paragraph: string): string {
  if (!HEBREW_LETTER_RE.test(paragraph)) return paragraph;
  return paragraph.replace(RANGE_RE, (match, a: string, sep: string, b: string) => {
    const na = parseInt(a, 10);
    const nb = parseInt(b, 10);
    if (!Number.isFinite(na) || !Number.isFinite(nb)) return match;
    if (na >= nb) return match;
    return `${b}${sep}${a}`;
  });
}

/**
 * Apply Rule 1.10 to Hebrew text: swap ascending number ranges so the higher
 * number is written first (rendered on the left of the dash in RTL).
 */
export function normalizeHebrewNumberRanges(text: string): string {
  if (!text) return text;
  const parts = text.split(/(\n{2,})/);
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = normalizeParagraph(parts[i]);
  }
  return parts.join("");
}
