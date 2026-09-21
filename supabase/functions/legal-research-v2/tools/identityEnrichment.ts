/**
 * legal-research-v2 — bounded same-work IDENTITY enrichment
 * (same_work_identity_enrichment_v1).
 *
 * Live same-work recovery fails almost exclusively because discovery returns a
 * title and a URL and nothing else, so `isSameWork()` cannot rise above
 * `title_only_insufficient`. This module answers ONE question for ONE
 * plausible candidate:
 *
 *     does this candidate carry enough real bibliographic identity to decide,
 *     deterministically, whether it is another copy of the SAME work?
 *
 * What this module is NOT:
 *   • not evidence. Nothing gathered here may be quoted, cited, stored as
 *     scholarship or shown to the verifier. It is identity metadata only;
 *   • not a loosening of equivalence. `isSameWork()` is untouched: a title-only
 *     match stays insufficient, before and after enrichment;
 *   • not a metadata crawl. One landing-page read, one structured lookup and
 *     one title-based lookup per candidate, all bounded and deduped.
 */

import {
  isSameWork,
  titleSimilarity,
  type EquivalenceVerdict,
  type WorkIdentity,
} from "./alternativeCopy.ts";
import {
  isGarbageAuthorValue,
  isGarbageTitleValue,
  parseHtmlBibliographic,
} from "../shared/bibliographic.ts";

export const ENRICHMENT_LIMITS = {
  /** Landing-page metadata reads per candidate. */
  MAX_LANDING_PAGE_FETCHES: 1,
  /** DOI-metadata reads per candidate. */
  MAX_DOI_LOOKUPS: 1,
  /** Title-based metadata-service queries per candidate. */
  MAX_TITLE_LOOKUPS: 1,
  /** Candidates enriched per failed work. */
  MAX_CANDIDATES_PER_WORK: 2,
  /** Title overlap below which a candidate is never worth enriching. */
  MIN_TITLE_SIMILARITY: 0.7,
  TIMEOUT_MS: 8000,
  MAX_HTML_BYTES: 300_000,
} as const;

export type IdentityBasis =
  | "repository_page"
  | "doi_metadata"
  | "html_meta"
  | "metadata_service"
  | "search_metadata";

/** Trust order for identity fields, strongest first. */
const IDENTITY_STRENGTH: Record<IdentityBasis, number> = {
  repository_page: 5,
  doi_metadata: 4,
  html_meta: 3,
  metadata_service: 2,
  search_metadata: 1,
};

export interface EnrichedWorkIdentity extends WorkIdentity {
  basis: {
    title?: IdentityBasis;
    authors?: IdentityBasis;
    year?: IdentityBasis;
    journal?: IdentityBasis;
    doi?: IdentityBasis;
  };
}

export interface EnrichmentTelemetry {
  triggered: boolean;
  landing_meta: number;
  doi_lookup: number;
  crossref: number;
  openalex: number;
  search_metadata: number;
  fields_gained: string[];
  conflict: boolean;
  success: boolean;
  still_insufficient: boolean;
  basis?: IdentityBasis[];
}

export function emptyEnrichmentTelemetry(): EnrichmentTelemetry {
  return {
    triggered: false,
    landing_meta: 0,
    doi_lookup: 0,
    crossref: 0,
    openalex: 0,
    search_metadata: 0,
    fields_gained: [],
    conflict: false,
    success: false,
    still_insufficient: false,
  };
}

/** Strictly syntactic DOI normalization — never semantic. */
export function normalizeDoi(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const s = String(raw)
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .replace(/[.,;)\]]+$/, "")
    .trim()
    .toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(s) ? s : undefined;
}

const DOI_IN_TEXT = /\b10\.\d{4,9}\/[^\s"'<>)\]]+/i;

/** A DOI already implied by the candidate URL (repository and publisher URLs). */
export function doiFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const decoded = decodeURIComponent(url);
    return normalizeDoi(DOI_IN_TEXT.exec(decoded)?.[0]);
  } catch {
    return normalizeDoi(DOI_IN_TEXT.exec(url)?.[0]);
  }
}

