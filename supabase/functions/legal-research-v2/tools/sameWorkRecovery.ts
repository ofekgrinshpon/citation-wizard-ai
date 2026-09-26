/**
 * legal-research-v2 — live same-work recovery orchestration
 * (same_work_live_recovery_v1).
 *
 * One job: when an already-identified work fails acquisition at the URL we
 * found it at, run ONE bounded rediscovery query for the SAME work and let
 * DETERMINISTIC code — never the model — decide whether a candidate really is
 * the same work.
 *
 * What this module is NOT:
 *   • not evidence — an accepted candidate is fetched, extracted, document
 *     checked, stored, quoted, span-verified and support-verified exactly like
 *     any other body. Recovery grants no trust whatsoever;
 *   • not a retry loop — ≤3 identity queries per work, bounded results,
 *     ≤3 equivalence-proven fetch attempts, dead URLs never retried;
 *   • not a paywall / login / CAPTCHA workaround — it looks for another
 *     publicly accessible copy of the same public document, nothing else.
 */

import type { SearchResult } from "../types.ts";
import type { BibliographicMetadata, MetadataBasis } from "../shared/bibliographic.ts";
import {
  buildAlternativeCopyQuery,
  isAcceptableAlternativeHost,
  isSameWork,
  type EquivalenceVerdict,
  type WorkIdentity,
} from "./alternativeCopy.ts";
import { isRecoverableFailure, type FetchFailureClass } from "../shared/fetchDiagnostics.ts";
import { splitDecoratedScholarlyTitle } from "../shared/decoratedTitle.ts";
import { titleSimilarity } from "./alternativeCopy.ts";
import {
  ENRICHMENT_LIMITS,
  emptyEnrichmentStats,
  enrichAndCompare,
  type EnrichmentDeps,
  type EnrichmentStats,
  type EnrichmentTelemetry,
  noteEnrichment,
  shouldEnrich,
} from "./identityEnrichment.ts";

export const SAME_WORK_RECOVERY_LIMITS = {
  /**
   * Rediscovery queries per failed work, for the whole run. Three covers the
   * distinct identity ladders (DOI / title+author / title+year+pdf / title+pdf)
   * without turning recovery into topic search; later queries run only when
   * earlier ones yielded no acquired copy.
   */
  MAX_QUERIES_PER_WORK: 3,
  /** Candidate results considered per query. */
  MAX_RESULTS: 6,
  /**
   * Equivalence-proven candidate bodies fetched per work. One broken copy must
   * not end recovery, but one broken work must not eat the run either.
   */
  MAX_CANDIDATE_FETCH_ATTEMPTS: 3,
} as const;

/**
 * Identity of the original work established by DETERMINISTIC, non-model
 * sources only (discovery metadata, repository / journal metadata, a DOI
 * parsed out of a discovered URL, already-acquired body identity). Only these
 * fields may participate in the equivalence decision.
 */
export type TrustedWorkIdentity = WorkIdentity;

/**
 * A search-only hint. It may be model-supplied, so it may help NAME the work
 * in the rediscovery query and nothing else. It never reaches `isSameWork()`.
 */
export interface RecoverySearchHint {
  title?: string;
  authors?: string[];
  year?: string;
  doi?: string;
}

export interface SameWorkRecoveryStats extends EnrichmentStats {
  same_work_recovery_triggered: number;
  same_work_recovery_query_count: number;
  same_work_candidates_seen: number;
  same_work_candidates_rejected_identity: number;
  same_work_candidates_rejected_host: number;
  same_work_recovery_success: number;
  same_work_recovery_failed: number;
  /** Failed acquisitions with too little identity to even build a query. */
  same_work_recovery_skipped_no_identity: number;
  same_work_recovery_basis: string[];
  /** Terminal reason per failed recovery round — diagnostic only. */
  same_work_recovery_failed_reasons: string[];
  same_work_recovered_host: string[];
  /** Trust-boundary telemetry (same_work_trust_boundary_v1). */
  same_work_original_identity_trusted_fields: string[];
  same_work_search_hint_fields: string[];
  same_work_agent_hint_used_for_query: number;
  /** Structurally impossible — must stay 0 for every run. */
  same_work_agent_hint_used_for_equivalence: number;
  /** original_identity_enrichment_v1 / multi-candidate telemetry. */
  same_work_original_fields_before: string[];
  same_work_original_fields_after: string[];
  same_work_original_field_provenance: string[];
  same_work_equivalent_candidates: number;
  same_work_candidate_fetch_attempts: number;
  same_work_candidate_fetch_failures: string[];
  landing_document_candidates: number;
  landing_document_attempted: number;
  /** decorated_title_normalization_v1 / original_work_enrichment_v1. */
  same_work_original_title_raw: string[];
  same_work_original_title_normalized: string[];
  same_work_original_author_from_title: number;
  same_work_original_enrichment_attempted: number;
  same_work_original_enrichment_success: number;
  same_work_original_fields_after_enrichment: string[];
}

