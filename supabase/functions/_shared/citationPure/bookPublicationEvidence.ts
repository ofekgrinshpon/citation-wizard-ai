import { authorEvidenceStatus } from "./authorNames.ts";

function exactByline(expected: string, evidence: string): boolean {
  const words = (value: string) => value.toLowerCase().match(/[\p{L}]+/gu)?.sort().join(" ") ?? "";
  const byline = evidence.replace(/^by\s+/i, "").trim();
  return words(byline) === words(expected) && authorEvidenceStatus(expected, byline) === "match";
}

/** Check a title-bound byline even when a catalogue result omits its year. */
export function bookCatalogueAuthorMatches(text: string, title: string, expected: string): boolean {
  return titleOccurrences(text, title, expected).some(match => {
    const afterTitle = text.slice((match.index ?? 0) + match[0].length).match(/^\s*(?:[.;|]|[–—]|-\s|by\b)\s*([^\n]{3,100})/i);
    const rest = afterTitle?.[1];
    if (!rest) return false;
    return exactByline(expected, rest) || [...rest.matchAll(/(?:[.;|](?=\s|$)|[–—]|\s+-\s+)/g)]
      .some(mark => exactByline(expected, rest.slice(0, mark.index)));
  });
}

/** A word boundary alone does not make a work title: it can be the last
 * words of an unrelated title or subtitle. Only explicit record boundaries or
 * an immediately adjacent byline may start the requested work. */
