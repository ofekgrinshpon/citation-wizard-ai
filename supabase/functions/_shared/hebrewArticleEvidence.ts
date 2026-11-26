/** Article facts cross this boundary before formatting. Search answers are
 * candidate identities, never evidence for their own bibliographic fields. */
export const ARTICLE_FIELDS = ["author", "articleTitle", "journalName", "bookTitle", "bookAuthor", "volume", "notebook", "firstPage", "year", "hebrewYear", "editor", "edition", "translator", "newspaperSection", "newspaperDate"] as const;
export type ArticleField = typeof ARTICLE_FIELDS[number];
export type ArticleFields = Partial<Record<ArticleField, string>>;
export interface ArticleRequest {
  raw: string;
  kind: "journal" | "article_in_book";
  supplied: ArticleFields;
  topic: string;
  pinpoint: string;
  suppliedCitation?: string;
  /** Unquoted identity stays intact until a source proves both boundaries. */
  freeformIdentity?: string;
}
export interface ArticleEvidence {
  fields: ArticleFields;
  sourceUrl: string;
  quote: string;
  pagination?: "continuous" | "restarted";
  /** Set only by the fetched, identity-bound article record reader. */
  origin?: "direct_record" | "reference";
}
export interface ArticleResolution {
  request: ArticleRequest;
  fields: ArticleFields;
  provenance: Partial<Record<ArticleField, { status: "supplied" | "evidence" | "conflict"; sources: string[] }>>;
  conflicts: ArticleField[];
  matched: boolean;
  renderNotebook?: boolean;
}

