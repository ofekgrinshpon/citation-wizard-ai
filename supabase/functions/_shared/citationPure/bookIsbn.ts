/** Exact supplied ISBNs only. ISBN-10 and the equivalent 978 ISBN-13 share one key. */
export function normalizeBookIsbn(raw: string): string | null {
  const v = raw.replace(/[\s-]/g, "").toUpperCase();
  const check13 = (base: string) => (10 - [...base].reduce((sum, d, i) => sum + Number(d) * (i % 2 ? 3 : 1), 0) % 10) % 10;
  if (/^97[89]\d{10}$/.test(v)) return check13(v.slice(0, 12)) === Number(v[12]) ? v : null;
  if (!/^\d{9}[\dX]$/.test(v) || [...v].reduce((sum, d, i) => sum + (d === "X" ? 10 : Number(d)) * (10 - i), 0) % 11) return null;
  const base = "978" + v.slice(0, 9);
  return base + check13(base);
}

/** Explicit trailing ISBN (with optional parentheses) or a bare valid number.
 * A labelled malformed or multiple ISBN is a warning, never fuzzy lookup.
 */
export function extractBookIsbn(raw: string): { isbn: string | null; text: string } | null {
  const clean = raw.trim();
  if (normalizeBookIsbn(clean)) return { isbn: normalizeBookIsbn(clean), text: "" };
  const matches = [...clean.matchAll(/\bISBN(?:-1[03])?\b/gi)];
  if (!matches.length) return null;
  const at = matches[0].index!;
  if (!/^(?:\s*:\s*|\s+)\d/i.test(clean.slice(at + matches[0][0].length)) && !/^\s*:/.test(clean.slice(at + matches[0][0].length))) return null;
  const suffix = clean.slice(at).match(/^ISBN(?:-1[03])?\s*:?\s*([\dX][\dX -]{8,26})\s*[)\]]?\s*\.?$/i);
  const text = clean.slice(0, at).replace(/[\s,;([–—-]+$/, "").trim();
  return { isbn: matches.length === 1 && suffix ? normalizeBookIsbn(suffix[1]) : null, text };
}
