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
 *   • not a retry loop — one query per work, bounded results, bounded fetch
 *     attempts, dead URLs never retried;
 *   • not a paywall / login / CAPTCHA workaround — it looks for another
 *     publicly accessible copy of the same public document, nothing else.
 */

import type { SearchResult } from "../types.ts";
import {
  buildAlternativeCopyQuery,
  isAcceptableAlternativeHost,
  isSameWork,
  type EquivalenceVerdict,
  type WorkIdentity,
} from "./alternativeCopy.ts";
import { isRecoverableFailure, type FetchFailureClass } from "../shared/fetchDiagnostics.ts";
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
  /** Rediscovery queries per failed work, for the whole run. */
  MAX_QUERIES_PER_WORK: 1,
  /** Candidate results considered from that one query. */
  MAX_RESULTS: 6,
  /** Candidate bodies actually fetched after acceptance. */
  MAX_CANDIDATE_FETCH_ATTEMPTS: 1,
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
  return {
    title: usableWorkTitle(r.title),
    year: year ?? undefined,
    doi: doi ? doi.replace(/[.,;]$/, "") : undefined,
  };
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
  | "no_equivalent_public_copy";

export interface SameWorkRecoveryTelemetry {
  triggered: boolean;
  query?: string;
  candidates_seen: number;
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
    candidates_seen: 0,
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
  const query = buildAlternativeCopyQuery(forQuery);
  if (!query) {
    return {
      recovered: false,
      reason: "insufficient_identity_for_query",
      telemetry: { ...tel, failure_reason: "insufficient_identity_for_query" },
    };
  }

  tel.triggered = true;
  tel.query = query;

  let results: SearchResult[] = [];
  try {
    results = await input.search(query, SAME_WORK_RECOVERY_LIMITS.MAX_RESULTS);
  } catch {
    return { recovered: false, reason: "search_error", telemetry: { ...tel, failure_reason: "search_error" } };
  }
  results = results.slice(0, SAME_WORK_RECOVERY_LIMITS.MAX_RESULTS);
  if (!results.length) {
    return { recovered: false, reason: "no_results", telemetry: { ...tel, failure_reason: "no_results" } };
  }

  const dead = new Set(input.already_attempted_urls.map(normalizeUrlKey).filter(Boolean));
  let enriched = 0;
  let enrichmentAttemptedAndInsufficient = false;

  for (const r of results) {
    if (!r.url) continue;
    tel.candidates_seen += 1;
    if (dead.has(normalizeUrlKey(r.url))) {
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

    // The candidate is plausible but discovery gave us title + URL only:
    // gather identity (not evidence) and run the SAME check again.
    if (
      !verdict.same_work &&
      input.enrichment &&
      enriched < ENRICHMENT_LIMITS.MAX_CANDIDATES_PER_WORK &&
      shouldEnrich(input.failed_source_identity, discoveryIdentity, verdict)
    ) {
      enriched += 1;
      const outcome = await enrichAndCompare({
        // TRUSTED side only — the hint is passed separately and may narrow a
        // metadata query, never prove equivalence.
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
    tel.success = true;
    tel.basis = verdict.basis;
    try {
      tel.recovered_host = new URL(r.url).hostname.toLowerCase();
    } catch { /* host telemetry only */ }
    return {
      recovered: true,
      candidate: r,
      equivalence_basis: verdict.basis,
      enrichment_basis: enrichmentBasis,
      telemetry: tel,
    };
  }

  const reason: SameWorkFailureReason = enrichmentAttemptedAndInsufficient
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
  stats.same_work_recovery_query_count += 1;
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