export function emptySameWorkRecoveryStats(): SameWorkRecoveryStats {
  return {
    ...emptyEnrichmentStats(),
    same_work_recovery_triggered: 0,
    same_work_recovery_query_count: 0,
    same_work_candidates_seen: 0,
    same_work_candidates_rejected_identity: 0,
    same_work_candidates_rejected_host: 0,
    same_work_recovery_success: 0,
    same_work_recovery_failed: 0,
    same_work_recovery_skipped_no_identity: 0,
    same_work_recovery_basis: [],
    same_work_recovery_failed_reasons: [],
    same_work_recovered_host: [],
    same_work_original_identity_trusted_fields: [],
    same_work_search_hint_fields: [],
    same_work_agent_hint_used_for_query: 0,
    same_work_agent_hint_used_for_equivalence: 0,
    same_work_original_fields_before: [],
    same_work_original_fields_after: [],
    same_work_original_field_provenance: [],
    same_work_equivalent_candidates: 0,
    same_work_candidate_fetch_attempts: 0,
    same_work_candidate_fetch_failures: [],
    landing_document_candidates: 0,
    landing_document_attempted: 0,
    same_work_original_title_raw: [],
    same_work_original_title_normalized: [],
    same_work_original_author_from_title: 0,
    same_work_original_enrichment_attempted: 0,
    same_work_original_enrichment_success: 0,
    same_work_original_fields_after_enrichment: [],
  };
}

/** Which identity fields are actually present, for telemetry. */
function presentFields(id: WorkIdentity | RecoverySearchHint | undefined): string[] {
  const out: string[] = [];
  if (!id) return out;
  if (id.title) out.push("title");
  if (id.authors?.length) out.push("authors");
  if (id.year) out.push("year");
  if (id.doi) out.push("doi");
  return out;
}

/**
 * Identity used ONLY to formulate the rediscovery query: trusted fields first,
 * untrusted hint fields allowed to fill the gaps. Never used as proof.
 */
export function queryIdentity(
  trusted: TrustedWorkIdentity,
  hint: RecoverySearchHint | undefined,
): WorkIdentity {
  return {
    title: trusted.title ?? hint?.title,
    authors: trusted.authors?.length ? trusted.authors : hint?.authors,
    year: trusted.year ?? hint?.year,
    journal: trusted.journal,
    doi: trusted.doi ?? hint?.doi,
  };
}

const DOI_RE = /\b10\.\d{4,9}\/[^\s"'<>)\]]+/i;
const YEAR_RE = /\b(19|20)\d{2}\b/;

/** Stable dedupe key for one work: DOI when present, else normalized title. */
export function workKey(identity: WorkIdentity): string | null {
  const doi = identity.doi?.trim().toLowerCase();
  if (doi) return `doi:${doi}`;
  const t = String(identity.title ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return t.length >= 8 ? `title:${t.slice(0, 120)}` : null;
}

/** Normalize a URL for dead-path dedupe (scheme, www, trailing slash, hash). */
export function normalizeUrlKey(url: string | undefined): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    return `${host}${path}${u.search}`.toLowerCase();
  } catch {
    return String(url).trim().toLowerCase();
  }
}

/**
 * Bibliographic identity from discovery metadata only. Nothing is guessed: a
 * field that is not actually present stays undefined, and a candidate without
 * enough identity is rejected rather than assumed equivalent.
 */