/** "Gilson, Ronald J." / "R. Gilson" → comparable author strings. */
export function normalizeAuthorName(raw: string): string {
  const s = String(raw).replace(/\s+/g, " ").trim();
  if (s.includes(",")) {
    const [surname, rest] = s.split(",", 2);
    return `${rest.trim()} ${surname.trim()}`.replace(/\s+/g, " ").trim();
  }
  return s;
}

function cleanAuthors(values: unknown): string[] | undefined {
  const raw = Array.isArray(values) ? values : [];
  const out: string[] = [];
  for (const v of raw) {
    const name = normalizeAuthorName(String(v ?? ""));
    if (!name || isGarbageAuthorValue(name)) continue;
    if (!out.includes(name)) out.push(name);
    if (out.length >= 12) break;
  }
  return out.length ? out : undefined;
}

function cleanTitle(v: unknown): string | undefined {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  if (!s || isGarbageTitleValue(s)) return undefined;
  return s.slice(0, 300);
}

function yearOf(v: unknown): string | undefined {
  const m = String(v ?? "").match(/\b(1[6-9]\d{2}|20\d{2})\b/);
  return m ? m[1] : undefined;
}

/** Merge one basis-tagged contribution into the identity, strongest wins. */
function contribute(
  target: EnrichedWorkIdentity,
  basis: IdentityBasis,
  fields: Partial<WorkIdentity>,
  gained: string[],
): void {
  const better = (f: keyof EnrichedWorkIdentity["basis"]) => {
    const cur = target.basis[f];
    return !cur || IDENTITY_STRENGTH[basis] > IDENTITY_STRENGTH[cur];
  };
  if (fields.title && better("title")) {
    if (!target.title) gained.push("title");
    target.title = fields.title;
    target.basis.title = basis;
  }
  if (fields.authors?.length && better("authors")) {
    if (!target.authors?.length) gained.push("authors");
    target.authors = fields.authors;
    target.basis.authors = basis;
  }
  if (fields.year && better("year")) {
    if (!target.year) gained.push("year");
    target.year = fields.year;
    target.basis.year = basis;
  }
  if (fields.journal && better("journal")) {
    if (!target.journal) gained.push("journal");
    target.journal = fields.journal;
    target.basis.journal = basis;
  }
  if (fields.doi && better("doi")) {
    if (!target.doi) gained.push("doi");
    target.doi = fields.doi;
    target.basis.doi = basis;
  }
}

export interface EnrichmentDeps {
  /** Public HTML read of the candidate landing page. Identity only. */
  fetchHtml?: (url: string) => Promise<string | undefined>;
  /** DOI content negotiation (doi.org / Crossref works/{doi}). Identity only. */
  fetchDoiMetadata?: (doi: string) => Promise<Record<string, unknown> | undefined>;
  /** Title-based metadata service (Crossref or OpenAlex). Identity only. */
  fetchTitleMetadata?: (
    title: string,
    hint: { author?: string; year?: string },
  ) => Promise<{ service?: "crossref" | "openalex"; record?: Record<string, unknown> } | undefined>;
}

/** Normalize a Crossref / OpenAlex / doi.org record into identity fields. */
export function identityFromMetadataRecord(
  rec: Record<string, unknown> | undefined,
): Partial<WorkIdentity> {
  if (!rec || typeof rec !== "object") return {};
  const r = rec as Record<string, any>;
  const title = cleanTitle(
    Array.isArray(r.title) ? r.title[0] : r.title ?? r.display_name,
  );
  const authorsRaw: unknown[] = Array.isArray(r.author)
    ? r.author.map((a: any) =>
      a?.name ?? [a?.given, a?.family].filter(Boolean).join(" ")
    )
    : Array.isArray(r.authorships)
    ? r.authorships.map((a: any) => a?.author?.display_name)
    : [];
  const journal = cleanTitle(
    Array.isArray(r["container-title"])
      ? r["container-title"][0]
      : r["container-title"] ??
        r?.primary_location?.source?.display_name,
  );
  const year = yearOf(
    r?.issued?.["date-parts"]?.[0]?.[0] ??
      r.publication_year ??
      r.created?.["date-time"] ??
      r.publication_date,
  );
  const doi = normalizeDoi(typeof r.doi === "string" ? r.doi : r.DOI);
  const out: Partial<WorkIdentity> = {};
  if (title) out.title = title;
  const authors = cleanAuthors(authorsRaw);
  if (authors) out.authors = authors;
  if (journal) out.journal = journal;
  if (year) out.year = year;
  if (doi) out.doi = doi;
  return out;
}

