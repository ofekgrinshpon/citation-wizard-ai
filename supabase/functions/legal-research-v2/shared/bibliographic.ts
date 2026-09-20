/**
 * legal-research-v2 — structured bibliographic identity
 * (academic_bibliographic_identity_v1 + bibliographic_fail_safe_v1).
 *
 * Bibliographic metadata identifies a source. It NEVER proves a legal
 * proposition: claims still require a literal, verified body span. Nothing in
 * this module touches verification — it only lets a footnote look like an
 * academic citation instead of "title + raw URL".
 *
 * Fail-safe discipline (bibliographic_fail_safe_v1):
 *   • embedded PDF info fields are the WEAKEST basis, never the strongest;
 *   • provenance is tracked PER FIELD, so one strong field cannot launder a
 *     weak one;
 *   • suspicious values (file paths, mojibake, producer usernames, sentence
 *     length "titles", staff names on legislation) are dropped, not rendered;
 *   • when fields conflict or look wrong we OMIT them — a bare title beats a
 *     confidently wrong author.
 *
 * Nothing here ever invents or repairs a missing field.
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

export type BibliographicField =
  | "title"
  | "authors"
  | "journal"
  | "volume"
  | "issue"
  | "year"
  | "pages"
  | "publisher";

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
  /** Per-field provenance — one strong field never vouches for another. */
  field_basis?: Partial<Record<BibliographicField, MetadataBasis>>;
  /** Fields deliberately dropped as unreliable (telemetry / diagnosis). */
  dropped_fields?: string[];
}

/**
 * Trust order, strongest first.
 *
 * Embedded PDF info fields sit at the BOTTOM: measured against real runs they
 * carry word-processor junk (`pubdat`, `C:\Working Papers\11883.wpd`), cp1255
 * mojibake and the name of whoever typed the file — which is not the author.
 */
const BASIS_STRENGTH: Record<MetadataBasis, number> = {
  repository_page: 6,
  html_meta: 5,
  search_metadata: 4,
  pdf_header: 3,
  body_text: 2,
  pdf_metadata: 1,
};

/** Bases whose values may only ever FILL a gap, and only if they look clean. */
const WEAK_BASES: MetadataBasis[] = ["pdf_metadata", "body_text"];

export function isWeakBasis(b: MetadataBasis | undefined): boolean {
  return !!b && WEAK_BASES.includes(b);
}

const clean = (v: unknown): string | undefined => {
  const s = decodeHtmlEntities(String(v ?? "")).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, 300) : undefined;
};

const yearOf = (v: unknown): string | undefined => {
  const m = String(v ?? "").match(/(1[6-9]\d{2}|20\d{2})/);
  return m ? m[1] : undefined;
};

/** Mojibake / undecoded byte soup (cp1255 read as latin-1, hex blobs, FFFD). */
export function looksLikeMojibake(v: string): boolean {
  const s = v.trim();
  if (!s) return false;
  if (/\uFFFD/.test(s)) return true;
  // `<E7E5F7...>` style hex dumps, or a bare long hex run.
  if (/^<?[0-9A-F]{8,}>?$/i.test(s.replace(/\s+/g, ""))) return true;
  // Latin-1 rendering of Hebrew cp1255 bytes: dense àáâã…÷ø with no real words.
  const suspicious = (s.match(/[\u00C0-\u00FF]/g) ?? []).length;
  if (suspicious >= 4 && suspicious / s.length > 0.3) return true;
  return false;
}

/** Obvious producer/software junk that PDF `Title`/`Author` fields carry. */
export function isGarbageMetadataValue(v: string | undefined): boolean {
  if (!v) return true;
  const s = v.trim();
  if (s.length < 3) return true;
  if (
    /^(untitled|microsoft word|doc\d*|print|unknown|user|admin|administrator|owner|pdfcreator|acrobat|pubdat|pdfmaker|word|default|temp|test|author|title|normal\.dot)\b/i
      .test(s)
  ) {
    return true;
  }
  // File paths and filenames of any flavour.
  if (/^[a-z]:[\\/]/i.test(s)) return true;
  if (/[\\/][^\\/]+\.(docx?|wpd|pdf|rtf|txt|indd|qxd|tex|odt)$/i.test(s)) return true;
  if (/\.(docx?|wpd|pdf|rtf|indd|qxd|tex|odt)$/i.test(s)) return true;
  if (looksLikeMojibake(s)) return true;
  // Machine identifiers: no spaces plus underscores/long digit runs.
  if (!/\s/.test(s) && /[_]{1,}|\d{6,}/.test(s)) return true;
  // Unicode-aware: a value is junk only when it carries NO letter or digit at
  // all. `\W` would classify every Hebrew title as garbage.
  if (!/[\p{L}\p{N}]/u.test(s)) return true;
  return false;
}