export function identityFromSearchResult(
  r: { title?: string; snippet?: string; url?: string; published_date?: string },
): WorkIdentity {
  const text = `${r.title ?? ""} ${r.snippet ?? ""}`;
  const doi = DOI_RE.exec(r.url ?? "")?.[0] ?? DOI_RE.exec(text)?.[0];
  const year = YEAR_RE.exec(String(r.published_date ?? ""))?.[0] ?? YEAR_RE.exec(text)?.[0];
  // Discovery providers decorate work titles with the byline / volume
  // ("Title | Author (כרך ב)"). Separating that decoration deterministically
  // gives `isSameWork()` a real title and a real author instead of one glued
  // string — it does not relax any equivalence rule.
  const split = splitDecoratedScholarlyTitle(r.title);
  const title = usableWorkTitle(split?.title ?? r.title);
  return {
    title,
    authors: title && split?.authors?.length ? split.authors.slice(0, 2) : undefined,
    year: year ?? undefined,
    doi: doi ? doi.replace(/[.,;]$/, "") : undefined,
  };
}

/** Bases strong enough to IDENTIFY a work (never evidence). */
const IDENTITY_BASES: ReadonlySet<MetadataBasis> = new Set(["repository_page", "html_meta", "search_metadata"]);

export interface TrustedIdentityBuild {
  identity: TrustedWorkIdentity;
  fields_before: string[];
  fields_after: string[];
  /** field → provenance that supplied it. */
  provenance: Record<string, string>;
  /** Raw discovery title, before decoration was separated. */
  raw_title?: string;
  /** Core title actually used for identity. */
  normalized_title?: string;
  /** An author was separated off a decorated discovery title. */
  author_from_title: boolean;
}

/**
 * Trusted identity of the FAILED ORIGINAL work (original_identity_enrichment_v1).
 *
 * Merges, conservatively and deterministically: discovery metadata, a DOI in
 * the failed URL, and sanitized bibliographic metadata already extracted from
 * the failed/unusable landing page — only fields whose per-field basis is
 * repository / HTML / search metadata. Embedded PDF metadata and body text keep
 * their existing (weak) trust level and never join. Model assertions never
 * reach this function. Identity ≠ evidence: the landing page stays non-evidence.
 */
export function buildTrustedWorkIdentity(input: {
  discovery: { title?: string; snippet?: string; url?: string; published_date?: string };
  stored_bibliographic?: BibliographicMetadata;
}): TrustedIdentityBuild {
  const base = identityFromSearchResult(input.discovery);
  const split = splitDecoratedScholarlyTitle(input.discovery.title);
  const authorFromTitle = !!(base.authors?.length && split?.authors?.length);
  const before = presentFields(base);
  const provenance: Record<string, string> = {};
  for (const f of before) provenance[f] = "discovery";
  if (authorFromTitle) provenance.authors = "discovery_title";
  const id: TrustedWorkIdentity = { ...base };
  const meta = input.stored_bibliographic;
  const strong = (f: "title" | "authors" | "year" | "journal") => {
    const b = meta?.field_basis?.[f] ?? meta?.metadata_basis?.[0];
    return !!b && IDENTITY_BASES.has(b);
  };
  if (meta) {
    if (!id.title && strong("title")) {
      const t = usableWorkTitle(meta.title);
      if (t) { id.title = t; provenance.title = meta.field_basis?.title ?? "landing_meta"; }
    }
    if (!id.authors?.length && meta.authors?.length && strong("authors")) {
      id.authors = meta.authors.slice(0, 6);
      provenance.authors = meta.field_basis?.authors ?? "landing_meta";
    }
    if (!id.year && meta.year && /^(19|20)\d{2}$/.test(meta.year) && strong("year")) {
      id.year = meta.year;
      provenance.year = meta.field_basis?.year ?? "landing_meta";
    }
    if (!id.journal && meta.journal && strong("journal")) {
      id.journal = meta.journal;
      provenance.journal = meta.field_basis?.journal ?? "landing_meta";
    }
  }
  return {
    identity: id,
    fields_before: before,
    fields_after: presentFields(id),
    provenance,
    raw_title: split?.raw,
    normalized_title: id.title,
    author_from_title: authorFromTitle,
  };
}

/**
 * Ordered, deduped query ladder for the SAME work — every query names the
 * work, never the topic. Only identity fields actually present are used.
 */