/**
 * Enrichment is attempted only for a candidate that is ALREADY plausible and
 * was rejected purely for missing corroborating identity. Title mismatches,
 * contradicted identity and unsafe hosts never reach this function.
 */
export function shouldEnrich(
  wanted: WorkIdentity,
  candidate: WorkIdentity,
  verdict: EquivalenceVerdict,
): boolean {
  if (verdict.same_work) return false;
  if (verdict.basis !== "title_only_insufficient" && verdict.basis !== "insufficient_identity") {
    return false;
  }
  if (!wanted.title || !candidate.title) return false;
  return titleSimilarity(wanted.title, candidate.title) >= ENRICHMENT_LIMITS.MIN_TITLE_SIMILARITY;
}

export interface EnrichmentOutcome {
  identity: EnrichedWorkIdentity;
  verdict: EquivalenceVerdict;
  telemetry: EnrichmentTelemetry;
  /** Set when the candidate is a different work beyond doubt (DOI conflict). */
  hard_reject?: boolean;
}

/**
 * One bounded enrichment round for one candidate, followed by the SAME
 * deterministic equivalence check. No model judgement anywhere in this path.
 */
export async function enrichAndCompare(input: {
  /** TRUSTED identity of the original work. Only this may prove equivalence. */
  wanted: WorkIdentity;
  candidate: WorkIdentity;
  candidate_url?: string;
  /**
   * UNTRUSTED, search-only hint (may be model-supplied). It may narrow a
   * metadata query; it never enters `isSameWork()` as a fact.
   */
  search_hint?: { author?: string; year?: string };
  deps: EnrichmentDeps;
}): Promise<EnrichmentOutcome> {
  const tel = emptyEnrichmentTelemetry();
  tel.triggered = true;

  const identity: EnrichedWorkIdentity = { ...input.candidate, basis: {} };
  if (identity.title) identity.basis.title = "search_metadata";
  if (identity.year) identity.basis.year = "search_metadata";
  if (identity.doi) {
    identity.doi = normalizeDoi(identity.doi) ?? undefined;
    identity.basis.doi = "search_metadata";
  }
  if (identity.title || identity.year || identity.doi) tel.search_metadata = 1;

  const gained: string[] = [];
  const urlDoi = doiFromUrl(input.candidate_url);
  if (urlDoi) contribute(identity, "html_meta", { doi: urlDoi }, gained);

  // A — candidate landing-page metadata (one read).
  if (input.deps.fetchHtml && input.candidate_url) {
    try {
      const html = await input.deps.fetchHtml(input.candidate_url);
      if (html) {
        tel.landing_meta = 1;
        const page = html.slice(0, ENRICHMENT_LIMITS.MAX_HTML_BYTES);
        const meta = parseHtmlBibliographic(page);
        // A DOI printed on the page is identity even when no other metadata parses.
        contribute(identity, "repository_page", {
          title: cleanTitle(meta?.title),
          authors: cleanAuthors(meta?.authors),
          year: meta?.year,
          journal: cleanTitle(meta?.journal),
          doi: normalizeDoi(DOI_IN_TEXT.exec(page)?.[0]),
        }, gained);
      }
    } catch { /* identity enrichment never fails a run */ }
  }

  // B — DOI metadata (one lookup) for whichever DOI we now hold.
  const doiToResolve = identity.doi ?? normalizeDoi(input.wanted.doi);
  if (input.deps.fetchDoiMetadata && doiToResolve) {
    try {
      const rec = await input.deps.fetchDoiMetadata(doiToResolve);
      if (rec) {
        tel.doi_lookup = 1;
        contribute(identity, "doi_metadata", identityFromMetadataRecord(rec), gained);
      }
    } catch { /* ignored */ }
  }

  // C — one title-based metadata-service query, only if still undecided.
  const needsMore = !identity.doi && !identity.authors?.length && !identity.year;
  if (input.deps.fetchTitleMetadata && needsMore && identity.title) {
    try {
      const res = await input.deps.fetchTitleMetadata(identity.title, {
        author: input.wanted.authors?.[0] ?? input.search_hint?.author,
        year: input.wanted.year ?? input.search_hint?.year,
      });
      if (res?.record) {
        if (res.service === "openalex") tel.openalex = 1;
        else tel.crossref = 1;
        const fields = identityFromMetadataRecord(res.record);
        // The service must be talking about the same title, or it is noise.
        if (
          fields.title &&
          titleSimilarity(identity.title, fields.title) >= ENRICHMENT_LIMITS.MIN_TITLE_SIMILARITY
        ) {
          contribute(identity, "metadata_service", fields, gained);
        }
      }
    } catch { /* ignored */ }
  }

  tel.fields_gained = gained;
  tel.basis = Array.from(
    new Set(Object.values(identity.basis).filter(Boolean) as IdentityBasis[]),
  );

  // A conflicting DOI is decisive and overrides any title similarity.
  const wantedDoi = normalizeDoi(input.wanted.doi);
  if (wantedDoi && identity.doi && wantedDoi !== identity.doi) {
    tel.conflict = true;
    tel.still_insufficient = false;
    return {
      identity,
      verdict: { same_work: false, basis: "doi_exact", title_similarity: titleSimilarity(input.wanted.title, identity.title) },
      telemetry: tel,
      hard_reject: true,
    };
  }

  // Compare DOIs in canonical form only — never a raw doi.org URL against a bare DOI.
  const verdict = isSameWork({ ...input.wanted, doi: wantedDoi }, identity);
  tel.success = verdict.same_work;
  tel.still_insufficient = !verdict.same_work;
  return { identity, verdict, telemetry: tel };
}

