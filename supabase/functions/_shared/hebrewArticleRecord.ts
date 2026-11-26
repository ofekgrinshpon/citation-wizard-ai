import { articleIdentityMatches, type ArticleRequest, type ArticleEvidence, type ArticleFields } from "./hebrewArticleEvidence.ts";

const decode = (text: string) => text.replace(/&(?:amp|quot|apos|lt|gt|nbsp);|&#(?:x[\da-f]+|\d+);/gi, value => {
  const named: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " " };
  if (named[value.toLowerCase()]) return named[value.toLowerCase()];
  const n = value.startsWith("&#x") ? parseInt(value.slice(3), 16) : parseInt(value.slice(2), 10);
  return Number.isFinite(n) && n <= 0x10ffff ? String.fromCodePoint(n) : value;
});
const textOnly = (text: string) => decode(text.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

/** One article's Highwire metadata or labelled table. No model fields, page
 * timestamps, navigation, other articles' references or cross-page joining. */
export function readHebrewArticleRecord(request: ArticleRequest, html: string, sourceUrl: string): ArticleEvidence[] {
  if (request.kind !== "journal") return [];
  // NLI is admitted only through its dedicated article URLs, never search,
  // authority, book or collection pages. Only explicit article metadata binds.
  if (isNliArticleRecordUrl(sourceUrl)) {
    const linked = readNliArticleMetadata(request, html, sourceUrl);
    if (linked.length) return linked;
  }
  const values = new Map<string, string[]>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs: Record<string, string> = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[match[1].toLowerCase()] = decode(match[2] ?? match[3] ?? "").trim();
    const key = (attrs.name || attrs.property || "").toLowerCase();
    if (!key.startsWith("citation_") || !attrs.content) continue;
    values.set(key, [...(values.get(key) || []), attrs.content]);
  }
  const one = (key: string) => {
    const entries = [...new Set(values.get(key) || [])];
    return entries.length === 1 ? entries[0] : undefined;
  };
  const fields: ArticleFields = { articleTitle: one("citation_title"), author: (values.get("citation_author") || []).join(" ו") || undefined,
    journalName: one("citation_journal_title"), volume: one("citation_volume"), notebook: one("citation_issue"), firstPage: one("citation_firstpage") };
  const date = one("citation_publication_date") || one("citation_date");
  if (date && /^(?:19|20)\d{2}(?:$|[-/])/.test(date)) fields.year = date.slice(0, 4);
  if (fields.firstPage && !/^\d{1,5}$/.test(fields.firstPage)) delete fields.firstPage;
  const metaMatches = articleIdentityMatches(request, fields);
  const metaEvidence: ArticleEvidence[] = metaMatches ? [{ fields, sourceUrl, quote: JSON.stringify(Object.fromEntries(values)), origin: "direct_record" }] : [];
  if (metaMatches && fields.journalName && fields.volume && fields.firstPage && fields.year) return metaEvidence;

  // Structured publication tables are read only when the page heading and an
  // explicit author row bind them to this article. A second table is ambiguous.
  const tables = html.match(/<table\b[^>]*>[\s\S]*?<\/table>/gi) || [];
  const lists = html.match(/<dl\b[^>]*>[\s\S]*?<\/dl>/gi) || [];
  if (tables.length + lists.length !== 1) return metaEvidence;
  const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const tableFields: ArticleFields = { ...(metaMatches ? fields : {}), articleTitle: heading ? textOnly(heading) : fields.articleTitle };
  const names: Record<string, keyof ArticleFields> = { "מחבר": "author", "מחברים": "author", "מאת": "author", "כתב עת": "journalName", "שם כתב העת": "journalName", "כרך": "volume", "חוברת": "notebook", "עמודים": "firstPage", "עמוד ראשון": "firstPage", "שנת פרסום": "year", "שנה": "year", "author": "author", "authors": "author", "journal": "journalName", "volume": "volume", "issue number": "notebook", "pages (from-to)": "firstPage", "publication status": "year" };
  const source = tables[0] || lists[0];
  const rows = tables[0] ? (source.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || []).map(row =>
    [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => textOnly(m[1]))) :
    [...source.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)].map(m => [textOnly(m[1]), textOnly(m[2])]);
  for (const cells of rows) {
    const key = names[cells[0]?.replace(/:$/, "").toLowerCase()];
    if (!key || cells.length !== 2) continue;
    const value = key === "firstPage" ? cells[1].match(/^(\d{1,5})(?:\s*[–—-]\s*\d{1,5})?$/)?.[1] :
      key === "year" ? cells[1].match(/^(?:Published\s*[-–]\s*)?(\d{4})$/i)?.[1] : cells[1];
    if (!value || (key === "year" && !/^\d{4}$/.test(value))) continue;
    if (tableFields[key] && tableFields[key] !== value) return [];
    tableFields[key] = value;
  }
  return articleIdentityMatches(request, tableFields) ? [{ fields: tableFields, sourceUrl, quote: textOnly(source), origin: "direct_record" }] : metaEvidence;
}

