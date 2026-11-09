/**
 * Foreign-language treaty shape. An English (Latin-script) treaty is a foreign
 * source (Rule 36 → Bluebook), never the Israeli "כתבי אמנה" (Rule 9) route.
 * Pure and local — no network, no model text. Hebrew text is never matched,
 * so the Israeli treaty path is unchanged.
 */
import { detectForeignSource } from "@/data/bluebook/extract";

const HEBREW = /[\u0590-\u05FF]/;
const TREATY_WORD = /\b(?:treaty|treaties|convention|conventions|covenant|protocol)\b/i;
const TREATY_SERIES = /(?:^|[^A-Za-z.])(?:U\.N\.T\.S|U\.S\.T|T\.I\.A\.S|L\.N\.T\.S)\./;
const UN_CHARTER = /\bcharter of the united nations\b|\bU\.?\s?N\.?\s+charter\b/i;
const CASE_SHAPE = /[A-Za-z]\s+v(?:s)?\.?\s+[A-Za-z]/;
const AUTHOR_CUE = /\s(?:by|eds?\.|edited by)\s/i;

export function isForeignTreatyText(raw: string): boolean {
  const text = (raw ?? "").trim();
  if (!text || HEBREW.test(text) || !/[A-Za-z]/.test(text)) return false;
  if (!(TREATY_WORD.test(text) || TREATY_SERIES.test(text) || UN_CHARTER.test(text))) return false;
  // A case, book, article or other recognised shape keeps its own family.
  if (CASE_SHAPE.test(text) || AUTHOR_CUE.test(text)) return false;
  return detectForeignSource(text) === null;
}

/** A treaty verdict on Latin-only text is a foreign source; Hebrew keeps Rule 9. */
export function isLatinOnly(raw: string): boolean {
  const text = (raw ?? "").trim();
  return !!text && !HEBREW.test(text) && /[A-Za-z]/.test(text);
}
