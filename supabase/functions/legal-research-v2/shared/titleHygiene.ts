/**
 * legal-research-v2 — deterministic display-title hygiene.
 *
 * Official Israeli publications (Knesset bill PDFs above all) carry internal
 * bookkeeping numbers in their first text line: "מספר פנימי: 2233595", and —
 * because PDF extraction reverses RTL runs — "2232480 : פנימי מספר".
 * Those are metadata, never a citation title.
 *
 * Pure string work. No citation architecture, no model call.
 */

const INTERNAL_ID_PATTERNS: RegExp[] = [
  /מספר\s*פנימי\s*[:：-]?\s*\d+/gu,
  /\d+\s*[:：-]?\s*פנימי\s*מספר/gu,
  /internal\s*(?:number|no\.?)\s*[:：-]?\s*\d+/giu,
];

/** Remove internal-ID metadata runs from a candidate title. */
export function stripInternalIds(input: string): string {
  let out = input ?? "";
  for (const re of INTERNAL_ID_PATTERNS) out = out.replace(re, " ");
  return out.replace(/\s+/g, " ").trim().replace(/^[\s,;:.\-–—]+|[\s,;:.\-–—]+$/gu, "").trim();
}

/** True when the line is bookkeeping noise rather than a title. */
export function isMetadataLine(line: string): boolean {
  const t = (line ?? "").trim();
  if (!t) return true;
  if (stripInternalIds(t).length < 4) return true;
  if (/^[\d\s.,:\/\-–—]+$/u.test(t)) return true;
  return false;
}

const FILENAME_RE = /\.(pdf|docx?|html?|aspx|htm)$/i;

/** Turn a URL/filename into a readable label, or "" when nothing usable. */
export function titleFromFilename(url: string): string {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "");
    const base = last.replace(FILENAME_RE, "").replace(/[_\-+]+/g, " ").trim();
    if (!base || /^[\d\s]+$/.test(base)) return "";
    return base.replace(/\s+/g, " ").slice(0, 120);
  } catch {
    return "";
  }
}

/**
 * Deterministic title preference order:
 *   1. a real document title parsed from the body/header
 *   2. a recognizable statute / judgment identity
 *   3. a clean filename-derived label
 *   4. a generic source label
 */
export function cleanDisplayTitle(input: {
  raw_title?: string;
  body_text?: string;
  url?: string;
  identity?: { dockets?: string[]; statutes?: string[] };
}): string {
  const raw = stripInternalIds((input.raw_title ?? "").trim());
  const isUrlish = !raw || /^https?:\/\//i.test(raw) || FILENAME_RE.test(raw);
  if (raw && !isUrlish) return raw.slice(0, 200);

  // 1. first meaningful prose line of the body.
  const bodyLine = (input.body_text ?? "")
    .split("\n")
    .map((l) => stripInternalIds(l.trim()))
    .find((l) => !isMetadataLine(l) && l.length >= 12 && l.length <= 180 && /[\u05D0-\u05EA]/.test(l));
  if (bodyLine) return bodyLine.slice(0, 200);

  // 2. recognizable legal identity.
  const identity = input.identity?.statutes?.[0] ?? input.identity?.dockets?.[0] ?? "";
  if (identity) return identity;

  // 3. filename-derived label.
  const fromFile = input.url ? titleFromFilename(input.url) : "";
  if (fromFile) return fromFile;

  // 4. generic.
  return "מקור ללא כותרת";
}