export function isNliArticleRecordUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && !u.port && !u.search &&
      ["nli.org.il", "www.nli.org.il"].includes(u.hostname) &&
      /^\/(?:he|en|ar)\/articles\/(?:NNL_ALEPH|RAMBI)\d+\/NLI\/?$/i.test(u.pathname);
  } catch { return false; }
}

/** Schema.org article objects are independent records. No joining with book,
 * navigation or other article objects; no publication dates from page chrome. */
function readNliArticleMetadata(request: ArticleRequest, html: string, sourceUrl: string): ArticleEvidence[] {
  const object = (v: unknown): Record<string, unknown> | undefined => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
  const scalar = (v: unknown): string | undefined => typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : undefined;
  const hasType = (o: Record<string, unknown>, type: string) => [o["@type"]].flat().includes(type);
  const records: ArticleEvidence[] = [];
  for (const script of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let parsed: unknown;
    try { parsed = JSON.parse(script[1]); } catch { continue; }
    const root = object(parsed);
    const nodes = Array.isArray(parsed) ? parsed : Array.isArray(root?.["@graph"]) ? root["@graph"] : [parsed];
    for (const node of nodes) {
      const article = object(node);
      if (!article || !hasType(article, "ScholarlyArticle")) continue;
      const authors = [article.author].flat().map(a => {
        const person = object(a);
        return person && hasType(person, "Person") ? scalar(person.name) : scalar(a);
      });
      if (!authors.length || authors.some(a => !a)) continue;
      let part = object(article.isPartOf);
      const fields: ArticleFields = { articleTitle: scalar(article.headline) || scalar(article.name), author: authors.join(" ו") };
      if (part && hasType(part, "PublicationIssue")) {
        fields.notebook = scalar(part.issueNumber);
        part = object(part.isPartOf);
      }
      if (part && hasType(part, "PublicationVolume")) {
        fields.volume = scalar(part.volumeNumber);
        part = object(part.isPartOf);
      }
      if (part && hasType(part, "Periodical")) fields.journalName = scalar(part.name);
      const first = scalar(article.pageStart);
      if (first && /^\d{1,5}$/.test(first)) fields.firstPage = first;
      const date = scalar(article.datePublished);
      if (date && /^(?:19|20)\d{2}(?:$|[-/])/.test(date)) fields.year = date.slice(0, 4);
      if (articleIdentityMatches(request, fields)) records.push({ fields, sourceUrl, quote: JSON.stringify(article), origin: "direct_record" });
    }
  }
  return records;
}

/** Fixed public academic origins, no credentials/ports/IPs, redirects or
 * crawling. Only URLs returned by the existing discovery request are read. */
export function isHebrewArticleRecordUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      (isNliArticleRecordUrl(value) || ["tau.ac.il", "huji.ac.il", "biu.ac.il", "haifa.ac.il"].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)));
  } catch { return false; }
}

export async function fetchHebrewArticleRecords(request: ArticleRequest, results: unknown, fetchImpl: typeof fetch): Promise<ArticleEvidence[]> {
  if (request.kind !== "journal" || !Array.isArray(results)) return [];
  const urls = [...new Set(results.flatMap(r => r && typeof r === "object" && typeof r.url === "string" && isHebrewArticleRecordUrl(r.url) ? [r.url] : []))]
    .sort((a, b) => Number(isNliArticleRecordUrl(b)) - Number(isNliArticleRecordUrl(a))).slice(0, 2);
  const evidence: ArticleEvidence[] = [];
  for (const url of urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetchImpl(url, { redirect: "manual", signal: controller.signal, headers: { Accept: "text/html" } });
      if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) continue;
      reader = response.body?.getReader();
      if (!reader) continue;
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 1024 * 1024) { controller.abort(); break; }
        chunks.push(part.value);
      }
      if (controller.signal.aborted) continue;
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      evidence.push(...readHebrewArticleRecord(request, new TextDecoder().decode(bytes), url));
    } catch { /* No guessed replacement on unavailable or unreadable pages. */ }
    finally { await reader?.cancel().catch(() => {}); clearTimeout(timer); }
  }
  return evidence;
}