const clean = (s: unknown): string => typeof s === "string" ? s.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim() : "";
export const normalizeArticleText = (s: string): string => clean(s).toLowerCase().replace(/[\u0591-\u05bd\u05bf-\u05c2\u05c4-\u05c5\u05c7]/g, "").replace(/["״׳'“”.,:;!?(){}[\]*־–—-]/g, " ").replace(/\s+/g, " ").trim();
const same = (a: string, b: string) => normalizeArticleText(a) === normalizeArticleText(b);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const YEAR = "(?:1[5-9]\\d{2}|20\\d{2}|ה?ת[א-ת\"״׳']{2,7})";
const PINPOINT = /(?:ב?עמוד(?:ים)?|בעמ[׳']|עמ[׳'])\s*(\d+(?:\s*(?:עד|[–—-])\s*\d+)?)/;
const LABELS: Partial<Record<ArticleField, string>> = {
  author: "(?:מחבר(?:י|ים)?(?: המאמר)?|מאת)", articleTitle: "(?:שם המאמר|שם מאמר|כותרת)",
  journalName: "(?:שם כתב העת|כתב עת)", bookTitle: "שם הספר", bookAuthor: "מחבר הספר",
  volume: "כרך", notebook: "חוברת", firstPage: "(?:עמוד ראשון|עמוד תחיל(?:ה|ת המאמר))",
  year: "(?:שנת פרסום לועזית|שנה לועזית|שנת הדפסה|שנת פרסום|שנה)", hebrewYear: "(?:שנת פרסום עברית|שנה עברית)",
  editor: "(?:עורך|עורכים|עורכת|עורכות)", edition: "מהדורה", translator: "(?:מתרגם|מתרגמת|מתרגמים)",
  newspaperSection: "חלק בעיתון", newspaperDate: "תאריך העיתון",
};

const JOURNALS = ["פורום עיוני משפט", "משפטים על אתר", "עיוני משפט", "משפטים", "הפרקליט", "מחקרי משפט", "דין ודברים", "משפט וממשל", "משפט ועסקים", "מעשי משפט", "עלי משפט", "מאזני משפט", "תיאוריה וביקורת", "המשפט", "חוקים", "פלילים"];

function plausibleVolume(value: string): boolean {
  const base = value.split("/")[0].replace(/["״׳']/g, "");
  if (/^\d+$/.test(base)) return true;
  const alphabet = "אבגדהוזחטיכלמנסעפצקרשת";
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 200, 300, 400];
  const numbers = [...base].map(c => values[alphabet.indexOf(c)] || 0);
  return numbers.length > 0 && numbers.every((n, i) => n > 0 && (i === 0 || numbers[i - 1] >= n));
}

function labeledFields(text: string): ArticleFields {
  const fields: ArticleFields = {};
  for (const [field, label] of Object.entries(LABELS)) {
    const value = text.match(new RegExp(`(?:^|[;\\n|])\\s*${label}\\s*:\\s*([^;\\n|]+)`))?.[1]?.trim();
    if (value && !/\[חסר/.test(value)) fields[field as ArticleField] = value;
  }
  if (fields.year && new RegExp(`^ה?ת[א-ת"״׳']{2,7}$`).test(fields.year)) {
    fields.hebrewYear = fields.year;
    delete fields.year;
  }
  if (fields.year && !/^\d{4}$/.test(fields.year)) delete fields.year;
  if (fields.firstPage && !/^\d{1,5}$/.test(fields.firstPage)) delete fields.firstPage;
  return fields;
}

/** Parse the roles in a citation, not loose occurrences of numbers. A date
 * outside this citation (including a result's date property) is never a year. */
function publicationTail(raw: string, kind: ArticleRequest["kind"]): { fields: ArticleFields; pinpoint: string } {
  const fields: ArticleFields = {};
  let tail = clean(raw).replace(/\.\s*$/, "");
  // A pinpoint cannot stand in the opening-page slot, including inside the
  // would-be container captured by the fallback grammar.
  if (kind === "journal" && PINPOINT.test(tail.split(/[,;]/)[0])) return { fields: {}, pinpoint: "" };
  const year = tail.match(new RegExp(`(?:\\(\\s*([^()]*?)\\s*(${YEAR})\\s*\\)|\\s+(${YEAR}))\\s*[.,]?\\s*$`));
  if (year) {
    const value = year[2] || year[3];
    fields[/^\d{4}$/.test(value) ? "year" : "hebrewYear"] = value;
    const extras = year[1]?.trim();
    if (extras && kind === "article_in_book") {
      if (/עורכ|עורך/.test(extras)) fields.editor = extras;
      else if (/מהדורה/.test(extras)) fields.edition = extras;
    }
    tail = tail.slice(0, year.index).trim();
  }
  let container = "";
  const bold = tail.match(/^(.*?)\*\*([^*]+)\*\*\s*(.*)$/);
  if (bold) {
    container = bold[2].trim();
    if (kind === "article_in_book" && bold[1].trim()) fields.bookAuthor = bold[1].trim();
    tail = bold[3].trim().replace(/^כרך\s+/, "");
  } else {
    // Container + volume + opening page are a contiguous bibliographic tuple.
    let tuple = tail.match(/^(.+?)\s+([א-ת][א-ת"״׳']{0,5}(?:\/\d{1,2})?|\d{1,4})((?:\([^()]+\))*)\s+(\d{1,5})(.*)$/);
    if (tuple && !plausibleVolume(tuple[2])) tuple = null;
    const pageOnly = !tuple && tail.match(/^(.+?)\s+(\d{1,5})(.*)$/);
    if (tuple) {
      container = tuple[1];
      tail = `${tuple[2]}${tuple[3] || ""} ${tuple[4]}${tuple[5]}`;
    } else if (pageOnly) {
      container = pageOnly[1];
      tail = pageOnly[2] + pageOnly[3];
    } else if (kind === "journal" && JOURNALS.some(journal => same(tail, journal))) {
      // A supplied journal is useful even without volume, page or date.
      container = tail;
      tail = "";
    }
  }
  if (container) fields[kind === "article_in_book" ? "bookTitle" : "journalName"] = container.trim();
  const pages = tail.match(/^(?:([א-ת][א-ת"״׳']{0,5}(?:\/\d{1,2})?|\d{1,4})((?:\([^()]+\))*)\s+)?(\d{1,5})(?:\s*[–—-]\s*\d{1,5})?(?:\s*,\s*(.+))?\s*$/);
  if (!container) return { fields: {}, pinpoint: "" };
  if (!pages) {
    const volumeOnly = tail.match(/^([א-ת][א-ת"״׳']{0,5}(?:\/\d{1,2})?|\d{1,4})((?:\([^()]+\))*)$/);
    if (volumeOnly) {
      fields.volume = volumeOnly[1];
      if (volumeOnly[2]) fields.notebook = volumeOnly[2].slice(1, -1);
    }
    return { fields, pinpoint: "" };
  }
  if (pages[1]) fields.volume = pages[1];
  if (pages[2]) fields.notebook = pages[2].slice(1, -1);
  fields.firstPage = pages[3];
  return { fields, pinpoint: pages[4]?.replace(/\s+עד\s+/g, "–").trim() || "" };
}

function citationRecords(text: string, kind: ArticleRequest["kind"]): Array<ArticleEvidence & { pinpoint: string }> {
  const records: Array<ArticleEvidence & { pinpoint: string }> = [];
  // Semicolons/newlines delimit records; a citing article's header cannot donate
  // its volume/date to a reference in another record.
  for (const line of text.split(/[;\n]/)) {
    const match = line.match(/^\s*(?:\[?\d+\]?\.?\s+)?(?:ראו\s+|השוו\s+)?([^"“״]+?)\s*["“״]([^"”״]{3,})["”״]\s*(.*)$/);
    if (!match) continue;
    const author = match[1].trim();
    if (!author || author.length > 140 || /(?:מצטט|מזכיר|לפי המאמר|על פי)/.test(author)) continue;
    const tail = publicationTail(match[3], kind);
    records.push({ fields: { author, articleTitle: match[2].trim(), ...tail.fields }, pinpoint: tail.pinpoint, sourceUrl: "", quote: line.trim() });
  }
  return records;
}

export function articleRawInput(prompt: string, rawInput?: unknown): string {
  if (typeof rawInput === "string" && rawInput.trim()) return rawInput.trim();
  // Legacy clients send the engine example and cache hints in the same string.
  return prompt.replace(/\[סיווג אוטומטי:\s*[^\]]+\]\s*/, "")
    .replace(/\n?══ מנוע אזכור[\s\S]*?══════════════════════════════════\n?/g, "")
    .replace(/\n?══ מקור מאומת[\s\S]*$/g, "").trim();
}

// A bare title is supplied identity, not evidence of publication metadata. A
// colon or an opening quotation can belong to the title, including its subtitle.
// Keep labeled, multi-record and natural-language requests on their existing paths.
function bareArticleTitle(raw: string): string | undefined {
  const text = raw.trim();
  if (!text || text.length > 600 || text.split(/\s+/).length > 70 ||
      /[;\n|]|https?:\/\//.test(text) || PINPOINT.test(text) ||
      Object.values(LABELS).some(label => new RegExp(`(?:^|[;\\n|])\\s*${label}\\s*:`).test(text))) return undefined;
  // Remove only a quotation pair enclosing the WHOLE title, never inner quotes.
  const wrapped = text.match(/^["“]([^"“”]+)["”]\.?$/);
  return wrapped ? wrapped[1] : text.replace(/\.$/, "");
}

export function createHebrewArticleRequest(raw: string, inBook = false): ArticleRequest {
  const kind = inBook ? "article_in_book" : "journal";
  const citation = citationRecords(raw.replace(PINPOINT, "").replace(/[,;]\s*\.?\s*$/, ""), kind)[0];
  const supplied: ArticleFields = { ...citation?.fields, ...labeledFields(raw) };
  const pinpoint = raw.match(PINPOINT)?.[1]?.replace(/\s+עד\s+/g, "–") || citation?.pinpoint || "";
  const natural = raw.match(/(?:המאמר|מאמר)\s+של\s+(.+?)\s+(?:על|בנושא|בעניין)\s+(.+?)(?:[,;\n]|\s+ב?עמוד|\.$|$)/);
  let identityRaw = raw;
  if (!inBook && !citation && !natural && !/[;\n|]/.test(raw)) {
    const journal = JOURNALS.find(name => raw.trim().endsWith(` ${name}`));
    if (journal) {
      supplied.journalName = supplied.journalName || journal;
      identityRaw = raw.trim().slice(0, -journal.length).trim();
    }
  }
  if (natural && !supplied.author) supplied.author = natural[1].trim();
  if (!supplied.articleTitle) {
    const bare = !natural && !citation ? bareArticleTitle(identityRaw) : undefined;
    const quoted = raw.match(/["“]([^"”]{3,})["”]/);
    if (bare) supplied.articleTitle = bare;
    else if (quoted) supplied.articleTitle = quoted[1];
  }
  return { raw, kind, supplied, topic: natural?.[2]?.trim().replace(/["“”]/g, "") || "", pinpoint,
    suppliedCitation: citation?.quote,
    freeformIdentity: !inBook && !citation && !natural && !supplied.author && bareArticleTitle(identityRaw) ? bareArticleTitle(identityRaw) : undefined,
  };
}

export function articleIdentityMatches(request: ArticleRequest, fields: ArticleFields): boolean {
  if (!fields.articleTitle || !fields.author) return false;
  if (request.freeformIdentity) {
    const identity = request.freeformIdentity;
    if (![fields.articleTitle, `${fields.author} ${fields.articleTitle}`, `${fields.articleTitle} ${fields.author}`].some(value => same(identity, value))) return false;
  } else if (request.supplied.articleTitle && !same(request.supplied.articleTitle, fields.articleTitle)) return false;
  if (request.supplied.author && !same(request.supplied.author, fields.author)) return false;
  if (request.topic) {
    const titleTokens = normalizeArticleText(fields.articleTitle).split(" ");
    const topicTokens = normalizeArticleText(request.topic).split(" ").filter(t => t.length > 1);
    if (!topicTokens.length || !topicTokens.every(t => titleTokens.includes(t))) return false;
  }
  return !!(request.supplied.articleTitle || request.topic);
}

/** Accept full reference records, or metadata on the target article's own
 * heading. Mere title/author mentions in another work are insufficient. */
export function collectHebrewArticleEvidence(request: ArticleRequest, proposed: Record<string, unknown>, results: unknown, directEvidence: ArticleEvidence[] = []): ArticleEvidence[] {
  if (!Array.isArray(results)) return [];
  const candidate: ArticleFields = {
    articleTitle: clean(proposed.articleTitle || proposed.title) || request.supplied.articleTitle,
    author: clean(proposed.author) || request.supplied.author,
  };
  const records: ArticleEvidence[] = [];
  for (const item of results) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const sourceUrl = clean(r.url);
    if (!/^https?:\/\//.test(sourceUrl)) continue;
    const snippet = clean(r.snippet);
    let judicial = /פסק[־ -]?דין|פסיקה/.test(clean(r.title));
    try {
      judicial ||= /(?:^|\.)(?:court\.gov\.il|nevo\.co\.il|takdin\.co\.il|psakdin\.co\.il)$/.test(new URL(sourceUrl).hostname);
    } catch { continue; }
    // Separated labels are acceptable only inside this article's own record,
    // with both title and author attested. They do not come from proposed JSON.
    const ownFields = labeledFields(snippet);
    if (!judicial && request.kind === "journal" && ownFields.articleTitle && ownFields.author && articleIdentityMatches(request, ownFields) &&
        same(clean(r.title), ownFields.articleTitle)) {
      records.push({ fields: ownFields, sourceUrl, quote: snippet, origin: "reference" });
      continue;
    }
    const references = citationRecords(snippet, request.kind);
    for (const record of references) {
      const f = record.fields;
      // Secondary references must attest every publication role together.
      if (request.kind === "journal" && !(f.author && f.articleTitle && f.journalName && f.volume && f.firstPage && (f.year || f.hebrewYear))) continue;
      const abbreviated = request.kind === "journal" && /^[א-ת][׳']\s+/.test(clean(f.author));
      if ((!abbreviated && articleIdentityMatches(request, f)) || directEvidence.some(e => referenceIdentityFromDirect(request, f, e))) {
        records.push({ ...record, sourceUrl, origin: "reference" });
      }
    }
    if (references.length || (request.kind === "journal" && judicial) || !articleIdentityMatches(request, candidate)) continue;
    const heading = normalizeArticleText(clean(r.title));
    if (!candidate.articleTitle || !candidate.author) continue;
    const title = normalizeArticleText(candidate.articleTitle);
    const author = normalizeArticleText(candidate.author);
    const ownHeading = heading === title || heading === `${title} ${author}` || heading === `${author} ${title}` || heading.startsWith(`${title} |`) || heading.startsWith(`${title} /`);
    if (!ownHeading) continue;
    const normalizedSnippet = normalizeArticleText(snippet);
    // The author must be attributed in this record, not inferred from a URL.
    const labeled = labeledFields(snippet);
    const attributed = (labeled.author && same(labeled.author, candidate.author)) ||
      normalizedSnippet.startsWith(`${title} ${author}`) || normalizedSnippet.startsWith(`${author} ${title}`);
    if (!attributed) continue;
    if (labeled.author && !same(labeled.author, candidate.author)) continue;
    let fields: ArticleFields = { ...candidate, ...labeled };
    // Compact catalog/PDF headers use title + author + publication tuple.
    const headerPatterns = [
      new RegExp(`^\\s*${escape(candidate.articleTitle)}\\s+(?:מאת\\s+)?${escape(candidate.author)}\\s+(.+)$`),
      new RegExp(`^\\s*${escape(candidate.author)}\\s+${escape(candidate.articleTitle)}\\s+(.+)$`),
    ];
    const plain = snippet.replace(/[־–—]/g, "-");
    for (const pattern of headerPatterns) {
      const tail = plain.match(pattern)?.[1];
      if (tail) fields = { ...fields, ...publicationTail(tail, request.kind).fields };
    }
    if (articleIdentityMatches(request, fields)) records.push({ fields, sourceUrl, quote: snippet, origin: "reference" });
  }
  return records;
}

/** Initials are not global aliases. One fetched full-name record must prove
 * this exact title and requested identity before a secondary name can bind. */
function referenceIdentityFromDirect(request: ArticleRequest, fields: ArticleFields, direct: ArticleEvidence): boolean {
  if (direct.origin !== "direct_record" || !articleIdentityMatches(request, direct.fields) ||
      !fields.articleTitle || !direct.fields.articleTitle || !same(fields.articleTitle, direct.fields.articleTitle)) return false;
  const abbreviated = clean(fields.author).match(/^([א-ת])[׳']\s+(.+)$/);
  const full = normalizeArticleText(direct.fields.author || "").split(" ");
  return !!abbreviated && full.length >= 2 && full[0].length > 1 && full[0].startsWith(abbreviated[1]) &&
    same(abbreviated[2], full.slice(1).join(" "));
}

export function resolveHebrewArticle(request: ArticleRequest, evidence: ArticleEvidence[]): ArticleResolution {
  const direct = evidence.filter(e => e.origin === "direct_record" && articleIdentityMatches(request, e.fields));
  const identityMatches = evidence.flatMap(e => {
    if (!(request.kind === "journal" && e.origin === "reference" && /^[א-ת][׳']\s+/.test(clean(e.fields.author))) && articleIdentityMatches(request, e.fields)) return [e];
    const witnesses = direct.filter(d => referenceIdentityFromDirect(request, e.fields, d));
    const authors = new Set(witnesses.map(d => normalizeArticleText(d.fields.author || "")));
    return authors.size === 1 && witnesses[0] ? [{ ...e, fields: { ...e.fields, author: witnesses[0].fields.author } }] : [];
  });
  if (request.freeformIdentity) {
    const identities = new Map(identityMatches.map(e => [normalizeArticleText(`${e.fields.author}|${e.fields.articleTitle}`), e.fields]));
    const identity = identities.size === 1 ? [...identities.values()][0] : undefined;
    if (identity?.author && identity.articleTitle) request = { ...request, supplied: { ...request.supplied, author: identity.author, articleTitle: identity.articleTitle } };
  }
  const publicationFields: ArticleField[] = ["journalName", "bookTitle", "volume", "notebook", "firstPage", "year", "hebrewYear"];
  // A conflicting edition/publication is an incompatible donor as a whole.
  // Preserving the supplied volume while borrowing its page/year makes a hybrid.
  const preferred = identityMatches.filter(e => e.origin !== "reference" || !direct.some(d =>
    publicationFields.some(field => {
      const primary = d.fields[field], secondary = e.fields[field];
      return primary && secondary && !same(primary, secondary);
    })));
  const matching = preferred.filter(e => !publicationFields.some(field => {
    const supplied = request.supplied[field], value = e.fields[field];
    return supplied && value && !same(supplied, value);
  }));
  const fields: ArticleFields = { ...request.supplied };
  const provenance: ArticleResolution["provenance"] = {};
  const conflicts: ArticleField[] = [];
  // A topic can resolve to multiple works. Do not assemble a hybrid citation.
  const identities = new Set(matching.map(e => normalizeArticleText(`${e.fields.author}|${e.fields.articleTitle}`)));
  const ambiguous = identities.size > 1;
  const publicationConflict = ["journalName", "bookTitle", "volume", "firstPage"].some(field =>
    new Set(matching.map(e => e.fields[field as ArticleField]).filter(Boolean).map(v => normalizeArticleText(v!))).size > 1);
  for (const field of ARTICLE_FIELDS) {
    const rows = matching.filter(e => e.fields[field]);
    const rejectedConflict = preferred.some(e => {
      const supplied = request.supplied[field], value = e.fields[field];
      return supplied && value && !same(supplied, value);
    });
    const values = new Set(rows.map(e => normalizeArticleText(e.fields[field]!)));
    const supplied = request.supplied[field];
    const conflict = values.size > 1 || rejectedConflict ||
      (publicationConflict && (field === "year" || field === "hebrewYear"));
    if (conflict || (ambiguous && rows.length > 0)) conflicts.push(field);
    if (supplied) provenance[field] = { status: "supplied", sources: [] };
    else if (conflict || ambiguous) provenance[field] = { status: "conflict", sources: rows.map(e => e.sourceUrl) };
    else if (rows.length) {
      fields[field] = rows[0].fields[field];
      provenance[field] = { status: "evidence", sources: [...new Set(rows.map(e => e.sourceUrl))] };
    }
  }
  // Metadata is not a rule to print an issue. Preserve supplied/cached forms;
  // newly found issue numbers require actual restarted-pagination evidence.
  const issueRows = matching.filter(e => e.fields.notebook && same(e.fields.notebook, fields.notebook || ""));
  const continuous39 = same(fields.journalName || "", "עיוני משפט") && ["לט", "39"].includes(fields.volume || "");
  const renderNotebook = request.kind !== "journal" || !!request.supplied.notebook ||
    issueRows.some(e => e.sourceUrl.startsWith("verified-store:")) ||
    (!continuous39 && issueRows.some(e => e.pagination === "restarted") && !issueRows.some(e => e.pagination === "continuous"));
  return { request, fields, provenance, conflicts, matched: matching.length > 0 && !ambiguous, renderNotebook };
}

/** Presentation projection only; the evidence ledger keeps its issue facts. */
export function hebrewArticlePresentationFields(result: ArticleResolution): ArticleFields {
  const fields = { ...result.fields };
  if (result.renderNotebook === false) delete fields.notebook;
  return fields;
}

/** Classify an existing book-to-journal fallback only when the complete
 * publication tuple is attested by one record. Do not create a new lookup. */
export function groundedHebrewJournalFallback(raw: string, proposed: Record<string, unknown>, results: unknown): ArticleFields | null {
  const request = createHebrewArticleRequest(raw);
  const journal = clean(proposed.journalName);
  const identity = { author: clean(proposed.author), articleTitle: clean(proposed.title) };
  if (!journal || !request.supplied.articleTitle || request.topic || !articleIdentityMatches(request, identity)) return null;
  const evidence = collectHebrewArticleEvidence(request, proposed, results);
  const resolution = resolveHebrewArticle(request, evidence);
  if (!resolution.matched || resolution.conflicts.length) return null;
  const witness = evidence.find(({ fields: f }) =>
    f.author && same(f.author, identity.author) && f.articleTitle && f.journalName && same(f.journalName, journal) &&
    !/^(?:בתוך|בספר)\s/.test(f.journalName) &&
    f.firstPage && (f.year || f.hebrewYear) &&
    (["author", "articleTitle", "journalName", "volume", "notebook", "firstPage", "year", "hebrewYear"] as const).every(field =>
      !resolution.fields[field] || !!f[field] && same(f[field]!, resolution.fields[field]!)));
  return witness?.fields ?? null;
}

/** Cached text still needs the same requested-work identity. Its provenance is
 * an internal record label, not a fabricated external source URL. */
export function cachedHebrewArticleEvidence(request: ArticleRequest, citation: string, sourceName: string): ArticleEvidence[] {
  return citationRecords(citation, request.kind).filter(e => articleIdentityMatches(request, e.fields))
    .map(e => ({ fields: e.fields, quote: e.quote, sourceUrl: `verified-store:${sourceName}` }));
}


export function isCompleteHebrewArticle(result: ArticleResolution): boolean {
  const f = result.fields;
  return !!(f.author && f.articleTitle && (result.request.kind === "article_in_book" ? f.bookTitle : f.journalName) && f.firstPage && (f.year || f.hebrewYear || new RegExp(`^${YEAR}$`).test(f.volume || "")));
}

/** Rule 24's existing template, with immutable facts. Shared server range,
 * Hebrew-year and editor normalizers still run after this function. */
export function renderHebrewArticle(result: ArticleResolution): string {
  const f = hebrewArticlePresentationFields(result);
  const missing = (field: ArticleField, label: string) => f[field] || `[חסר: ${label}]`;
  const inBook = result.request.kind === "article_in_book";
  const container = inBook ? missing("bookTitle", "שם הספר") : missing("journalName", "כתב עת");
  const bookAuthor = inBook && f.bookAuthor && !same(f.author || "", f.bookAuthor) ? `${f.bookAuthor} ` : "";
  const volume = f.volume ? ` ${/\*\*[^*]+\*\*\s+כרך\s+/.test(result.request.raw) ? "כרך " : ""}${f.volume}${f.notebook ? `(${f.notebook})` : ""}` : f.notebook ? ` (${f.notebook})` : "";
  const year = f.year || f.hebrewYear || (new RegExp(`^${YEAR}$`).test(f.volume || "") ? f.volume : "") || "[חסר: שנה]";
  const extras = inBook ? [f.edition, f.editor && (/עורכ|עורך/.test(f.editor) ? f.editor : `${f.editor} עורך`), f.translator].filter(Boolean).join(" ") : "";
  const date = f.newspaperDate || year;
  const ending = f.volume && same(f.volume, date) ? "" : ` (${extras ? `${extras} ` : ""}${date})`;
  const citation = `${missing("author", "מחבר")} "${missing("articleTitle", "שם המאמר")}" ${bookAuthor}**${container}${f.newspaperSection ? `: ${f.newspaperSection}` : ""}**${volume} ${missing("firstPage", "עמוד ראשון")}${result.request.pinpoint ? `, ${result.request.pinpoint}` : ""}${ending}.`;
  if (result.request.suppliedCitation) {
    // The narrow parser must not erase supported but unrepresented components
    // (for example a parasha, a named volume, or several editorial roles).
    // Retain the supplied citation and flag the formatting limit for review.
    const suppliedTokens = normalizeArticleText(result.request.suppliedCitation).split(" ");
    const renderedTokens = new Set(normalizeArticleText(citation.replace(/\[חסר:[^\]]+\]/g, "")).split(" "));
    if (suppliedTokens.some(token => token && !renderedTokens.has(token))) {
      return `${result.request.raw}\n⚠️ חלק מפרטי האזכור שסופקו לא זוהו לעיצוב; הטקסט המקורי נשמר.`;
    }
  }
  return citation + (result.conflicts.length ? "\n⚠️ נמצאו פרטים ביבליוגרפיים סותרים; פרטים שנמסרו בקלט נשמרו." : "");
}
