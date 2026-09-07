// direct_authority_variety_cap_survival_v1
//
// A narrowly bounded survival guarantee for *strongly identified, directly
// relevant* legal authorities that would otherwise be discarded during pool
// shaping only because of the per-origin variety cap or late rank trimming.
//
// Hard rules:
// - deterministic, existing signals only (no new retrieval, no new LLM call);
// - registry / listing presence alone is NEVER sufficient;
// - identity evidence AND direct-relevance evidence are both required;
// - at most `DIRECT_AUTHORITY_EXEMPTION_BUDGET` authorities per run;
// - one representation per authority (the strongest, in rank order);
// - survival into the next stage only — every later gate (body acquisition,
//   identity, integrity, verifier, CSM, topicality/alignment, drafter) is
//   unchanged and still applies.

import { detectJudgmentEvidence } from "./documentEvidenceClassification.ts";
import { normalizeDocket } from "./urlCollisionGuard.ts";
import { topicalityScore } from "./academicCandidateAdmission.ts";

export const DIRECT_AUTHORITY_EXEMPTION_BUDGET = 3;
/** Minimum share of question topic terms for a "directly relevant" reading. */
export const DIRECT_AUTHORITY_MIN_TOPICALITY = 0.15;

/** Protection reasons that already mean "this is the authority itself". */
const IDENTITY_PROTECTIONS = new Set([
  "exact_docket_identity",
  "exact_authority_candidate",
  "judgment_document",
  "official_primary_page",
  "official_statute_page",
]);

export interface DirectAuthorityCandidateLike {
  candidate_id: string;
  title: string;
  source_url?: string | null;
  snippet?: string | null;
  retrieval_method?: string;
  origin?: string;
  metadata?: Record<string, unknown> | null;
}

export interface DirectAuthoritySignalInput {
  /** discovery-precision protection reason, when the candidate is protected */
  protection_reason?: string | null;
  protected?: boolean;
  listing_like: boolean;
  integrity_reject?: boolean;
  is_judgment_document?: boolean;
}

export interface DirectAuthorityEvidence {
  authority: string | null;
  identity_signals: string[];
  relevance_signals: string[];
  topicality: number;
  eligible: boolean;
  ineligible_reason: string | null;
}

export interface DirectAuthoritySurvivalRow {
  candidate_id: string;
  title: string;
  authority: string | null;
  original_rank: number;
  cap_that_would_drop: string | null;
  protection_signals: string[];
  exemption_applied: boolean;
  exemption_budget_used: number;
  representation_kept: boolean;
  next_stage_reached: string;
  skipped_reason?: string;
}

