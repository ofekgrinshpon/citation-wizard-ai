/**
 * legal-research-v2 — exact-authority recovery discovery
 * (v2_exact_authority_recovery_v1).
 *
 * One job: when an already-open authority target has run out of concrete
 * candidates, run ONE narrow discovery round for that authority's exact
 * identity (proceeding type + docket, or statute name + section) and attach
 * whatever concrete documents it finds to the SAME target.
 *
 * What this module is NOT:
 *   • not evidence — a search result carries no body and can never bind;
 *   • not a trust layer — no domain is sufficient proof of anything. The
 *     `origin_label` below is telemetry only and is never read by ranking,
 *     admission, corroboration or verification;
 *   • not a new budget — it spends the single, already-existing
 *     MAX_DISCOVERY_REFRESHES_PER_AUTHORITY refresh, and the bodies it
 *     surfaces are fetched through the ordinary bounded attempt ceiling.
 */

import type { SearchResult } from "../types.ts";
import type { AcquisitionLedger, ExpectedTargetIdentity } from "./acquisitionLedger.ts";
// NOTE: no import from acquisitionOrchestrator.ts — the orchestrator imports
// this module, and the attach/classify helpers are injected instead of
// imported back, keeping the module graph acyclic.

export type RecoveryScope = "web" | "official";

export interface RecoveryQuery {
  query: string;
  scope: RecoveryScope;
  basis: "case_full_identity" | "case_identity_with_hint" | "case_bare_docket" | "statute_name" | "statute_name_section";
}

/** Telemetry only. Never influences ordering, admission or verification. */
export type RecoveryOriginLabel = "local_corpus" | "official_source" | "mirror_reproduction" | "other";

export interface RecoveryTelemetry {
  authority_key: string;
  recovery_triggered: boolean;
  recovery_query?: string;
  recovery_query_basis?: string;
  recovery_results: number;
  concrete_candidates_attached: number;
  recovery_acquisition_attempts: number;
  recovery_success: boolean;
  recovery_source_origin?: RecoveryOriginLabel;
  recovery_failure_reason?: string;
}

export type RecoverySearchFn = (
  input: { query: string; scope: RecoveryScope; limit: number; authority_key: string },
) => Promise<SearchResult[]>;

const DOCKET_RE = /\d{1,6}\s*\/\s*\d{2,4}/;

function cleanHint(hint?: string): string {
  const h = String(hint ?? "").trim();
  if (!h || DOCKET_RE.test(h)) return "";
  // A label is a party/title hint only; keep it short and literal.
  return h.replace(/\s+/g, " ").slice(0, 60);
}

/**
 * Deterministic query for the EXACT authority. One query per authority — no
 * doctrinal broadening, no synonym expansion, no host targeting.
 */
export function buildRecoveryQuery(
  authority_key: string,
  identity?: ExpectedTargetIdentity,
  label?: string,
): RecoveryQuery | null {
  const key = String(authority_key ?? "").trim();
  if (!key) return null;

  if (key.startsWith("case:")) {
    const bare = identity?.docket?.match(DOCKET_RE)?.[0]?.replace(/\s+/g, "") ??
      key.slice(5).match(DOCKET_RE)?.[0]?.replace(/\s+/g, "");
    if (!bare) return null;
    const full = (identity?.docket ?? "").trim();
    const hasPrefix = !!full && full.replace(DOCKET_RE, "").trim().length > 0;
    const hint = cleanHint(label);
    if (hasPrefix && hint) {
      return { query: `${full} ${hint} פסק דין`, scope: "web", basis: "case_identity_with_hint" };
    }
    if (hasPrefix) return { query: `${full} פסק דין`, scope: "web", basis: "case_full_identity" };
    return { query: `${bare} פסק דין`, scope: "web", basis: "case_bare_docket" };
  }

  if (key.startsWith("statute:")) {
    const rest = key.slice(8);
    const statute = (identity?.statute ?? rest.split("#")[0] ?? "").trim();
    if (statute.length < 3) return null;
    const section = (identity?.section ?? (rest.includes("#") ? rest.slice(rest.indexOf("#") + 1) : "")).trim();
    if (section) {
      return { query: `${statute} סעיף ${section} נוסח החוק`, scope: "official", basis: "statute_name_section" };
    }
    return { query: `${statute} נוסח החוק`, scope: "official", basis: "statute_name" };
  }
  return null;
}

/** Telemetry label for where a recovered body came from. Never a trust signal. */
export function recoveryOriginLabel(c: { url?: string; local_document_id?: string }): RecoveryOriginLabel {
  if (c.local_document_id) return "local_corpus";
  if (!c.url) return "other";
  let host = "";
  try {
    host = new URL(c.url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "other";
  }
  if (/(^|\.)gov\.il$/.test(host) || /(^|\.)knesset\.gov\.il$/.test(host)) return "official_source";
  return "mirror_reproduction";
}

export interface RecoveryDeps {
  ledger: AcquisitionLedger;
  discovered: Map<string, SearchResult>;
  search: RecoverySearchFn;
  /** Existing candidate attachment (orchestrator's `attachDiscoveryResults`). */
  attach: (results: SearchResult[], forAuthority: string) => { attached: number };
  /** Existing URL-shape / local-row classifier. */
  isConcrete: (r: SearchResult) => boolean;
  limit?: number;
}

/**
 * One bounded recovery round for one authority. Caller has already decided the
 * trigger conditions hold and has consumed the discovery refresh.
 */
export async function runExactAuthorityRecovery(
  authority_key: string,
  deps: RecoveryDeps,
): Promise<RecoveryTelemetry> {
  const key = String(authority_key ?? "").trim();
  const base: RecoveryTelemetry = {
    authority_key: key,
    recovery_triggered: false,
    recovery_results: 0,
    concrete_candidates_attached: 0,
    recovery_acquisition_attempts: 0,
    recovery_success: false,
  };
  const target = deps.ledger.target(key);
  if (!target) return { ...base, recovery_failure_reason: "target_not_found" };

  const q = buildRecoveryQuery(key, deps.ledger.expectedIdentity(key), target.label);
  if (!q) return { ...base, recovery_failure_reason: "identity_not_concrete_enough" };

  let results: SearchResult[] = [];
  try {
    results = await deps.search({
      query: q.query,
      scope: q.scope,
      limit: Math.max(1, Math.min(10, deps.limit ?? 8)),
      authority_key: key,
    });
  } catch (e) {
    return {
      ...base,
      recovery_triggered: true,
      recovery_query: q.query,
      recovery_query_basis: q.basis,
      recovery_failure_reason: `search_error: ${e instanceof Error ? e.message : String(e)}`.slice(0, 120),
    };
  }

  for (const r of results) deps.discovered.set(r.result_id, r);
  const concrete = results.filter((r) => deps.isConcrete(r));
  const att = deps.attach(results, key);

  return {
    ...base,
    recovery_triggered: true,
    recovery_query: q.query,
    recovery_query_basis: q.basis,
    recovery_results: results.length,
    concrete_candidates_attached: att.attached,
    recovery_failure_reason: att.attached === 0
      ? (results.length === 0 ? "no_results" : concrete.length === 0 ? "no_concrete_candidates" : "all_candidates_known")
      : undefined,
  };
}
