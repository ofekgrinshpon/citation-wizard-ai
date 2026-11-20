/** Rendered citation structure only, never publication verification or evidence. */
export function readRenderedHebrewArticleFields(response: string): Record<string, string> {
  // Sources, explanatory warnings and their years/pages cannot fill citation slots.
  const line = response.split(/\r?\n/).map(s => s.trim()).find(s => s && !/^(?:📐|⚠️)/.test(s)) || '';
  const fields: Record<string, string> = {};
  const record = line.match(/^(.*?)\s+\*\*([^*]+)\*\*\s*(.*?)\.?$/);
  if (!record) return fields;
  const identity = record[1].match(/^(.+?)\s+["“](.*)["”]\s*$/);
  if (!identity) return fields;
  const put = (key: string, value?: string) => {
    if (value?.trim() && !/\[חסר\s*:/.test(value)) fields[key] = value.trim();
  };
  put('author', identity[1]);
  put('articleTitle', identity[2]);
  put('journalName', record[2]);
  let tail = record[3].trim();
  const year = tail.match(/\s*\((\d{4}|ה?ת[א-ת"״׳']{2,7}|\[חסר:\s*[^\]]+\])\)\s*$/);
  if (year) {
    put('year', year[1]);
    tail = tail.slice(0, year.index).trim();
  }
  // One number is an opening page, not both volume and page. The comma
  // separates a pinpoint from the opening page; it never supplies that page.
  const slots = tail.match(/^(?:(?:כרך\s+)?([א-ת][א-ת"״׳']{0,7}|\d{1,4}|\[חסר:\s*[^\]]+\])((?:\([^()]+\))*)\s+)?(\d{1,5}(?:[–—-]\d{1,5})?|\[חסר:\s*[^\]]+\])(?:\s*,\s*(.+))?$/);
  if (slots) {
    put('volume', slots[1]);
    put('notebook', slots[2]?.slice(1, -1));
    put('firstPage', slots[3]?.split(/[–—-]/)[0]);
    put('specificReference', slots[4]);
    if (!fields.year && /^(?:\d{4}|ה?ת[א-ת"״׳']{2,7})$/.test(fields.volume || '')) put('year', fields.volume);
  }
  return fields;
}

// Transient UI completeness contract. This is not an evidence/provenance token
// and must never be used to save or complete bibliographic records.
export interface HebrewArticleValidationEnvelope {
  version: 1;
  rawInput: string;
  content: string;
  fields: Record<string, string>;
}
const DISPLAY_FIELDS = ['author', 'articleTitle', 'journalName', 'volume', 'notebook', 'firstPage', 'year', 'hebrewYear', 'newspaperDate'] as const;
export function buildHebrewArticleValidation(rawInput: string, content: string, fields: Partial<Record<string, string>>): HebrewArticleValidationEnvelope {
  const projected: Record<string, string> = {};
  for (const key of DISPLAY_FIELDS) if (fields[key]) projected[key] = fields[key]!;
  return { version: 1, rawInput: rawInput.trim(), content, fields: projected };
}
export function readHebrewArticleValidation(value: unknown, rawInput: string, content: string): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || v.rawInput !== rawInput.trim() || v.content !== content ||
      Object.keys(v).some(k => !['version','rawInput','content','fields'].includes(k)) ||
      !v.fields || typeof v.fields !== 'object' || Array.isArray(v.fields)) return null;
  const fields: Record<string, string> = {};
  for (const [key, val] of Object.entries(v.fields)) {
    if (!(DISPLAY_FIELDS as readonly string[]).includes(key) || typeof val !== 'string' || !val.trim() || val.length > 2000 || /\[חסר\s*:/.test(val)) return null;
    if (key === 'firstPage' && !/^\d{1,5}$/.test(val)) return null;
    if (key === 'year' && !/^\d{4}$/.test(val)) return null;
    fields[key] = val;
  }
  if (!fields.year) fields.year = fields.hebrewYear || fields.newspaperDate || (/^(?:\d{4}|ה?ת[א-ת"״׳']{2,7})$/.test(fields.volume || '') ? fields.volume : '');
  return fields;
}
