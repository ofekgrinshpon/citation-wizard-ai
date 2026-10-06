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
  const publisher = start.match(/^([A-Z][A-Za-z.&'’ -]+?),?\s+Vol(?:ume)?\.?\s+([IVXLCDM]+|\d+)(?:,?\s+Issue\s+\d+)?,?\s*(?:[A-Za-z]+\s+)?((?:1[6-9]|20)\d{2}),?\s+(?:pp?\.?|Pages)\s*(\d+)/i);
  if (publisher && plausibleJournal(publisher[1])) return { journal: publisher[1].trim(), volume: romanNumber(publisher[2]), year: publisher[3], firstPage: publisher[4] };
  return null;
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
  // Search each text separately: concatenating a heading and unrelated body
  // would create a citation relationship that the evidence never asserted.
  for (const text of [source.title ?? "", source.snippet ?? ""]) {
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
  if (!records.length && articleHeadingMatches(source.title ?? "", target)) {
    const snippet = (source.snippet ?? "").trim();
    let fields = publicationAtStart(snippet);
    let authors = (source.title ?? "").split(/\s+[—–|]\s+|\s+-\s+/)
      .map((part) => part.replace(/^by\s+/i, "").trim())
      .find((part) => articleKey(part) !== articleKey(target) && isAuthorList(part)
        && !/\b(?:Journal|Review|Press|University|Repository|Archive|Library|Law)\b/i.test(part)
        && (!!anchors.authors || part.includes(" ")));
    if (!fields) {
      const leading = snippet.match(/^(.{2,150}?)(?:\n|\s+[—|]\s+|\.\s+(?=\d)|,\s*(?=\d))/);
      if (leading && isAuthorList(leading[1].trim())) {
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