function normTitle(t: string): string {
  return (t || "").replace(/["׳'`״]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Docket identity derived from title/url/snippet with existing detectors. */
function authorityKey(c: DirectAuthorityCandidateLike): string | null {
  const ev = detectJudgmentEvidence({
    url: String(c.source_url ?? ""),
    title: String(c.title ?? ""),
    snippet: String(c.snippet ?? ""),
  });
  const raw = ev?.docket ?? null;
  const fromTitle = normalizeDocket(`${c.title ?? ""}`);
  const norm = raw ? normalizeDocket(`${c.title ?? ""} ${raw}`) ?? `docket:${raw}` : fromTitle;
  return norm ?? null;
}

/**
 * Deterministic direct-authority evidence for one candidate.
 * `topicTerms` come from the current question (existing extractor).
 */
export function directAuthorityEvidence(
  c: DirectAuthorityCandidateLike,
  s: DirectAuthoritySignalInput,
  topicTerms: string[],
): DirectAuthorityEvidence {
  const meta = (c.metadata ?? {}) as Record<string, unknown>;
  const identity: string[] = [];
  const relevance: string[] = [];

  const jEv = detectJudgmentEvidence({
    url: String(c.source_url ?? ""),
    title: String(c.title ?? ""),
    snippet: String(c.snippet ?? ""),
  });

  if (s.protected && s.protection_reason && IDENTITY_PROTECTIONS.has(s.protection_reason)) {
    identity.push(`protected:${s.protection_reason}`);
  }
  if (c.retrieval_method === "exact_authority") identity.push("exact_authority_retrieval");
  if (s.is_judgment_document === true) identity.push("integrity_judgment_document");
  if (meta.identity_confirmed === true) identity.push("identity_confirmed");
  if (jEv) identity.push(`document_judgment_identity:${jEv.docket}`);

  if (meta.required_anchor_id) relevance.push("nominated_required_authority");
  if (meta.docket_match === true) relevance.push("question_docket_match");
  if (meta.registry_doctrine_match === true || meta.canonical_registry_doctrine) {
    relevance.push("registry_doctrine_or_facet_match");
  }
  const topicality = topicalityScore(
    `${c.title ?? ""} ${c.snippet ?? ""}`,
    topicTerms,
  );
  if (topicality >= DIRECT_AUTHORITY_MIN_TOPICALITY) {
    relevance.push(`issue_topicality:${topicality}`);
  }

  const authority = authorityKey(c);
  let ineligible: string | null = null;
  if (s.listing_like) ineligible = "listing_like";
  else if (s.integrity_reject) ineligible = "integrity_reject";
  else if (!String(c.source_url ?? "").trim()) ineligible = "no_url";
  else if (!authority) ineligible = "unresolved_identity";
  else if (identity.length === 0) ineligible = "no_identity_evidence";
  else if (relevance.length === 0) ineligible = "not_directly_relevant";

  return {
    authority,
    identity_signals: identity,
    relevance_signals: relevance,
    topicality,
    eligible: ineligible === null,
    ineligible_reason: ineligible,
  };
}

export interface DirectAuthoritySelection {
  /** candidate_id → telemetry row (mutable: filled in by the pool). */
  protectedById: Map<string, DirectAuthoritySurvivalRow>;
  rows: DirectAuthoritySurvivalRow[];
  budget: number;
  used: number;
}

/**
 * Select the protected direct authorities, in the already duplicate-resolved
 * rank order. Ranking between different authorities is untouched: this only
 * marks which candidates may not be dropped by the variety / rank caps.
 */
export function selectDirectAuthorities(
  ranked: DirectAuthorityCandidateLike[],
  signalsOf: (c: DirectAuthorityCandidateLike) => DirectAuthoritySignalInput,
  topicTerms: string[],
  budget: number = DIRECT_AUTHORITY_EXEMPTION_BUDGET,
): DirectAuthoritySelection {
  const protectedById = new Map<string, DirectAuthoritySurvivalRow>();
  const rows: DirectAuthoritySurvivalRow[] = [];
  const seenAuthority = new Set<string>();
  let used = 0;

  // The bounded budget is allocated by *strength of direct-authority evidence*,
  // not by pool rank, so a weaker judgment that merely appears earlier cannot
  // consume the exemption. Pool ranking itself is untouched.
  const evaluated = ranked
    .map((c, rank) => ({ c, rank, ev: directAuthorityEvidence(c, signalsOf(c), topicTerms) }))
    .filter((e) => e.ev.eligible);
  const strength = (e: typeof evaluated[number]): number => {
    let w = e.ev.topicality * 4;
    for (const sig of [...e.ev.identity_signals, ...e.ev.relevance_signals]) {
      if (sig.startsWith("protected:") || sig === "exact_authority_retrieval") w += 3;
      else if (sig === "nominated_required_authority") w += 3;
      else if (sig === "question_docket_match") w += 2;
      else if (sig === "registry_doctrine_or_facet_match") w += 2;
      else if (sig.startsWith("document_judgment_identity")) w += 1.5;
      else if (sig === "identity_confirmed" || sig === "integrity_judgment_document") w += 1;
    }
    return w;
  };
  evaluated.sort((a, b) => strength(b) - strength(a) || a.rank - b.rank);

  evaluated.forEach(({ c, rank, ev }) => {
    const key = ev.authority ?? `title:${normTitle(c.title)}`;
    const signals = [...ev.identity_signals, ...ev.relevance_signals];
    if (seenAuthority.has(key)) {
      rows.push({
        candidate_id: c.candidate_id,
        title: c.title,
        authority: key,
        original_rank: rank,
        cap_that_would_drop: null,
        protection_signals: signals,
        exemption_applied: false,
        exemption_budget_used: used,
        representation_kept: false,
        next_stage_reached: "not_protected",
        skipped_reason: "duplicate_representation",
      });
      return;
    }
    if (used >= budget) {
      rows.push({
        candidate_id: c.candidate_id,
        title: c.title,
        authority: key,
        original_rank: rank,
        cap_that_would_drop: null,
        protection_signals: signals,
        exemption_applied: false,
        exemption_budget_used: used,
        representation_kept: false,
        next_stage_reached: "not_protected",
        skipped_reason: "exemption_budget_exhausted",
      });
      return;
    }
    seenAuthority.add(key);
    used++;
    const row: DirectAuthoritySurvivalRow = {
      candidate_id: c.candidate_id,
      title: c.title,
      authority: key,
      original_rank: rank,
      cap_that_would_drop: null,
      protection_signals: signals,
      exemption_applied: false,
      exemption_budget_used: used,
      representation_kept: true,
      next_stage_reached: "pool_evaluation",
    };
    protectedById.set(c.candidate_id, row);
    rows.push(row);
  });
  rows.sort((a, b) => a.original_rank - b.original_rank);

  return { protectedById, rows, budget, used };
}