export function buildSameWorkQueries(identity: WorkIdentity): string[] {
  const out: string[] = [];
  const title = (identity.title ?? "").trim().slice(0, 120);
  const author = identity.authors?.[0]?.trim();
  if (identity.doi) out.push(`"${identity.doi}"`);
  if (title.length >= 8) {
    // Richest identity first (same shape as the original single query).
    if (author) out.push([`"${title}"`, author, identity.year ?? "", "pdf"].filter(Boolean).join(" "));
    if (identity.year) out.push(`"${title}" ${identity.year} pdf`);
    out.push(`"${title}" pdf`);
  }
  const seen = new Set<string>();
  return out
    .filter((q) => { const k = q.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, SAME_WORK_RECOVERY_LIMITS.MAX_QUERIES_PER_WORK);
}

/** Placeholder titles that carry no bibliographic identity at all. */
const PLACEHOLDER_TITLE_RE = /^(מקור ללא כותרת|untitled|document|pdf|download)$/i;
/** Titles that are really a file name or a URL fragment, not a work title. */
const FILENAME_TITLE_RE = /(\.(cgi|pdf|htm|html|aspx|php|doc|docx)\b|[?&=]|^[\w.\-]+$)/i;

/**
 * A title is usable only if it can actually name a work. A file name, a CGI
 * path or a placeholder would otherwise turn rediscovery into a topic search.
 */
export function usableWorkTitle(raw: string | undefined): string | undefined {
  const t = String(raw ?? "").trim();
  if (!t || PLACEHOLDER_TITLE_RE.test(t)) return undefined;
  if (FILENAME_TITLE_RE.test(t)) return undefined;
  const words = t.split(/\s+/).filter((w) => w.length > 1);
  return words.length >= 3 ? t : undefined;
}

export type SameWorkFailureReason =
  | "failure_not_recoverable"
  | "insufficient_identity_for_query"
  | "search_error"
  | "no_results"
  | "identity_still_insufficient_after_enrichment"
  | "no_equivalent_public_copy"
  | "equivalent_copies_failed_acquisition";

export interface SameWorkRecoveryTelemetry {
  triggered: boolean;
  query?: string;
  /** Every rediscovery query actually issued (≤ MAX_QUERIES_PER_WORK). */
  queries: string[];
  candidates_seen: number;
  /** Candidates that passed deterministic same-work equivalence. */
  equivalent_candidates: number;
  candidate_fetch_attempts: number;
  /** failure_class (or "unusable_body") per failed equivalent-copy fetch. */
  candidate_fetch_failures: string[];
  rejected_identity: number;
  rejected_host: number;
  rejected_already_attempted: number;
  success: boolean;
  basis?: EquivalenceVerdict["basis"];
  recovered_host?: string;
  failure_reason?: SameWorkFailureReason;
  /** Per-candidate identity enrichment rounds — diagnostic only. */
  enrichment: EnrichmentTelemetry[];
  /** Deterministic fields available to PROVE identity. */
  trusted_fields: string[];
  /** Untrusted, search-only hint fields that were supplied. */
  hint_fields: string[];
  /** A hint field actually widened the rediscovery query. */
  hint_used_for_query: boolean;
  /** Always false: hints are structurally excluded from equivalence. */
  hint_used_for_equivalence: false;
  /** original_work_enrichment_v1 — ONE title lookup for the ORIGINAL work. */
  original_enrichment_attempted: boolean;
  original_enrichment_success: boolean;
  /** Trusted fields present after the original-work lookup. */
  original_fields_after_enrichment: string[];
  /** field:basis for every field the original-work lookup added. */
  original_enrichment_provenance: string[];
}

export interface SameWorkRecoveryResult {
  recovered: boolean;
  /** Present only when `recovered` is true. */
  candidate?: SearchResult;
  /** Deterministic equivalence basis for an accepted candidate. */
  equivalence_basis?: EquivalenceVerdict["basis"];
  /** Which identity sources made equivalence provable, when enrichment ran. */
  enrichment_basis?: string[];
  /** Present only when `recovered` is false. */
  reason?: SameWorkFailureReason;
  telemetry: SameWorkRecoveryTelemetry;
}

export interface SameWorkRecoveryInput {
  /**
   * TRUSTED identity of the failed work — deterministic sources only. This is
   * the ONLY identity compared against a candidate.
   */
  failed_source_identity: TrustedWorkIdentity;
  /**
   * UNTRUSTED search hint (possibly model-supplied). Query formulation only.
   */
  search_hint?: RecoverySearchHint;
  failure_class?: FetchFailureClass;
  already_attempted_urls: string[];
  /** Discovery backend. Ordinary search results, no bodies, never citable. */
  search: (query: string, limit: number) => Promise<SearchResult[]>;
  /**
   * Bounded IDENTITY enrichment for a plausible candidate whose discovery
   * record lacks author / year / DOI. Identity only — never evidence.
   */
  enrichment?: EnrichmentDeps;
  /**
   * Acquire an equivalence-proven candidate through the ORDINARY fetch path.
   * When supplied, recovery tries up to MAX_CANDIDATE_FETCH_ATTEMPTS proven
   * copies and succeeds only when one returns a readable document. When
   * omitted, the first proven candidate is returned (caller fetches).
   */
  acquire?: (candidate: SearchResult) => Promise<{ ok: boolean; failure_class?: string }>;
}

/** One bounded same-work recovery round. The caller enforces once-per-work. */
export async function recoverSameWork(
  input: SameWorkRecoveryInput,
): Promise<SameWorkRecoveryResult> {
  const trustedFields = presentFields(input.failed_source_identity);
  const hintFields = presentFields(input.search_hint);
  const forQuery = queryIdentity(input.failed_source_identity, input.search_hint);
  const hintUsedForQuery = presentFields(forQuery).some((f) => !trustedFields.includes(f));

  const tel: SameWorkRecoveryTelemetry = {
    triggered: false,
    queries: [],
    candidates_seen: 0,
    equivalent_candidates: 0,
    candidate_fetch_attempts: 0,
    candidate_fetch_failures: [],
    rejected_identity: 0,
    rejected_host: 0,
    rejected_already_attempted: 0,
    success: false,
    enrichment: [],
    trusted_fields: trustedFields,
    hint_fields: hintFields,
    hint_used_for_query: hintUsedForQuery,
    hint_used_for_equivalence: false,
  };

  if (input.failure_class && !isRecoverableFailure(input.failure_class)) {
    return { recovered: false, reason: "failure_not_recoverable", telemetry: { ...tel, failure_reason: "failure_not_recoverable" } };
  }

  // The query may name the work with untrusted hints; proof may not.
  const queries = buildSameWorkQueries(forQuery);
  if (!queries.length || !buildAlternativeCopyQuery(forQuery)) {
    return {
      recovered: false,
      reason: "insufficient_identity_for_query",
      telemetry: { ...tel, failure_reason: "insufficient_identity_for_query" },
    };
  }

  tel.triggered = true;
  tel.query = queries[0];

  const dead = new Set(input.already_attempted_urls.map(normalizeUrlKey).filter(Boolean));
  const inspected = new Set<string>();
  let enriched = 0;
  let enrichmentAttemptedAndInsufficient = false;
  let anyResults = false;
  let searchErrors = 0;

  for (const query of queries) {
    if (tel.candidate_fetch_attempts >= SAME_WORK_RECOVERY_LIMITS.MAX_CANDIDATE_FETCH_ATTEMPTS) break;
    tel.queries.push(query);
    let results: SearchResult[] = [];
    try {
      results = await input.search(query, SAME_WORK_RECOVERY_LIMITS.MAX_RESULTS);
    } catch {
      searchErrors += 1;
      continue;
    }
    results = results.slice(0, SAME_WORK_RECOVERY_LIMITS.MAX_RESULTS);
    if (results.length) anyResults = true;

    for (const r of results) {
      if (!r.url) continue;
      const key = normalizeUrlKey(r.url);
      if (inspected.has(key)) continue;
      inspected.add(key);
      tel.candidates_seen += 1;
      if (dead.has(key)) {
        tel.rejected_already_attempted += 1;
        continue;
      }
      if (!isAcceptableAlternativeHost(r.url)) {
        tel.rejected_host += 1;
        continue;
      }
      const discoveryIdentity = identityFromSearchResult(r);
      let verdict = isSameWork(input.failed_source_identity, discoveryIdentity);
      let enrichmentBasis: string[] | undefined;

      if (
        !verdict.same_work &&
        input.enrichment &&
        enriched < ENRICHMENT_LIMITS.MAX_CANDIDATES_PER_WORK &&
        shouldEnrich(input.failed_source_identity, discoveryIdentity, verdict)
      ) {
        enriched += 1;
        const outcome = await enrichAndCompare({
          wanted: input.failed_source_identity,
          candidate: discoveryIdentity,
          candidate_url: r.url,
          search_hint: {
            author: input.search_hint?.authors?.[0],
            year: input.search_hint?.year,
          },
          deps: input.enrichment,
        });
        tel.enrichment.push(outcome.telemetry);
        enrichmentBasis = outcome.telemetry.basis;
        if (outcome.hard_reject) {
          tel.rejected_identity += 1;
          continue;
        }
        verdict = outcome.verdict;
        if (!verdict.same_work) enrichmentAttemptedAndInsufficient = true;
      }

      if (!verdict.same_work) {
        tel.rejected_identity += 1;
        continue;
      }
      tel.equivalent_candidates += 1;
      const accept = (): SameWorkRecoveryResult => {
        tel.success = true;
        tel.basis = verdict.basis;
        try {
          tel.recovered_host = new URL(r.url!).hostname.toLowerCase();
        } catch { /* host telemetry only */ }
        return {
          recovered: true,
          candidate: r,
          equivalence_basis: verdict.basis,
          enrichment_basis: enrichmentBasis,
          telemetry: tel,
        };
      };
      if (!input.acquire) return accept();

      // Equivalence-proven copy: acquire through the ordinary fetch path.
      tel.candidate_fetch_attempts += 1;
      dead.add(key);
      let got: { ok: boolean; failure_class?: string };
      try {
        got = await input.acquire(r);
      } catch {
        got = { ok: false, failure_class: "fetch_exception" };
      }
      if (got.ok) return accept();
      tel.candidate_fetch_failures.push(got.failure_class ?? "unusable_body");
      if (tel.candidate_fetch_attempts >= SAME_WORK_RECOVERY_LIMITS.MAX_CANDIDATE_FETCH_ATTEMPTS) break;
    }
  }

  const reason: SameWorkFailureReason = tel.candidate_fetch_attempts > 0
    ? "equivalent_copies_failed_acquisition"
    : !anyResults
    ? (searchErrors === tel.queries.length ? "search_error" : "no_results")
    : enrichmentAttemptedAndInsufficient
    ? "identity_still_insufficient_after_enrichment"
    : "no_equivalent_public_copy";
  return { recovered: false, reason, telemetry: { ...tel, failure_reason: reason } };
}

/** Fold one recovery round into the run counters. Telemetry only. */
export function noteSameWorkRecovery(
  stats: SameWorkRecoveryStats,
  tel: SameWorkRecoveryTelemetry,
): void {
  if (!tel.triggered) return;
  for (const e of tel.enrichment ?? []) noteEnrichment(stats, e);
  stats.same_work_recovery_triggered += 1;
  stats.same_work_recovery_query_count += Math.max(1, tel.queries?.length ?? 0);
  stats.same_work_equivalent_candidates += tel.equivalent_candidates ?? 0;
  stats.same_work_candidate_fetch_attempts += tel.candidate_fetch_attempts ?? 0;
  for (const f of tel.candidate_fetch_failures ?? []) {
    if (stats.same_work_candidate_fetch_failures.length < 30) stats.same_work_candidate_fetch_failures.push(f);
  }
  stats.same_work_candidates_seen += tel.candidates_seen;
  stats.same_work_candidates_rejected_identity += tel.rejected_identity;
  stats.same_work_candidates_rejected_host += tel.rejected_host;
  for (const f of tel.trusted_fields ?? []) {
    if (!stats.same_work_original_identity_trusted_fields.includes(f)) {
      stats.same_work_original_identity_trusted_fields.push(f);
    }
  }
  for (const f of tel.hint_fields ?? []) {
    if (!stats.same_work_search_hint_fields.includes(f)) {
      stats.same_work_search_hint_fields.push(f);
    }
  }
  if (tel.hint_used_for_query) stats.same_work_agent_hint_used_for_query += 1;
  // Structurally impossible; recorded so the invariant is observable live.
  if (tel.hint_used_for_equivalence) stats.same_work_agent_hint_used_for_equivalence += 1;
  if (tel.success) {
    stats.same_work_recovery_success += 1;
    if (tel.basis) {
      stats.same_work_recovery_basis.push(tel.basis);
      if (!stats.same_work_equivalence_basis.includes(tel.basis)) {
        stats.same_work_equivalence_basis.push(tel.basis);
      }
    }
    if (tel.recovered_host && !stats.same_work_recovered_host.includes(tel.recovered_host)) {
      stats.same_work_recovered_host.push(tel.recovered_host);
    }
  } else {
    stats.same_work_recovery_failed += 1;
    if (tel.failure_reason && stats.same_work_recovery_failed_reasons.length < 20) {
      stats.same_work_recovery_failed_reasons.push(tel.failure_reason);
    }
  }
}