/** A title must look like a title, not like a sentence lifted from the body. */
export function isGarbageTitleValue(v: string | undefined): boolean {
  if (isGarbageMetadataValue(v)) return true;
  const s = v!.trim();
  if (/^https?:\/\//i.test(s)) return true;
  // Sentence-length running prose masquerading as a title.
  const words = s.split(/\s+/).length;
  if (words > 25) return true;
  if (/[.!?]\s+\p{L}/u.test(s) && words > 12) return true;
  // A generic API/search endpoint label.
  if (/^(works|search|results|items|records|index|api)$/i.test(s)) return true;
  return false;
}

/** An author must look like a person (or a named institution), not metadata. */
export function isGarbageAuthorValue(v: string | undefined): boolean {
  if (isGarbageMetadataValue(v)) return true;
  const s = v!.trim();
  if (/\d/.test(s)) return true;
  if (/@|https?:\/\//i.test(s)) return true;
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length > 6) return true;
  // A single bare first name ("רונית", "Dana") is a malformed author field.
  if (words.length < 2) return true;
  return false;
}

/** Legislation and judgments never carry a personal "author". */
export function kindForbidsPersonalAuthor(kind: SourceKind | undefined): boolean {
  return kind === "statute" || kind === "judgment";
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
  if (title && !isGarbageTitleValue(title)) meta.title = title;
  if (authors.length) {
    const kept = authors.filter((a) => !isGarbageAuthorValue(a));
    if (kept.length) meta.authors = kept;
  }
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
  const basis: MetadataBasis = tags.some((t) => t.name.startsWith("citation_"))
    ? "repository_page"
    : "html_meta";
  return withBasis(meta, basis);
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

/** Stamp one basis on every field this candidate actually carries. */
function withBasis(meta: BibliographicMetadata, basis: MetadataBasis): BibliographicMetadata {
  const field_basis: Partial<Record<BibliographicField, MetadataBasis>> = {};
  const fields: BibliographicField[] = [
    "title",
    "authors",
    "journal",
    "volume",
    "issue",
    "year",
    "pages",
    "publisher",
  ];
  for (const f of fields) {
    const v = (meta as Record<string, unknown>)[f];
    if (Array.isArray(v) ? v.length : v) field_basis[f] = basis;
  }
  meta.metadata_basis = [basis];
  meta.field_basis = field_basis;
  return meta;
}

/**
 * Conservative reading of embedded PDF document information.
 *
 * This is the weakest basis in the system. Values pass the strict title/author
 * quality checks here as well as at merge time, so obvious junk never even
 * enters the candidate set.
 */
export function parsePdfInfoMetadata(
  info: Record<string, unknown> | null | undefined,
): BibliographicMetadata | undefined {
  if (!info) return undefined;
  const title = clean(info.Title);
  const author = clean(info.Author);
  const year = yearOf(String(info.CreationDate ?? ""));
  const meta: BibliographicMetadata = {};
  const dropped: string[] = [];
  if (title) {
    if (isGarbageTitleValue(title)) dropped.push("title:pdf_metadata_unreliable");
    else meta.title = title;
  }
  if (author) {
    const parts = author.split(/\s*[;,&]\s*|\s+and\s+/i).map((a) => a.trim()).filter(Boolean)
      .slice(0, 8);
    const kept = parts.filter((a) => !isGarbageAuthorValue(a));
    if (kept.length) meta.authors = kept;
    else if (parts.length) dropped.push("authors:pdf_metadata_unreliable");
  }
  if (year) meta.year = year;
  if (!Object.keys(meta).length) {
    return dropped.length
      ? { metadata_basis: ["pdf_metadata"], dropped_fields: dropped }
      : undefined;
  }
  const out = withBasis(meta, "pdf_metadata");
  if (dropped.length) out.dropped_fields = dropped;
  return out;
}

/** Metadata carried by a discovery result (never evidence, only identity). */
export function bibliographicFromSearch(
  input: { title?: string; published_date?: string } | null | undefined,
): BibliographicMetadata | undefined {
  const title = clean(input?.title);
  const year = yearOf(input?.published_date ?? "");
  const usableTitle = title && !isGarbageTitleValue(title) ? title : undefined;
  if (!usableTitle && !year) return undefined;
  const meta: BibliographicMetadata = {};
  if (usableTitle) meta.title = usableTitle;
  if (year) meta.year = year;
  return withBasis(meta, "search_metadata");
}

/**
 * Merge candidates by field, strongest basis wins; weaker candidates only fill
 * fields the stronger one left empty, and a WEAK basis (embedded PDF info,
 * body text) may only fill a gap when the value also passes the strict
 * per-field quality checks. Provenance accumulates per field.
 */
export function mergeBibliographic(
  ...candidates: Array<BibliographicMetadata | undefined>
): BibliographicMetadata | undefined {
  const present = candidates.filter((c): c is BibliographicMetadata =>
    !!c && (!!Object.keys(c).length)
  );
  if (!present.length) return undefined;
  const strengthOf = (m: BibliographicMetadata) =>
    Math.max(0, ...(m.metadata_basis ?? []).map((b) => BASIS_STRENGTH[b] ?? 0));
  const ordered = [...present].sort((a, b) => strengthOf(b) - strengthOf(a));

  const out: BibliographicMetadata = {};
  const basis: MetadataBasis[] = [];
  const field_basis: Partial<Record<BibliographicField, MetadataBasis>> = {};
  const dropped: string[] = [];

  const basisFor = (m: BibliographicMetadata, f: BibliographicField): MetadataBasis =>
    m.field_basis?.[f] ?? m.metadata_basis?.[0] ?? "body_text";

  const take = (
    f: BibliographicField,
    m: BibliographicMetadata,
    value: unknown,
    quality?: (v: string) => boolean,
  ) => {
    if (Array.isArray(value) ? !value.length : !value) return;
    if ((out as Record<string, unknown>)[f] !== undefined) return;
    const b = basisFor(m, f);
    if (isWeakBasis(b) && quality) {
      const vals = Array.isArray(value) ? value as string[] : [String(value)];
      const ok = vals.filter((v) => quality(v));
      if (!ok.length) {
        dropped.push(`${f}:weak_basis_failed_quality`);
        return;
      }
      (out as Record<string, unknown>)[f] = Array.isArray(value) ? ok : ok[0];
    } else {
      (out as Record<string, unknown>)[f] = value;
    }
    field_basis[f] = b;
  };

  for (const m of ordered) {
    for (const b of m.metadata_basis ?? []) if (!basis.includes(b)) basis.push(b);
    for (const d of m.dropped_fields ?? []) if (!dropped.includes(d)) dropped.push(d);
    take("title", m, m.title, (v) => !isGarbageTitleValue(v));
    take("authors", m, m.authors, (v) => !isGarbageAuthorValue(v));
    take("journal", m, m.journal, (v) => !isGarbageMetadataValue(v));
    take("volume", m, m.volume);
    take("issue", m, m.issue);
    take("year", m, m.year);
    take("pages", m, m.pages);
    take("publisher", m, m.publisher, (v) => !isGarbageMetadataValue(v));
    if (!out.source_kind && m.source_kind) out.source_kind = m.source_kind;
  }
  if (basis.length) out.metadata_basis = basis;
  if (Object.keys(field_basis).length) out.field_basis = field_basis;
  if (dropped.length) out.dropped_fields = dropped;
  return Object.keys(out).length ? out : undefined;
}

/** Discovery / API endpoints that are never themselves a citable document. */
const DISCOVERY_ENDPOINT_RE =
  /^(api\.crossref\.org|api\.openalex\.org|api\.semanticscholar\.org|api\.datacite\.org|export\.arxiv\.org|www\.googleapis\.com|serpapi\.com)$/i;

export function isDiscoveryEndpointUrl(url: string | undefined): boolean {
  if (!url) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  if (DISCOVERY_ENDPOINT_RE.test(host)) return true;
  if (/(^|\.)crossref\.org$/i.test(host) && /^\/works\/?$/i.test(u.pathname) && u.search) return true;
  // Generic search endpoints: a query page is a discovery entry, not a document.
  if (/\/(search|results)\b/i.test(u.pathname) && u.search) return true;
  return false;
}

/** Deterministic source-kind inference from URL and title. Never a trust signal. */
export function inferSourceKind(
  input: { url?: string; title?: string; declared?: SourceKind },
): SourceKind | undefined {
  if (input.declared) return input.declared;
  const t = (input.title ?? "").trim();
  const url = (input.url ?? "").toLowerCase();
  if (/(^|\s)(חוק|פקודת|תקנות|חוק־יסוד|חוק יסוד)\s/u.test(t) || /^חוק־?\s?יסוד/u.test(t)) {
    return "statute";
  }
  if (/knesset\.gov\.il/.test(url) && /(law|yesod|huka)/.test(url)) return "statute";
  if (/\b(בג"?ץ|ע"?א|רע"?א|ע"?פ|בש"?פ|ת"?א|עע"?ם)\s*\d{1,6}\s*\/\s*\d{2,4}/u.test(t)) {
    return "judgment";
  }
  if (/court\.gov\.il|bailii\.org|supremecourt\.uk|courtlistener\.com/.test(url)) return "judgment";
  return undefined;
}

/**
 * Source-kind guardrails: prevent absurd citations before they are rendered.
 *
 * A statute does not have a personal author; a judgment is not a journal
 * article; a discovery endpoint is not scholarship. When a field contradicts
 * the source kind it is DROPPED — never repaired, never replaced.
 */
export function sanitizeBibliographic(
  meta: BibliographicMetadata | undefined,
  context: { kind?: SourceKind; url?: string; title?: string } = {},
): BibliographicMetadata | undefined {
  if (!meta) return undefined;
  const kind = context.kind ?? meta.source_kind ??
    inferSourceKind({ url: context.url, title: context.title ?? meta.title });
  const out: BibliographicMetadata = { ...meta };
  const dropped = [...(meta.dropped_fields ?? [])];

  if (out.title && isGarbageTitleValue(out.title)) {
    delete out.title;
    dropped.push("title:failed_quality");
  }
  if (out.authors?.length) {
    const kept = out.authors.filter((a) => !isGarbageAuthorValue(a));
    if (kept.length !== out.authors.length) dropped.push("authors:failed_quality");
    if (kept.length) out.authors = kept;
    else delete out.authors;
  }
  if (kindForbidsPersonalAuthor(kind) && out.authors?.length) {
    delete out.authors;
    dropped.push(`authors:not_valid_for_${kind}`);
  }
  if (kind === "statute" || kind === "judgment") {
    if (out.journal) {
      delete out.journal;
      dropped.push(`journal:not_valid_for_${kind}`);
    }
    if (out.volume) delete out.volume;
    if (out.pages) delete out.pages;
  }
  if (isDiscoveryEndpointUrl(context.url)) {
    // A search endpoint may supply discovery, never a scholarly identity.
    return { metadata_basis: meta.metadata_basis, dropped_fields: [...dropped, "all:discovery_endpoint"] };
  }
  if (kind) out.source_kind = kind;
  if (dropped.length) out.dropped_fields = dropped;
  if (out.field_basis) {
    for (const f of Object.keys(out.field_basis) as BibliographicField[]) {
      if ((out as Record<string, unknown>)[f] === undefined) delete out.field_basis[f];
    }
  }
  const meaningful = ["title", "authors", "journal", "year", "volume", "pages", "publisher"]
    .some((f) => {
      const v = (out as Record<string, unknown>)[f];
      return Array.isArray(v) ? v.length : !!v;
    });
  return meaningful ? out : { metadata_basis: out.metadata_basis, dropped_fields: dropped };
}

/** True when there is enough structure to render a real academic citation. */
export function hasCitableBibliography(meta: BibliographicMetadata | undefined): boolean {
  if (!meta?.title) return false;
  if (isGarbageTitleValue(meta.title)) return false;
  if (kindForbidsPersonalAuthor(meta.source_kind)) return false;
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
  const authors = (m.authors ?? []).slice(0, 3).filter((a) => !isGarbageAuthorValue(a));
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
