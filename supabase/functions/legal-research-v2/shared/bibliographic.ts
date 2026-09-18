/**
 * legal-research-v2 — structured bibliographic identity
 * (academic_bibliographic_identity_v1).
 *
 * Bibliographic metadata identifies a source. It NEVER proves a legal
 * proposition: claims still require a literal, verified body span. Nothing in
 * this module touches verification — it only lets a footnote look like an
 * academic citation instead of "title + raw URL".
 *
 * Provenance is recorded for every field set, so a weak embedded PDF value can
 * never overwrite stronger repository metadata.
 */

import { decodeHtmlEntities } from "./primitives.ts";

export type MetadataBasis =
  | "search_metadata"
  | "html_meta"
  | "pdf_header"
  | "pdf_metadata"
  | "repository_page"
  | "body_text";

export type SourceKind =
  | "journal_article"
  | "book"
  | "book_chapter"
  | "working_paper"
  | "report"
  | "judgment"
  | "statute"
  | "other";

export interface BibliographicMetadata {
  source_kind?: SourceKind;
  title?: string;
  authors?: string[];
  journal?: string;
  volume?: string;
  issue?: string;
  year?: string;
  pages?: string;
  publisher?: string;
  metadata_basis?: MetadataBasis[];
}

/** Trust order, strongest first. Later (weaker) sources only fill gaps. */
const BASIS_STRENGTH: Record<MetadataBasis, number> = {
  repository_page: 6,
  html_meta: 5,
  pdf_metadata: 3,
  pdf_header: 3,
  search_metadata: 2,
  body_text: 1,
};

const clean = (v: unknown): string | undefined => {
  const s = decodeHtmlEntities(String(v ?? "")).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, 300) : undefined;
};

const yearOf = (v: unknown): string | undefined => {
  const m = String(v ?? "").match(/(1[6-9]\d{2}|20\d{2})/);
  return m ? m[1] : undefined;
};

/** Obvious producer/software junk that PDF `Title`/`Author` fields carry. */
export function isGarbageMetadataValue(v: string | undefined): boolean {
  if (!v) return true;
  const s = v.trim();
  if (s.length < 3) return true;
  if (/^(untitled|microsoft word|doc\d*|print|unknown|user|admin|owner|pdfcreator|acrobat)/i.test(s)) {
    return true;
  }
  if (/\.(docx?|pdf|indd|qxd|tex)$/i.test(s)) return true;
  // Unicode-aware: a value is junk only when it carries NO letter or digit at
  // all. `\W` would classify every Hebrew title as garbage.
  if (!/[\p{L}\p{N}]/u.test(s)) return true;
  return false;
}

interface MetaTag {
  name: string;
  content: string;
}

function readMetaTags(html: string): MetaTag[] {
  const out: MetaTag[] = [];
  const re = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html ?? "")) !== null) {
    const tag = m[0];
    const nameM = tag.match(/\b(?:name|property)\s*=\s*["']([^"']+)["']/i);
    const contentM = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i);
    if (!nameM || !contentM) continue;
    out.push({ name: nameM[1].trim().toLowerCase(), content: contentM[1] });
    if (out.length > 400) break;
  }
  return out;
}

/**
 * Parse `citation_*` / Dublin Core metadata exposed by academic repositories
 * (Digital Commons / bepress, SSRN, university repositories, journal sites).
 */
export function parseHtmlBibliographic(html: string): BibliographicMetadata | undefined {
  const tags = readMetaTags(html);
  if (!tags.length) return undefined;
  const first = (...names: string[]): string | undefined => {
    for (const n of names) {
      const hit = tags.find((t) => t.name === n && t.content.trim());
      if (hit) return clean(hit.content);
    }
    return undefined;
  };
  const all = (...names: string[]): string[] => {
    const vals: string[] = [];
    for (const t of tags) {
      if (names.includes(t.name)) {
        const c = clean(t.content);
        if (c && !vals.includes(c)) vals.push(c);
      }
    }
    return vals.slice(0, 12);
  };

  const title = first("citation_title", "dc.title", "og:title");
  const authors = all("citation_author", "dc.creator", "citation_authors");
  const journal = first("citation_journal_title", "citation_conference_title", "dc.source");
  const volume = first("citation_volume");
  const issue = first("citation_issue");
  const year = yearOf(
    first("citation_publication_date", "citation_date", "citation_year", "dc.date") ?? "",
  );
  const firstpage = first("citation_firstpage");
  const lastpage = first("citation_lastpage");
  const publisher = first("citation_publisher", "dc.publisher");

  const meta: BibliographicMetadata = {};
  if (title && !isGarbageMetadataValue(title)) meta.title = title;
  if (authors.length) meta.authors = authors.filter((a) => !isGarbageMetadataValue(a));
  if (journal) meta.journal = journal;
  if (volume) meta.volume = volume;
  if (issue) meta.issue = issue;
  if (year) meta.year = year;
  if (firstpage) meta.pages = lastpage ? `${firstpage}-${lastpage}` : firstpage;
  if (publisher) meta.publisher = publisher;
  if (journal || volume) meta.source_kind = "journal_article";

  if (!Object.keys(meta).length) return undefined;
  // A repository landing page that publishes citation_* tags is the strongest
  // deterministic basis we have; plain og:/dc: pages are ordinary html meta.
  meta.metadata_basis = [
    tags.some((t) => t.name.startsWith("citation_")) ? "repository_page" : "html_meta",
  ];
  return meta;
}

