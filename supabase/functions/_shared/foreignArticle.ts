/** Pure article parsing shared by the client and edge lookup. No I/O or formatting. */
export type ArticleFields = Record<string, string>;
export interface ArticleRecord {
  fields: ArticleFields;
  structured: boolean;
}

const YEAR = /\b(?:1[6-9]|20)\d{2}\b/;
const NAME = /^[\p{Lu}][\p{L}.'’-]*(?:\s+(?:[\p{Lu}][\p{L}.'’-]*|and|&|de|del|van|von|da|di|la|le|et|al\.)){0,18}$/u;
const TUPLE = /^(\d{1,4})\s+([A-Z][A-Za-z.&'’ -]+?)\s+(\d{1,5})(?:\s*[-–]\s*\d+)?(?:\s*,\s*(\d+(?:\s*[-–]\s*\d+)?))?\s*\(((?:1[6-9]|20)\d{2})\)/;

export function articleKey(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

function clean(value: string): string {
  return value.trim().replace(/^["“”]+|["“”.,;]+$/g, "").trim();
}

function plausibleJournal(value: string): boolean {
  return /[A-Za-z]{2,}/.test(value) && /\.|Law|Journal|Rev|Stud|Econ|Legal/i.test(value);
}

function isAuthorList(value: string): boolean {
  return value.split(/,\s*/).every((name) => NAME.test(name.replace(/^(?:and|&)\s+/, "")));
}

/** Preserve explicit fields even when the complete Bluebook parser declines. */
export function parseForeignArticleInput(raw: string): ArticleFields {
  const fields: ArticleFields = {};
  let text = raw.trim();
  const pin = text.match(/(?:,?\s+)(?:at\s+)?\b(?:pp?\.?|pages?)\s*(\d+(?:\s*[-–]\s*\d+)?)(?=\s*(?:[.,;]|\(|$))/i);
  if (pin) {
    fields.pinpoint = pin[1].replace(/\s*[-–]\s*/g, "–");
    text = text.slice(0, pin.index) + text.slice((pin.index ?? 0) + pin[0].length);
  }
  // A terminal publication year is explicit; a year embedded in a title is not.
  const year = text.match(/(?:\(\s*|,\s*)((?:1[6-9]|20)\d{2})\s*\)?[.,;\s]*$/);
  if (year) fields.year = year[1];
  // Full or partial publication coordinates after the title.
  const publication = text.match(/,\s*(\d{1,4})\s+([A-Z][A-Za-z.&'’ -]+?)\s+(\d{1,5})(?:\s*[-–]\s*\d+)?(?:\s*,\s*(\d+(?:\s*[-–]\s*\d+)?))?\s*(?:\(((?:1[6-9]|20)\d{2})\))?[.\s]*$/);
  if (publication && plausibleJournal(publication[2])) {
    fields.volume = publication[1];
    fields.journal = publication[2].trim();
    fields.firstPage = publication[3];
    if (publication[4]) fields.pinpoint = publication[4].replace(/\s*[-–]\s*/g, "–");
    if (publication[5]) fields.year = publication[5];
    text = text.slice(0, publication.index);
  } else if (year) {
    text = text.slice(0, year.index);
  }
  if (!fields.journal) {
    const journalVolume = text.match(/,\s*([A-Z][A-Za-z.&'’ -]{2,100}),?\s+vol(?:ume)?\.?\s*(\d{1,4})[.\s]*$/i);
    if (journalVolume && plausibleJournal(journalVolume[1])) {
      fields.journal = journalVolume[1].trim();
      fields.volume = journalVolume[2];
      text = text.slice(0, journalVolume.index);
    }
    const partialPublication = !fields.journal && text.match(/,\s*(?:(\d{1,4})\s+)?([A-Z][A-Za-z.&'’ -]{2,100})[.\s]*$/);
    if (partialPublication && /\b(?:Journal|Review|Quarterly)\b|\b(?:J|L|Rev|Q)\./.test(partialPublication[2])) {
      fields.journal = partialPublication[2].trim();
      if (partialPublication[1]) fields.volume = partialPublication[1];
      text = text.slice(0, partialPublication.index);
    }
  }
  const quoted = text.match(/["“]([^"”]{3,220})["”]/);
  if (quoted) {
    fields.articleTitle = clean(quoted[1]);
    const before = clean(text.slice(0, quoted.index));
    const after = clean(text.slice((quoted.index ?? 0) + quoted[0].length).replace(/^\s*by\s+/i, ""));
    if (isAuthorList(before)) fields.authors = before;
    else if (isAuthorList(after)) fields.authors = after;
  } else {
    const by = text.match(/^(.{3,220}?)\s+by\s+(.+)$/i);
    const comma = text.indexOf(",");
    if (by && isAuthorList(clean(by[2]))) {
      fields.articleTitle = clean(by[1]);
      fields.authors = clean(by[2]);
    } else if (comma > 0 && NAME.test(text.slice(0, comma).trim())) {
      const parts = text.split(",").map((part) => part.trim());
      let titleAt = 1;
      while (titleAt < parts.length - 1 && parts[titleAt].split(/\s+/).length > 1 && NAME.test(parts[titleAt].replace(/^(?:and|&)\s+/, ""))) titleAt++;
      fields.authors = parts.slice(0, titleAt).join(", ");
      fields.articleTitle = clean(parts.slice(titleAt).join(", "));
    } else {
      fields.articleTitle = clean(text);
    }
  }
  if (!fields.articleTitle || !/[A-Za-z]/.test(fields.articleTitle) || fields.articleTitle.length > 240) delete fields.articleTitle;
  return fields;
}

function surnames(authors: string): string[] {
  return authors.replace(/\s+et al\.?$/i, "").split(/\s+(?:and|&)\s+|\s*;\s*|,\s*(?=[A-Z])/)
    .map((name) => articleKey(name).split(" ").filter((word) => !["jr", "sr", "ii", "iii", "iv"].includes(word)).pop() ?? "")
    .filter(Boolean);
}

export function articleAuthorsMatch(evidence: string, authors?: string): boolean {
  if (!authors) return true;
  const tokens = new Set(articleKey(evidence).split(" "));
  return surnames(authors).every((name) => tokens.has(name));
}

/** A result heading must describe this work, not merely contain its words. */
export function articleHeadingMatches(heading: string, title: string): boolean {
  const titleKey = articleKey(title);
  if (!titleKey) return false;
  return articleKey(heading) === titleKey || heading.split(/\s+[—–|]\s+|\s+-\s+/).some((part) => articleKey(part) === titleKey);
}

function titlePattern(title: string): RegExp {
  const words = title.match(/[\p{L}\p{N}]+/gu) ?? [];
  return new RegExp(`(?<![\\p{L}\\p{N}])${words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s\\p{P}]*")}(?![\\p{L}\\p{N}])`, "giu");
}

function romanNumber(value: string): string {
  if (/^\d+$/.test(value)) return value;
  const digits: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  return String([...value.toUpperCase()].reduce((sum, char, i, all) => sum + ((digits[all[i + 1]] ?? 0) > digits[char] ? -digits[char] : digits[char]), 0));
}

function publicationAtStart(text: string): ArticleFields | null {
  const start = text.replace(/^[\s,;.:"”'’—–|*-]+/, "");
  const tuple = start.match(TUPLE);
  if (tuple && plausibleJournal(tuple[2])) return { volume: tuple[1], journal: tuple[2].trim(), firstPage: tuple[3], year: tuple[5] };
  // Date and issue belong to this immediately adjacent publication line.
  // Do not search later prose for a year (e.g. deposited/indexed metadata).
  const month = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?";
  const season = "(?:Spring|Summer|Autumn|Fall|Winter)";
  const year = "(?:1[6-9]|20)\\d{2}";
  const day = "(?:0?[1-9]|[12]\\d|3[01])";
  const date = `(?:(?:${month}(?:\\s+${day},?)?|${day}\\s+${month}|${season})\\s+)?${year}(?:[-/](?:0?[1-9]|1[0-2])[-/]${day})?`;
  const publisher = start.match(new RegExp(`^([A-Z][A-Za-z.&'’ -]{1,159}?),?\\s+Vol(?:ume)?\\.?\\s+([IVXLCDM]+|\\d{1,4})(?:,?\\s+(?:No\\.?|Issue)\\s+\\d{1,4}\\.?)?[,\\s]+(?:\\((${date})\\)|(${date})),?\\s+(?:pp?\\.?|Pages)\\s*(\\d{1,5})(?:\\s*(?:--?|[–—])\\s*(\\d{1,5}))?(?=$|[\\s.,;])`, "i"));
  if (publisher && plausibleJournal(publisher[1]) && !/(?:\.{3}|…)/.test(publisher[1])
    && (!publisher[6] || Number(publisher[6]) >= Number(publisher[5]))) {
    return { journal: publisher[1].trim(), volume: romanNumber(publisher[2]), year: (publisher[3] ?? publisher[4]).match(YEAR)![0], firstPage: publisher[5] };
  }
  return null;
}

const MAX_RECORD_TEXT = 16_384;
const MAX_BIBTEX_ENTRY = 8_192;
const MAX_BIBTEX_DEPTH = 16;

/** Find a whole BibTeX entry before interpreting any of its fields. */
function bibtexEnd(text: string, start: number): number | null {
  const braced = text[start] === "{";
  const base = braced ? 1 : 0;
  let depth = base, quoted = false;
  for (let i = start + 1; i < Math.min(text.length, start + MAX_BIBTEX_ENTRY); i++) {
    const char = text[i];
    if (char === "\\") { i++; continue; }
    if (char === '"' && depth === base) quoted = !quoted;
    else if (char === "{") { if (++depth > MAX_BIBTEX_DEPTH) return null; }
    else if (char === "}") {
      if (braced && depth === base && !quoted) return i + 1;
      if (--depth < base) return null;
    } else if (char === ")" && !braced && depth === 0 && !quoted) return i + 1;
  }
  return null;
}

function bibtexLiteral(raw: string): string | null {
  let value = "";
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (char === "\\") {
      const escaped = raw[++i];
      // Unknown macros/TeX commands are not facts we can safely reconstruct.
      if (!escaped || !/[{}&%_$#"\\]/.test(escaped)) return null;
      value += escaped;
    } else if (char !== "{" && char !== "}") value += char === "~" ? " " : char;
  }
  return value.replace(/\s+/g, " ").trim();
}

function bibtexFields(body: string): Map<string, string> | null {
  const key = body.match(/^\s*[\w:.+/-]{1,160}\s*,\s*/);
  if (!key) return null;
  const fields = new Map<string, string>();
  let cursor = key[0].length;
  while (cursor < body.length) {
    const field = body.slice(cursor).match(/^([A-Za-z][\w-]{0,63})\s*=\s*/);
    if (!field || fields.size >= 32) return null;
    const name = field[1].toLowerCase();
    if (fields.has(name)) return null; // Even identical duplicates are ambiguous input.
    cursor += field[0].length;
    const start = cursor;
    let raw: string;
    if (body[cursor] === "{" || body[cursor] === '"') {
      const close = body[cursor] === "{" ? "}" : '"';
      let depth = 0;
      cursor++;
      for (; cursor < body.length; cursor++) {
        if (body[cursor] === "\\") { cursor++; continue; }
        if (body[cursor] === close && depth === 0) break;
        if (body[cursor] === "{" && ++depth > MAX_BIBTEX_DEPTH) return null;
        if (body[cursor] === "}" && --depth < 0) return null;
      }
      if (cursor >= body.length || depth !== 0) return null;
      raw = body.slice(start + 1, cursor++);
    } else {
      const number = body.slice(cursor).match(/^\d{1,8}(?=\s*(?:,|$))/);
      if (!number) return null; // No macros, concatenation, or bare prose values.
      raw = number[0];
      cursor += raw.length;
    }
    const value = bibtexLiteral(raw);
    if (value === null) return null;
    fields.set(name, value);
    const delimiter = body.slice(cursor).match(/^\s*(?:,\s*|$)/);
    if (!delimiter) return null;
    cursor += delimiter[0].length;
  }
  return fields;
}

function bibtexAuthors(value: string): string | null {
  const names = value.split(/\s+and\s+/i);
  if (!names.length || names.length > 16) return null;
  const normalized: string[] = [];
  for (const name of names) {
    const parts = name.split(",").map((part) => part.trim());
    const direct = parts.length === 1 ? parts[0]
      : parts.length === 2 ? `${parts[1]} ${parts[0]}`
      : parts.length === 3 && /^(?:Jr\.?|Sr\.?|II|III|IV)$/.test(parts[1]) ? `${parts[2]} ${parts[0]} ${parts[1]}` : "";
    if (!direct || !NAME.test(direct) || /\bet al\b|[;&]/i.test(direct)) return null;
    normalized.push(direct);
  }
  return normalized.join(" and ");
}

function bibtexRecords(text: string, target: string): { records: ArticleRecord[]; prose: string } {
  const records: ArticleRecord[] = [];
  const marker = /@[A-Za-z]+\s*[{(]/g;
  let prose = "", copied = 0, count = 0;
  for (let match = marker.exec(text); match; match = marker.exec(text)) {
    // Mask every entry, including non-articles, so a note/reference inside one
    // cannot be reinterpreted by the prose parser as the entry's own metadata.
    prose += text.slice(copied, match.index) + "\n[BibTeX entry]\n";
    const end = ++count <= 16 ? bibtexEnd(text, marker.lastIndex - 1) : null;
    if (end === null) return { records, prose };
    copied = marker.lastIndex = end;
    if (!/^@article\s*[{(]$/i.test(match[0])) continue;
    const fields = bibtexFields(text.slice(match.index + match[0].length, end - 1));
    if (!fields) continue;
    const title = fields.get("title") ?? "", journal = fields.get("journal") ?? "";
    const authors = bibtexAuthors(fields.get("author") ?? "");
    const year = fields.get("year") ?? "", volume = fields.get("volume") ?? "";
    const pages = (fields.get("pages") ?? "").match(/^(\d{1,5})(?:\s*(?:--?|[–—])\s*(\d{1,5}))?$/);
    if (articleKey(title) !== articleKey(target) || title.length > 240 || !authors
      || !journal || journal.length > 160 || !plausibleJournal(journal)
      || /(?:\.{3}|…)/.test(title + journal + authors)
      || !/^(?:1[6-9]|20)\d{2}$/.test(year) || !/^[1-9]\d{0,3}$/.test(volume)
      || !pages || (pages[2] && Number(pages[2]) < Number(pages[1]))) continue;
    records.push({ fields: { articleTitle: title, authors, journal, year, volume, firstPage: pages[1] }, structured: false });
  }
  return { records, prose: prose + text.slice(copied) };
}

function publisherByline(value: string): string | null {
  const byline = value.replace(/^(?:by|authors?:)\s+/i, "").trim();
  const names = byline.split(/\s*;\s*|\s+(?:and|&)\s+|,\s*/);
  return byline.length <= 300 && names.length <= 16 && names.every((name) => NAME.test(name))
    && !/\bet al\b|\.{3}|…/i.test(byline) ? byline : null;
}

function publisherRecord(lines: string[], heading: string, target: string, suppliedAuthors?: string): ArticleRecord | null {
  if (/(?:\.{3}|…)/.test(lines[0] ?? "")) return null;
  const hasTitle = articleKey(lines[0] ?? "") === articleKey(target);
  const bylineAt = hasTitle ? 1 : 0;
  const authors = publisherByline(lines[bylineAt] ?? "");
  if (!authors) return null;
  if (!hasTitle) {
    // Search headings sometimes concatenate a title, its byline and an ellipsis.
    // Accept only that complete shape and verify the SAME byline starts the body.
    const title = titlePattern(target).exec(heading);
    if (!title || title.index !== 0) return null;
    const remainder = heading.slice(title[0].length);
    if (/^\s*:/.test(remainder)) return null; // A colon extends the work's title.
    const after = remainder.replace(/^\s*[—–|-]?\s*/, "").replace(/\s*(?:\.{3}|…)\s*$/, "");
    if (!after && /(?:\.{3}|…)/.test(remainder)) return null;
    if (after) {
      const headingAuthors = publisherByline(after);
      if (!headingAuthors || !articleFieldMatches("authors", headingAuthors, authors)) return null;
      if (suppliedAuthors) {
        if (!articleFieldMatches("authors", authors, suppliedAuthors)) return null;
      } else {
        // Without author anchors, a single capitalized phrase could be a
        // subtitle. Require an explicit multi-author byline for concatenation.
        const names = authors.split(/\s*;\s*|\s+(?:and|&)\s+|,\s*/);
        if (names.length < 2 || names.some((name) => articleKey(name).split(" ").length < 2)) return null;
      }
    }
  }
  const fields = publicationAtStart(lines.slice(bylineAt + 1, bylineAt + 5).join("\n"));
  return fields && !/(?:\.{3}|…)/.test(fields.journal)
    ? { fields: { ...fields, articleTitle: target, authors }, structured: false } : null;
}

function publisherRecords(text: string, heading: string, anchors: ArticleFields): ArticleRecord[] {
  const lines = text.trim().split(/\r?\n/);
  const records: ArticleRecord[] = [];
  let blocks = 0;
  for (let i = 0; i < lines.length && blocks < 16; i++) {
    // Every later block must independently repeat the complete target title;
    // never reuse the first block's title/byline to fill another publication.
    if (i > 0 && articleKey(lines[i]) !== articleKey(anchors.articleTitle)) continue;
    blocks++;
    const record = publisherRecord(lines.slice(i, i + 6), i === 0 ? heading : "", anchors.articleTitle, anchors.authors);
    if (record) records.push(record);
  }
  return records;
}

function trailingAuthors(prefix: string): string | undefined {
  // Read a citation's byline immediately before its title; never scan pooled text.
  const words = prefix.replace(/[,\s]+$/, "").split(/\s+/);
  for (let i = Math.max(0, words.length - 18); i < words.length; i++) {
    const candidate = words.slice(i).join(" ");
    if (isAuthorList(candidate)) return candidate;
  }
  return undefined;
}

export function articleRecordsFromSnippet(source: { title?: string; snippet?: string }, anchors: ArticleFields): ArticleRecord[] {
  const target = anchors.articleTitle;
  if (!target) return [];
  const records: ArticleRecord[] = [];
  const titleText = bibtexRecords((source.title ?? "").slice(0, MAX_RECORD_TEXT), target);
  const snippetText = bibtexRecords((source.snippet ?? "").slice(0, MAX_RECORD_TEXT), target);
  records.push(...titleText.records, ...snippetText.records);
  records.push(...publisherRecords(snippetText.prose, titleText.prose, anchors));
  // Search each text separately: concatenating a heading and unrelated body
  // would create a citation relationship that the evidence never asserted.
  for (const text of [titleText.prose, snippetText.prose]) {
    for (const match of text.matchAll(titlePattern(target))) {
      const suffix = text.slice((match.index ?? 0) + match[0].length);
      // A prose mention ending a sentence must not borrow the next sentence's
      // citation tuple, especially when the request supplied only a title.
      if (!/^[?!]?["”]?\s*,\s*/.test(suffix)) continue;
      const fields = publicationAtStart(suffix.replace(/^[?!]/, ""));
      if (!fields) continue;
      const prefix = text.slice(0, match.index);
      const authors = /,\s*["“]?$/.test(prefix) ? trailingAuthors(prefix.replace(/["“]$/, "")) : undefined;
      if (anchors.authors && (!authors || !articleAuthorsMatch(authors, anchors.authors))) continue;
      records.push({ fields: { ...fields, articleTitle: target, ...(authors ? { authors } : {}) }, structured: false });
    }
  }
  // A record heading plus a leading publication line is also explicit metadata.
  if (!records.length && !/(?:\.{3}|…)/.test(titleText.prose) && articleHeadingMatches(titleText.prose, target)) {
    const snippet = snippetText.prose.trim();
    let fields = publicationAtStart(snippet);
    let authors = titleText.prose.split(/\s+[—–|]\s+|\s+-\s+/)
      .map((part) => part.replace(/^by\s+/i, "").trim())
      .find((part) => articleKey(part) !== articleKey(target) && isAuthorList(part)
        && !/\b(?:Journal|Review|Press|University|Repository|Archive|Library|Law)\b/i.test(part)
        && (!!anchors.authors || part.includes(" ")));
    if (!fields) {
      const leading = snippet.match(/^(.{2,150}?)(?:\n|\s+[—|]\s+|\.\s+(?=\d)|,\s*(?=\d))/);
      if (leading && !/(?:\.{3}|…)/.test(leading[1]) && isAuthorList(leading[1].trim())) {
        authors = leading[1].trim();
        fields = publicationAtStart(snippet.slice(leading[0].length));
      }
    }
    if (fields && (!anchors.authors || (authors && articleFieldMatches("authors", authors, anchors.authors)))) {
      records.push({ fields: { ...fields, articleTitle: target, ...(authors ? { authors } : {}) }, structured: false });
    }
  }
  return records;
}

function decodeHtml(value: string): string {
  return value.replace(/&(?:amp|quot|apos|lt|gt);|&#(?:x[\da-f]+|\d+);/gi, (entity) => {
    const named: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">" };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const code = entity.slice(2, -1);
    const number = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : "";
  });
}

export function articleRecordFromHtml(html: string, anchors: ArticleFields): ArticleRecord | null {
  const meta = new Map<string, string[]>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = new Map<string, string>();
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs.set(match[1].toLowerCase(), decodeHtml(match[2] ?? match[3]));
    const key = (attrs.get("name") ?? attrs.get("property") ?? "").toLowerCase();
    const value = attrs.get("content");
    if (value) meta.set(key, [...(meta.get(key) ?? []), value]);
  }
  const titles = meta.get("citation_title") ?? [];
  if (titles.length !== 1 || articleKey(titles[0]) !== articleKey(anchors.articleTitle ?? "")) return null;
  const authors = (meta.get("citation_author") ?? []).join(" & ");
  if (!articleAuthorsMatch(authors, anchors.authors)) return null;
  const fields: ArticleFields = { articleTitle: titles[0] };
  if (authors) fields.authors = authors;
  const keys: Record<string, string> = { journal: "citation_journal_title", volume: "citation_volume", firstPage: "citation_firstpage" };
  for (const [field, key] of Object.entries(keys)) {
    const values = [...new Set(meta.get(key) ?? [])];
    if (values.length > 1) return null;
    if (values[0]) fields[field] = values[0].trim();
  }
  const dates = [...(meta.get("citation_publication_date") ?? []), ...(meta.get("citation_date") ?? [])];
  const years = [...new Set(dates.map((date) => date.match(YEAR)?.[0]).filter(Boolean))];
  if (years.length > 1) return null;
  if (years[0]) fields.year = years[0];
  return { fields, structured: true };
}

function authorNames(value: string): Array<{ surname: string; given: string[]; suffix?: string }> | null {
  // "et al." does not establish membership/order and cannot justify expansion.
  if (/\bet al\.?/i.test(value)) return null;
  return value.replace(/,\s*(Jr\.?|Sr\.?|II|III|IV)(?=\s*(?:,|&|and\b|$))/g, " $1")
    .split(/\s*(?:&|;)\s*|\s+and\s+|,\s*/)
    .map((name) => {
      const tokens = articleKey(name).split(" ").filter(Boolean);
      const suffix = /^(?:jr|sr|ii|iii|iv)$/.test(tokens[tokens.length - 1] ?? "") ? tokens.pop() : undefined;
      return { surname: tokens.pop() ?? "", given: tokens, suffix };
    });
}

function compatibleAuthorNames(a: string, b: string): boolean {
  const left = authorNames(a), right = authorNames(b);
  if (!left || !right) return articleKey(a) === articleKey(b);
  return left.length === right.length && left.every((name, i) => {
    const other = right[i];
    if (!name.surname || name.surname !== other.surname || (name.suffix && other.suffix && name.suffix !== other.suffix)) return false;
    return name.given.every((part, j) => !other.given[j] || part === other.given[j]
      || (Math.min(part.length, other.given[j].length) === 1 && part[0] === other.given[j][0]));
  });
}

/** Choose an evidenced expansion without mutating anchors or losing any detail. */
export function enrichArticleAuthors(supplied?: string, candidate?: string): string | undefined {
  if (!supplied) return candidate;
  if (!candidate || !compatibleAuthorNames(supplied, candidate)) return supplied;
  const before = authorNames(supplied), after = authorNames(candidate);
  if (!before || !after) return supplied;
  let richer = false;
  const preserves = before.every((name, i) => {
    const other = after[i];
    if ((name.suffix && !other.suffix) || other.given.length < name.given.length) return false;
    if ((!name.suffix && other.suffix) || other.given.length > name.given.length) richer = true;
    return name.given.every((part, j) => {
      if (other.given[j].length < part.length) return false;
      if (other.given[j].length > part.length) richer = true;
      return true;
    });
  });
  return preserves && richer ? candidate : supplied;
}

/** Comparison permits ordinary journal abbreviations, but not unrelated names. */
export function articleFieldMatches(field: string, a: string, b: string): boolean {
  if (field === "authors") return compatibleAuthorNames(a, b);
  if (articleKey(a) === articleKey(b)) return true;
  if (field !== "journal") return false;
  const tokens = (value: string) => articleKey(value).split(" ").filter((word) => !["of", "the", "and"].includes(word));
  const left = tokens(a), right = tokens(b);
  return left.length === right.length && left.every((word, i) => word.startsWith(right[i]) || right[i].startsWith(word));
}