export interface EnrichmentStats {
  same_work_enrichment_triggered: number;
  same_work_enrichment_landing_meta: number;
  same_work_enrichment_doi_lookup: number;
  same_work_enrichment_crossref: number;
  same_work_enrichment_openalex: number;
  same_work_enrichment_search_metadata: number;
  same_work_enrichment_success: number;
  same_work_enrichment_still_insufficient: number;
  same_work_enrichment_conflict: number;
  same_work_recovered_after_enrichment: number;
  same_work_equivalence_basis: string[];
  same_work_enrichment_basis: string[];
}

export function emptyEnrichmentStats(): EnrichmentStats {
  return {
    same_work_enrichment_triggered: 0,
    same_work_enrichment_landing_meta: 0,
    same_work_enrichment_doi_lookup: 0,
    same_work_enrichment_crossref: 0,
    same_work_enrichment_openalex: 0,
    same_work_enrichment_search_metadata: 0,
    same_work_enrichment_success: 0,
    same_work_enrichment_still_insufficient: 0,
    same_work_enrichment_conflict: 0,
    same_work_recovered_after_enrichment: 0,
    same_work_equivalence_basis: [],
    same_work_enrichment_basis: [],
  };
}

export function noteEnrichment(stats: EnrichmentStats, tel: EnrichmentTelemetry): void {
  if (!tel.triggered) return;
  stats.same_work_enrichment_triggered += 1;
  stats.same_work_enrichment_landing_meta += tel.landing_meta;
  stats.same_work_enrichment_doi_lookup += tel.doi_lookup;
  stats.same_work_enrichment_crossref += tel.crossref;
  stats.same_work_enrichment_openalex += tel.openalex;
  stats.same_work_enrichment_search_metadata += tel.search_metadata;
  if (tel.conflict) stats.same_work_enrichment_conflict += 1;
  if (tel.success) {
    stats.same_work_enrichment_success += 1;
    stats.same_work_recovered_after_enrichment += 1;
  } else if (tel.still_insufficient) {
    stats.same_work_enrichment_still_insufficient += 1;
  }
  for (const b of tel.basis ?? []) {
    if (!stats.same_work_enrichment_basis.includes(b)) stats.same_work_enrichment_basis.push(b);
  }
}