export function bookTitleOccurrenceStartsRecord(text: string, index: number, expectedAuthor?: string): boolean {
  const before = text.slice(0, index);
  if (!before.trim()) return true;
  if (/(?:\bof|\band|:|[-–—])\s*\n\s*$/i.test(before) && !/(?:^|\n)(?:Book\s+)?Title\s*:\s*$/i.test(before)) return false;
  if (/\((?:[^()]{0,30}\s)?(?:17|18|19|20)\d{2}\)\.\s*$/.test(before)) return true;
  // Newlines, pipes and semicolons delimit records. A colon or dash does not:
  // both commonly introduce subtitles. Periods can belong to author initials.
  const record = before.slice(Math.max(before.lastIndexOf("\n"), before.lastIndexOf("|"), before.lastIndexOf(";")) + 1).trim();
  if (!record || /^(?:Book\s+)?Title\s*:\s*["“]?$/i.test(record)) return true;
  if (record === '"' || record === "“") return true;
  const byline = record.match(/^(.*?)\s*,\s*["“]?$/)?.[1];
  if (!byline) return false;
  if (expectedAuthor) {
    if (exactByline(expectedAuthor, byline)) return true;
    // Search results often concatenate a heading with the snippet. A repeated
    // exact author followed by a comma still binds the snippet's title. Do not
    // treat arbitrary prefix words as part of that byline.
    const pieces = byline.split(/\s+/);
    return Array.from({ length: Math.min(8, pieces.length) }, (_, i) => pieces.slice(-(i + 1)).join(" "))
      .some(candidate => exactByline(expectedAuthor, candidate));
  }
  // Legacy surname-only citations remain supported. Multiword names require
  // the expected-author argument so a different title cannot masquerade as one.
  return /^[A-Z][a-z'’\-]{2,}$/.test(byline);
}

function titleOccurrences(text: string, title: string, expectedAuthor?: string, bookChapterContainer = false): RegExpMatchArray[] {
  if (!title.trim()) return [];
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = title.trim().split(/\s+/).map(escape).join("\\s+");
  return [...text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "giu"))]
    .filter(match => bookChapterContainer || bookTitleOccurrenceStartsRecord(text, match.index ?? 0, expectedAuthor));
}

/** A nonempty source heading must name the requested work, not merely
 * contain its last words. A byline can precede the title only when supplied. */
export function bookSourceHeadingMatches(heading: string, title: string, expectedAuthor?: string): boolean {
  return titleOccurrences(heading, title, expectedAuthor).some(match => {
    const before = heading.slice(0, match.index).trim();
    const metadata = /^(?:Book\s+)?Title\s*:\s*["“]?$/i.test(before);
    const byline = before.match(/^(.*?)\s*,\s*["“]?$/)?.[1];
    if (before && before !== '"' && before !== "“" && !metadata && !(expectedAuthor && byline && exactByline(expectedAuthor, byline))) return false;
    const after = heading.slice((match.index ?? 0) + match[0].length);
    return !after.trim() || /^\s*(?:[.;|("”]|[-–—](?:\s|$)|by\b|:\s*(?:publication date|publication year|published)\b)/i.test(after);
  });
}

/** Publication facts must belong to the requested work, not another date on its page. */
export function extractBookPublicationEvidence(text: string, title: string, expectedAuthor?: string,
  options?: { bookChapterContainer?: boolean }): { year?: string; edition?: string } {
  const matches = titleOccurrences(text, title, expectedAuthor, options?.bookChapterContainer);
  const found: Array<{ year: string; edition?: string }> = [];
  for (const match of matches) {
    // A subtitle is part of the same title; never scan through a sentence into another work.
    let tail = text.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 260);
    tail = tail.replace(/^\s*:\s*[^.();\n]{1,110}(?=\s*\()/, " ");
    const direct = tail.match(/^\s*[,.:;\-–—]?\s*\(\s*(?:(\d+(?:st|nd|rd|th|d)\s+ed\.?|(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+edition)\s*[,;]?\s*)?((?:17|18|19|20)\d{2})\s*\)/i);
    const metadata = tail.match(/^\s*[,.:;\-–—]?\s*(?:(?:publication|published|publication date|publication year|year)\s*:?\s*|(?:[A-Z][\w&'-]*\s+){0,4}(?:University Press|Press|Routledge|Oxford)\s*,?\s*)((?:17|18|19|20)\d{2})\b/i);
    if (direct) found.push({ year: direct[2], ...(direct[1] ? { edition: direct[1] } : {}) });
    else if (metadata) found.push({ year: metadata[1] });
    else if (expectedAuthor) {
      const catalogue = cataloguePublication(tail, expectedAuthor, text.slice(Math.max(0, (match.index ?? 0) - 100), match.index));
      if (catalogue) found.push(catalogue);
    }
  }
  if (!found.length || new Set(found.map(x => x.year)).size !== 1) return {};
  const editions = new Set(found.map(x => x.edition));
  return { year: found[0].year, ...(editions.size === 1 && found[0].edition ? { edition: found[0].edition } : {}) };
}

/** A bounded catalogue row, not a search through prose for a plausible date.
 * The caller still owns source trust and identity. No source is trusted here
 * merely because its heading says Google Books. */
function cataloguePublication(tail: string, expectedAuthor: string, prefix: string): { year: string } | null {
  if (/\b(?:references|bibliography|works cited|cited in|review(?:ed|s)?|copyright)\b/i.test(prefix)) return null;
  const separator = String.raw`\s*(?:[.;|]|[-–—]|\n)\s*`;
  const publisher = String.raw`(?:Penguin(?: Books)?|Routledge|Oxford(?: University Press)?|Cambridge University Press|(?:[A-Z][A-Za-z'’&-]*\s+){0,5}(?:University Press|Press)|University of (?:[A-Z][A-Za-z'’&-]*\s+){1,4}Press)`;
  // A publisher label may name a publisher outside the bounded unlabelled list.
  const labelledPublisher = String.raw`Publisher\s*:\s*[A-Z][A-Za-z'’& -]{1,70}?`;
  const date = String.raw`((?:17|18|19|20)\d{2})(?!\d)`;
  const monthDay = String.raw`(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(?:[1-9]|[12]\d|3[01])\s*,\s*)?`;
  const publication = String.raw`(?:(?:${publisher}|${labelledPublisher})\s*,\s*${date}|(?:${labelledPublisher}${separator})?(?:(?:Paperback|Hardcover|Hardback)${separator})?(?:Publication (?:date|year)|Published)\s*:\s*${monthDay}${date})`;
  const end = String.raw`(?=\s*(?:[.;|]|[-–—]\s*(?:[\p{L}][\p{L} ,&]{0,52}\s+[-–—]\s*)?\d{1,4}\s+pages\b|$))`;
  const row = new RegExp(String.raw`^\s*(?:[.;|]|[-–—]|by\b)\s*(.{3,100}?)${separator}(?:Google Books\s*(?:\.{3}|…|[-–—|])\s*)?${publication}${end}`, "iu").exec(tail);
  if (!row || /\b(?:copyright|references|bibliography|works cited|review(?:ed|s)?|cited in)\b/i.test(row[0])) return null;
  // Require the whole byline, rather than merely an author mention embedded in
  // another work's title, a review sentence, or a bibliographic reference.
  if (!exactByline(expectedAuthor, row[1])) return null;
  return { year: row[2] ?? row[3] };
}