/** The PDF a repository landing page points at (`citation_pdf_url`). */
export function pdfUrlFromHtmlMeta(html: string, baseUrl?: string): string | undefined {
  const tag = readMetaTags(html).find((t) => t.name === "citation_pdf_url" && t.content.trim());
  if (!tag) return undefined;
  const raw = decodeHtmlEntities(tag.content.trim());
  try {
    return baseUrl ? new URL(raw, baseUrl).toString() : new URL(raw).toString();
  } catch {
    return undefined;
  }
}

/** Conservative reading of embedded PDF document information. */
export function parsePdfInfoMetadata(
  info: Record<string, unknown> | null | undefined,
): BibliographicMetadata | undefined {
  if (!info) return undefined;
  const title = clean(info.Title);
  const author = clean(info.Author);
  const year = yearOf(String(info.CreationDate ?? ""));
  const meta: BibliographicMetadata = {};
  if (title && !isGarbageMetadataValue(title)) meta.title = title;
  if (author && !isGarbageMetadataValue(author)) {
    meta.authors = author.split(/\s*[;,&]\s*|\s+and\s+/i).map((a) => a.trim()).filter((a) =>
      a.length >= 3
    ).slice(0, 8);
  }
  if (year) meta.year = year;
  if (!Object.keys(meta).length) return undefined;
  meta.metadata_basis = ["pdf_metadata"];
  return meta;
}

/** Metadata carried by a discovery result (never evidence, only identity). */
export function bibliographicFromSearch(
  input: { title?: string; published_date?: string } | null | undefined,
): BibliographicMetadata | undefined {
  const title = clean(input?.title);
  const year = yearOf(input?.published_date ?? "");
  if ((!title || isGarbageMetadataValue(title)) && !year) return undefined;
  const meta: BibliographicMetadata = { metadata_basis: ["search_metadata"] };
  if (title && !isGarbageMetadataValue(title) && !/^https?:\/\//i.test(title)) meta.title = title;
  if (year) meta.year = year;
  return meta;
}

/**
 * Merge candidates by field, strongest basis wins; weaker candidates only fill
 * fields the stronger one left empty. Provenance accumulates.
 */
export function mergeBibliographic(
  ...candidates: Array<BibliographicMetadata | undefined>
): BibliographicMetadata | undefined {
  const present = candidates.filter((c): c is BibliographicMetadata => !!c && !!Object.keys(c).length);
  if (!present.length) return undefined;
  const strengthOf = (m: BibliographicMetadata) =>
    Math.max(0, ...(m.metadata_basis ?? []).map((b) => BASIS_STRENGTH[b] ?? 0));
  const ordered = [...present].sort((a, b) => strengthOf(b) - strengthOf(a));
  const out: BibliographicMetadata = {};
  const basis: MetadataBasis[] = [];
  for (const m of ordered) {
    for (const b of m.metadata_basis ?? []) if (!basis.includes(b)) basis.push(b);
    if (!out.title && m.title) out.title = m.title;
    if (!out.authors?.length && m.authors?.length) out.authors = m.authors;
    if (!out.journal && m.journal) out.journal = m.journal;
    if (!out.volume && m.volume) out.volume = m.volume;
    if (!out.issue && m.issue) out.issue = m.issue;
    if (!out.year && m.year) out.year = m.year;
    if (!out.pages && m.pages) out.pages = m.pages;
    if (!out.publisher && m.publisher) out.publisher = m.publisher;
    if (!out.source_kind && m.source_kind) out.source_kind = m.source_kind;
  }
  if (basis.length) out.metadata_basis = basis;
  return Object.keys(out).length ? out : undefined;
}

/** True when there is enough structure to render a real academic citation. */
export function hasCitableBibliography(meta: BibliographicMetadata | undefined): boolean {
  if (!meta?.title) return false;
  return !!(meta.authors?.length || meta.journal || meta.year);
}

/**
 * Deterministic academic citation text. Degrades gracefully: never invents a
 * field, never guesses a journal, never fabricates a year.
 *
 *   Author, "Title" Journal Volume (Year) pages
 */
export function formatAcademicCitation(
  meta: BibliographicMetadata | undefined,
  fallbackTitle: string,
): string | null {
  if (!hasCitableBibliography(meta)) return null;
  const m = meta!;
  const title = (m.title ?? fallbackTitle).trim();
  const authors = (m.authors ?? []).slice(0, 3);
  const authorText = authors.length
    ? authors.length <= 2 ? authors.join(" ו") : `${authors[0]} ואחרים`
    : "";
  const journalBits = [m.journal, m.volume].filter(Boolean).join(" ").trim();
  const yearBit = m.year ? `(${m.year})` : "";
  const parts = [
    authorText,
    `"${title.replace(/^["'“”]+|["'“”]+$/g, "")}"`,
    journalBits,
    yearBit,
    m.pages ? m.pages : "",
  ].filter(Boolean);
  // "Author, "Title" Journal Vol (Year) pages"
  const head = authorText ? `${parts[0]}, ${parts.slice(1).join(" ")}` : parts.join(" ");
  return head.replace(/\s+/g, " ").trim();
}
