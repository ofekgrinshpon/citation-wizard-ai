// P3 — Candidate pool: merge local + Perplexity, dedupe, cap.

import { CAPS, Candidate } from "../lib/types.ts";
import {
  canSatisfyRole,
  classifySourceIntegrity,
  type SourceIntegrity,
} from "./sourceIntegrity.ts";
import { assignSynthesisRole } from "./synthesisRole.ts";
import { buildUrlDedupeKey } from "./docketAwareUrlKey.ts";
import {
  backfillOriginCap,
  classifyDiscoveryPrecision,
  type DiscoveryDiagnostics,
  type DiscoveryPrecision,
  emptyDiscoveryDiagnostics,
} from "./discoveryPrecision.ts";
import { GATE_META_KEY } from "./localCaselawListingGate.ts";


function normTitle(t: string): string {
  return (t || "")
    .toLowerCase()
    .replace(/[\u0590-\u05FF]/g, (ch) => ch) // keep Hebrew
    .replace(/["׳'`״]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}




/** docket_aware_url_dedup_v1 — per-candidate dedupe-key telemetry. */
export interface UrlDedupeLogRow {
  candidate_id: string;
  title: string;
  original_url: string | null;
  normalized_url_old: string;
  dedupe_key: string;
  dedupe_identity_params_used: string[];
  dedupe_identity_source: "query_param" | "title_docket" | "normal_url";
  admitted: boolean;
}


// Extract a statute "title§section" key when discoverable.
const STATUTE_SECTION_RE = /סעיף\s*(\d+[א-ת]?)/;
function statuteKey(c: Candidate): string {
  if (c.role !== "primary_statute" && c.role !== "regulation") return "";
  const m = c.title.match(STATUTE_SECTION_RE) || (c.snippet || "").match(STATUTE_SECTION_RE);
  if (!m) return "";
  const titleBase = normTitle(c.title).replace(/סעיף\s*\d+[א-ת]?/g, "").trim();
  return `${titleBase}§${m[1]}`;
}

// Extract a docket number from title/snippet for case dedup.
const DOCKET_RE = /\b(בג"?ץ|ע"?א|רע"?א|ע"?פ|בש"?א|ב"?ש|תא|תפ|תק|רעא|עפ)\s*\d{1,5}\/\d{2,4}\b/;
function docketKey(c: Candidate): string {
  if (c.role !== "binding_case_law" && c.role !== "persuasive_case_law") return "";
  const hay = `${c.title} ${c.snippet || ""}`;
  const m = hay.match(DOCKET_RE);
  return m ? m[0].replace(/\s+/g, " ").trim() : "";
}

export interface PoolDrop {
  candidate_id: string;
  title: string;
  url: string | null;
  source_type: string;
  origin: string;
  retrieval_method: string;
  role: string;
  claim_id: string;
  rank_before_drop: number;
  drop_reason:
    | "vector_quota_per_claim"
    | "dup_document_id"
    | "dup_url"
    | "dup_statute_section"
    | "dup_docket"
    | "dup_role_title"
    | "max_candidates_cap"
    | "discovery_listing_suppressed"
    | "backfill_origin_diversity_cap"
    | "source_integrity_reject";
  drop_key: string;
  score: number;
}

/** Per-admitted-candidate source-integrity telemetry row. */
export interface IntegrityLogRow {
  candidate_id: string;
  title: string;
  url: string | null;
  role: string;
  original_source_type: string;
  authority_tier: string;
  text_usability: string;
  citable_as: string;
  integrity_flags: string[];
  can_satisfy_role: boolean;
  is_judgment_document: boolean;
  has_holding_text: boolean;
  synthesis_role: string;
  synthesis_role_seeded_from: string;
  synthesis_role_overridden: boolean;
  downgrade_reason?: string;
}

export interface PoolResult {
  candidates: Candidate[];
  found: number;
  after_dedup: number;
  dedup_drops: number;
  drops: PoolDrop[];
  integrity: IntegrityLogRow[];
  integrity_rejects: number;
  url_dedupe: UrlDedupeLogRow[];
  url_dedupe_identity_source_counts: Record<string, number>;
  url_dedupe_rescued_from_legacy_collapse: number;
  /** discovery_precision_and_listing_suppression_v1 */
  discovery_precision: DiscoveryDiagnostics;
  counts: {
    by_origin: Record<string, number>;
    by_role: Record<string, number>;
    by_claim: Record<string, number>;
  };
  /** local_retrieval_precision_tuning_v1 */
  vector_tuning: LocalVectorQuotaTuning | null;
  /** local_retrieval_precision_tuning_v1 — one row per promoted candidate. */
  reranking: LocalRerankRow[];
  /** academic_richness_last_mile_and_doctrine_mapping_v1 */
  pool_collapse?: {
    academic_mode: boolean;
    raw_found: number;
    after_integrity: number;
    after_listing_and_precision: number;
    final_pool: number;
    origin_cap_used: number;
    origin_cap_base: number;
    backfill_origin_cap_drops: number;
    drops_by_reason: Record<string, number>;
  };
}

/** local_retrieval_precision_tuning_v1 */
export interface LocalVectorQuotaTuning {
  mode: string | null;
  enabled: boolean;
  old_quota: number;
  new_quota: number;
  vector_candidates_seen: number;
  vector_candidates_admitted_before: number;
  vector_candidates_admitted_after: number;
  text_candidates_displaced: number;
  final_pool_size_before: number;
  final_pool_size_after: number;
  average_vector_score: number;
  elapsed_ms: number;
}

export interface LocalRerankRow {
  candidate_id: string;
  title: string;
  source_type: string;
  method: string;
  old_rank: number;
  new_rank: number;
  rerank_reason: string;
  displaced_candidate_method: string | null;
  displaced_candidate_reason: string | null;
}



const MAX_VECTOR_PER_CLAIM = 2;
// local_retrieval_precision_tuning_v1 — bounded, local-only, mode-gated.
const LOCAL_VECTOR_QUOTA_TUNED = 4;
/** Minimum cosine similarity for a local vector candidate to compete in the
 *  text tier. Local vector scores are stored as similarity * 0.6. */
const VECTOR_PROMOTE_MIN_SIM = 0.30;
const VECTOR_SCORE_WEIGHT = 0.6;
/** Source types credible enough to be reranked upward. */
const CREDIBLE_LOCAL_TYPES = new Set([
  "journal_article", "israeli_law", "knesset_research", "supreme_court_il",
  "caselaw", "academic",
]);
/** Broad/academic modes where lexical noise outweighs vector recall risk. */
const BROAD_INTENTS = new Set([
  "academic_writing", "doctrinal_explanation", "case_law_synthesis",
  "argument_development", "literature_review", "source_recommendation",
  "research_guidance",
]);
function isBroadIntent(intent: string | null | undefined): boolean {
  return !!intent && BROAD_INTENTS.has(intent);
}
const MIN_TRUSTED_PERPLEXITY = 10;

// Trusted-Perplexity predicate.
//
// Per the approved Phase-1 plan:
// - classified_source_class alone must NOT qualify a candidate for trusted
//   reservation.
// - Trusted reservation requires good hygiene (action=keep), a valid/specific
//   URL shape, and meaningful body/snippet.
// - Bad hygiene either excludes (handled upstream) or caps the score to 0.5
//   (handled upstream); here we simply refuse to reserve such candidates.
function isTrustedPerplexity(c: Candidate): boolean {
  if (c.retrieval_method !== "perplexity") return false;
  const meta = (c.metadata ?? {}) as Record<string, unknown>;
  // Listing / pagination / non-authority pages never earn a reserved slot.
  const integ = meta.source_integrity as SourceIntegrity | undefined;
  if (integ && (integ.citable_as === "not_citable" || integ.authority_tier === "index_or_listing")) {
    return false;
  }

  const hygiene = meta.pplx_hygiene as
    | {
        hygiene_action?: string;
        body_status?: string;
        landing_page_status?: string;
        title_status?: string;
        url_status?: string;
      }
    | undefined;
  // Without explicit hygiene metadata we cannot trust the candidate — refuse.
  if (!hygiene) return false;
  if (hygiene.hygiene_action !== "keep") return false;
  if (hygiene.body_status !== "has_body") return false;
  if (hygiene.title_status !== "valid") return false;
  if (hygiene.url_status !== "valid" && hygiene.url_status !== "fixed") return false;
  if (hygiene.landing_page_status === "generic_index") return false;
  // Within trusted-hygiene candidates, require either a high score OR a
  // recognised authoritative class (so we still favour primary law/case
  // pages, but never on the class signal alone).
  if (typeof c.score === "number" && c.score >= 0.9) return true;
  const cls = (meta.classified_source_class as string | undefined) ?? "";
  return TRUSTED_PPLX_CLASSES.has(cls);
}

const TRUSTED_PPLX_CLASSES = new Set([
  "official_primary",
  "legislation",
  "court_case",
  "government_report",
  "scholarship",
]);

export interface BuildPoolOptions {
  /** Planned task intent — enables doctrinal-mode demotions. */
  task_intent?: string | null;
  /** discovery_precision_and_listing_suppression_v1 — default on. */
  discovery_precision?: boolean;
  /**
   * academic_richness_last_mile_and_doctrine_mapping_v1 — academic writing
   * runs need many *distinct* scholarly works, which legitimately share a few
   * publisher origins. Only the origin-diversity backfill cap is relaxed; all
   * safety, dedup, listing and integrity gates stay exactly as-is.
   */
  academic_mode?: boolean;
}

function buildCandidatePoolInner(
  allRaw: Candidate[],
  options: BuildPoolOptions,
  tuningEnabled: boolean,
  /** Replacement-only guard: never admit more than the untuned pool did. */
  poolCap: number = CAPS.MAX_CANDIDATES,
): PoolResult {
  const tuningOn = tuningEnabled && isBroadIntent(options.task_intent);
  const POOL_CAP = Math.min(CAPS.MAX_CANDIDATES, Math.max(1, poolCap));
  const dpEnabled = options.discovery_precision !== false;
  const dpT0 = Date.now();
  const dp = emptyDiscoveryDiagnostics();

  // ── Source-integrity classification (deterministic, pre-verifier) ────────
  const integrityById = new Map<string, SourceIntegrity>();
  const rejected: Candidate[] = [];
  const all: Candidate[] = [];
  for (const c of allRaw) {
    const integ = classifySourceIntegrity({
      url: c.source_url,
      title: c.title,
      snippet: c.snippet,
      source_type: c.source_type,
      role: c.role,
    });
    // local_caselaw_content_aware_listing_gate_v1 — a local caselaw row whose
    // stored body was deterministically classified as a substantive judgment
    // is usable as judgment text; its collector URL must not force it into
    // the listing/metadata-only lane. Partial summaries are NOT upgraded, so
    // the metadata-only holding gate keeps them out of holding support.
    const gate = ((c.metadata ?? {}) as Record<string, unknown>)[GATE_META_KEY] as
      | { bypass?: boolean; classification?: string }
      | undefined;
    if (
      gate?.bypass === true && gate.classification === "substantive_judgment_body" &&
      !integ.reject
    ) {
      integ.text_usability = "substantive_excerpt";
      integ.citable_as = "judgment";
      integ.is_judgment_document = true;
      if (integ.authority_tier === "index_or_listing" && /gov\.il/i.test(c.source_url ?? "")) {
        integ.authority_tier = "official_primary";
      }
      integ.integrity_flags = [
        ...(integ.integrity_flags ?? []),
        "local_caselaw_content_verified",
      ];
      integ.downgrade_reason = undefined;
    }
    integrityById.set(c.candidate_id, integ);
    c.metadata = { ...(c.metadata ?? {}), source_integrity: integ };
    if (integ.reject) rejected.push(c);
    else all.push(c);
  }

  // ── discovery_precision_and_listing_suppression_v1 ───────────────────────
  // Classify every surviving candidate, then suppress ONLY clear
  // listing/search/category pages with an explicit reason string. Protected
  // (exact-source / exact-authority / exact-docket / exact-statute / acquired
  // body) candidates are never suppressed; metadata_only is demoted only.
  const precisionById = new Map<string, DiscoveryPrecision>();
  const survivors: Candidate[] = [];
  const suppressed: Candidate[] = [];
  dp.candidates_at_start = all.length;
  dp.status = dpEnabled ? "started" : "not_started";
  if (!dpEnabled) dp.not_run_reason = "discovery_precision_disabled";
  // discovery_precision_stage2_blockers_v1 — hard O(n) guard: exactly one pass
  // over the existing candidate list. No fetch, no retrieval, no pool rebuild.
  for (const c of all) {
    if (!dpEnabled) {
      survivors.push(c);
      continue;
    }
    dp.processed++;
    const p = classifyDiscoveryPrecision({
      candidate: c,
      integrity: integrityById.get(c.candidate_id),
      task_intent: options.task_intent ?? null,
    });
    precisionById.set(c.candidate_id, p);
    c.metadata = { ...(c.metadata ?? {}), discovery_precision: p };
    dp.classified++;
    dp.class_counts[p.discovery_class] = (dp.class_counts[p.discovery_class] ?? 0) + 1;
    if (p.protected && p.protection_reason) {
      dp.protected_counts[p.protection_reason] = (dp.protected_counts[p.protection_reason] ?? 0) + 1;
    }
    if (p.not_suppressible_reason) {
      dp.not_suppressible_reason_counts[p.not_suppressible_reason] =
        (dp.not_suppressible_reason_counts[p.not_suppressible_reason] ?? 0) + 1;
    }
    if (p.suppress && p.suppress_reason) {
      suppressed.push(c);
      dp.suppressed.push({
        candidate_id: c.candidate_id,
        title: c.title,
        url: c.source_url ?? null,
        discovery_class: p.discovery_class,
        reason: p.suppress_reason,
      });
      dp.suppressed_reason_counts[p.suppress_reason] =
        (dp.suppressed_reason_counts[p.suppress_reason] ?? 0) + 1;
    } else {
      survivors.push(c);
    }
  }
  dp.suppression_ran = dpEnabled;
  dp.o_n_guard_ok = !dpEnabled || dp.processed === all.length;
  const listingLike = (c: Candidate) => {
    const p = precisionById.get(c.candidate_id);
    if (p) {
      return p.discovery_class === "index_or_listing" ||
        p.discovery_class === "search_result_page" ||
        p.discovery_class === "category_page";
    }
    return integrityById.get(c.candidate_id)?.authority_tier === "index_or_listing";
  };
  const suppressibleListing = (c: Candidate) => {
    const p = precisionById.get(c.candidate_id);
    return listingLike(c) && (p ? !p.protected : true);
  };
  const ratio = (n: number, d: number) => (d ? Number((n / d).toFixed(3)) : 0);
  for (const c of all) {
    const p = precisionById.get(c.candidate_id);
    if (listingLike(c) && p?.protected && p.protection_reason) {
      dp.protected_listing_counts[p.protection_reason] =
        (dp.protected_listing_counts[p.protection_reason] ?? 0) + 1;
    }
  }
  dp.raw_index_or_listing_ratio = ratio(all.filter(listingLike).length, all.length);
  dp.suppressible_index_or_listing_ratio = ratio(
    all.filter(suppressibleListing).length,
    all.length,
  );


  // docket_aware_url_dedup_v1 — compute the dedupe key once per candidate.
  const dedupeKeyById = new Map<string, ReturnType<typeof buildUrlDedupeKey>>();
  for (const c of all) {
    dedupeKeyById.set(c.candidate_id, buildUrlDedupeKey(c.source_url, c.title));
  }

  const seenDoc = new Set<string>();
  const seenUrl = new Set<string>();
  const seenStatute = new Set<string>();
  const seenDocket = new Set<string>();
  const seenTitle = new Map<string, Candidate>(); // role+normTitle → kept
  const vectorPerClaim = new Map<string, number>();


  // P3.2 #3: priority — exact_authority > text > perplexity > vector.
  // Score still tie-breaks within a tier.
  // local_retrieval_precision_tuning_v1 — strong local vector candidates may
  // compete in the text tier (never above exact authority). Promotion is
  // capped per claim and never bypasses integrity/listing/dedupe gates: the
  // promoted candidate is already a survivor of every earlier filter.
  const rawSim = (c: Candidate): number =>
    c.retrieval_method === "vector" ? c.score / VECTOR_SCORE_WEIGHT : c.score;
  const promoted = new Map<string, string>(); // candidate_id → reason
  if (tuningOn) {
    const byClaim = new Map<string, Candidate[]>();
    for (const c of survivors) {
      if (c.origin !== "local_db" || c.retrieval_method !== "vector") continue;
      if (!CREDIBLE_LOCAL_TYPES.has(c.source_type)) continue;
      if (rawSim(c) < VECTOR_PROMOTE_MIN_SIM) continue;
      const arr = byClaim.get(c.claim_id) ?? [];
      arr.push(c);
      byClaim.set(c.claim_id, arr);
    }
    for (const [, arr] of byClaim) {
      arr.sort((a, b) => b.score - a.score);
      for (const c of arr.slice(0, LOCAL_VECTOR_QUOTA_TUNED)) {
        promoted.set(
          c.candidate_id,
          `local_vector_topical_fit sim=${rawSim(c).toFixed(3)} type=${c.source_type}`,
        );
      }
    }
  }

  const tierOf = (c: Candidate): number => {
    if (c.retrieval_method === "exact_authority") return 0;
    if (c.retrieval_method === "text") return 1;
    if (promoted.has(c.candidate_id)) return 1; // competes with text on score
    if (c.retrieval_method === "perplexity") return 2;
    return 3; // vector
  };
  // Bounded discovery-precision delta reorders inside a tier only.
  const effScore = (c: Candidate): number =>
    (promoted.has(c.candidate_id) ? rawSim(c) : c.score) +
    (precisionById.get(c.candidate_id)?.rank_delta ?? 0);
  const orderBy = (list: Candidate[]) =>
    [...list].sort((a, b) => {
      const t = tierOf(a) - tierOf(b);
      if (t !== 0) return t;
      return effScore(b) - effScore(a);
    });

  // Baseline ordering (suppression-free) — used to identify backfilled slots.
  const baselineRank = new Map<string, number>();
  orderBy(all).forEach((c, i) => baselineRank.set(c.candidate_id, i));

  const sorted = orderBy(survivors);
  const out: Candidate[] = [];
  let dedup_drops = 0;
  const rankOf = new Map<string, number>();
  sorted.forEach((c, i) => rankOf.set(c.candidate_id, i));
  const freedSlots = Math.min(suppressed.length, CAPS.MAX_CANDIDATES);
  const academicMode = options?.academic_mode === true;
  const baseOriginCap = backfillOriginCap(freedSlots);
  // Role-aware relaxation: in academic mode one origin may fill more freed
  // slots, because scholarship arrives in bulk from a handful of publishers.
  const originCap = academicMode
    ? Math.max(baseOriginCap, Math.min(freedSlots, Math.max(8, Math.ceil(freedSlots * 0.9))))
    : baseOriginCap;
  let backfill_origin_cap_drops = 0;
  const backfillsByOrigin = new Map<string, number>();
  const isBackfill = (c: Candidate) =>
    freedSlots > 0 && (baselineRank.get(c.candidate_id) ?? 0) >= CAPS.MAX_CANDIDATES;

  // ── direct_authority_pool_survival_v1 ─────────────────────────────────────
  // Origin diversity is a *soft* pool-shaping constraint. It must not discard a
  // materially stronger direct authority (identified judgment / official
  // primary / statute page) while weaker, lower-scored candidates from another
  // origin still occupy the pool. Deterministic, bounded, no new signals.
  const AUTHORITY_PROTECTIONS = new Set([
    "exact_docket_identity",
    "judgment_document",
    "official_primary_page",
    "official_statute_page",
    "exact_authority_candidate",
  ]);
  const AUTHORITY_CLASSES = new Set([
    "court_case",
    "judgment",
    "legislation",
    "official_primary",
  ]);
  const AUTHORITY_MARGIN = 0.05;
  const authorityExemptBudget = Math.max(3, Math.ceil(POOL_CAP * 0.2));
  let authorityExemptionsUsed = 0;
  const authorityExemptions: Array<{
    candidate_id: string;
    title: string;
    origin: string;
    score: number;
    reason: string;
    weakest_other_origin_score: number;
  }> = [];
  const isDirectAuthority = (c: Candidate): string | null => {
    const p = precisionById.get(c.candidate_id);
    if (p && listingLike(c)) return null;
    if (p?.protected && p.protection_reason && AUTHORITY_PROTECTIONS.has(p.protection_reason)) {
      return `protected:${p.protection_reason}`;
    }
    const integ = integrityById.get(c.candidate_id);
    if (integ?.is_judgment_document === true) return "integrity:judgment_document";
    const cls = String(
      ((c.metadata ?? {}) as Record<string, unknown>).classified_source_class ?? "",
    );
    if (AUTHORITY_CLASSES.has(cls)) return `classified:${cls}`;
    return null;
  };
  /** Lowest effective score among already-admitted candidates of other origins. */
  const weakestOtherOriginScore = (origin: string): number => {
    let min = Number.POSITIVE_INFINITY;
    for (const c of out) {
      if (c.origin === origin) continue;
      const s = effScore(c);
      if (s < min) min = s;
    }
    return min;
  };

  // local_retrieval_precision_tuning_v1 — global share of the pool the
  // promoted local-vector lane may occupy.
  const promotionBudget = Math.max(4, Math.floor(POOL_CAP * 0.4));
  let promotedAdmitted = 0;
  const dropLog: PoolDrop[] = [];
  const logDrop = (c: Candidate, reason: PoolDrop["drop_reason"], key: string) => {
    dropLog.push({
      candidate_id: c.candidate_id,
      title: c.title,
      url: c.source_url ?? null,
      source_type: c.source_type,
      origin: c.origin,
      retrieval_method: c.retrieval_method,
      role: c.role,
      claim_id: c.claim_id,
      rank_before_drop: rankOf.get(c.candidate_id) ?? -1,
      drop_reason: reason,
      drop_key: key,
      score: c.score,
    });
  };

  // Shared admission routine — runs the existing dedup/vector-cap checks and pushes into `out`.
  // Returns true if admitted.
  const tryAdmit = (c: Candidate): boolean => {
    if (out.length >= POOL_CAP) {
      logDrop(c, "max_candidates_cap", `cap:${POOL_CAP}`);
      return false;
    }
    // Backfill diversity guard — one origin may not take every freed slot.
    if (isBackfill(c)) {
      const n = backfillsByOrigin.get(c.origin) ?? 0;
      if (n >= originCap) {
        // direct_authority_pool_survival_v1 — bounded exemption: a materially
        // stronger direct authority is not discarded on origin grounds alone.
        const authorityReason = isDirectAuthority(c);
        const weakest = weakestOtherOriginScore(c.origin);
        const stronger = !Number.isFinite(weakest) ||
          effScore(c) >= weakest + AUTHORITY_MARGIN;
        if (
          authorityReason && stronger && authorityExemptionsUsed < authorityExemptBudget
        ) {
          authorityExemptionsUsed++;
          authorityExemptions.push({
            candidate_id: c.candidate_id,
            title: c.title,
            origin: c.origin,
            score: Number(effScore(c).toFixed(4)),
            reason: authorityReason,
            weakest_other_origin_score: Number.isFinite(weakest)
              ? Number(weakest.toFixed(4))
              : -1,
          });
        } else {
          backfill_origin_cap_drops++;
          logDrop(c, "backfill_origin_diversity_cap", `${c.origin}:${originCap}`);
          return false;
        }
      }
    }

    if (c.retrieval_method === "vector") {
      // The wider quota is reserved for local candidates that cleared the
      // topical-fit/credibility bar, and only up to a global share of the
      // pool, so the semantic lane can never crowd out official/primary
      // material.
      const promotedSlot = tuningOn && c.origin === "local_db" &&
        promoted.has(c.candidate_id) && promotedAdmitted < promotionBudget;
      const quota = promotedSlot ? LOCAL_VECTOR_QUOTA_TUNED : MAX_VECTOR_PER_CLAIM;
      const n = vectorPerClaim.get(c.claim_id) ?? 0;
      if (n >= quota) {
        dedup_drops++;
        logDrop(c, "vector_quota_per_claim", `vector:${c.claim_id}:${quota}`);
        return false;
      }
    }
    const docId = c.document_id ? `doc:${c.document_id}` : "";
    // docket_aware_url_dedup_v1 — identity-bearing key for recognised
    // court/gov document endpoints; host+path elsewhere (unchanged).
    const dedupe = dedupeKeyById.get(c.candidate_id)!;
    const urlKey = dedupe.key ? `url:${dedupe.key}` : "";

    const stKey = statuteKey(c);
    const stK = stKey ? `st:${stKey}` : "";
    const dkKey = docketKey(c);
    const dk = dkKey ? `dk:${dkKey}` : "";
    const ttKey = `tt:${c.role}:${normTitle(c.title)}`;

    if (docId && seenDoc.has(docId)) { dedup_drops++; logDrop(c, "dup_document_id", docId); return false; }
    if (urlKey && seenUrl.has(urlKey)) { dedup_drops++; logDrop(c, "dup_url", urlKey); return false; }
    if (stK && seenStatute.has(stK)) { dedup_drops++; logDrop(c, "dup_statute_section", stK); return false; }
    if (dk && seenDocket.has(dk)) { dedup_drops++; logDrop(c, "dup_docket", dk); return false; }
    if (seenTitle.has(ttKey)) { dedup_drops++; logDrop(c, "dup_role_title", ttKey); return false; }

    if (docId) seenDoc.add(docId);
    if (urlKey) seenUrl.add(urlKey);
    if (stK) seenStatute.add(stK);
    if (dk) seenDocket.add(dk);
    seenTitle.set(ttKey, c);
    if (c.retrieval_method === "vector") {
      vectorPerClaim.set(c.claim_id, (vectorPerClaim.get(c.claim_id) ?? 0) + 1);
      if (tuningOn && c.origin === "local_db" && promoted.has(c.candidate_id)) {
        promotedAdmitted++;
      }
    }
    if (isBackfill(c)) {
      // Backfill only re-ranks candidates already in `all` — it never triggers
      // retrieval, fetch, verifier passes or a pool rebuild.
      backfillsByOrigin.set(c.origin, (backfillsByOrigin.get(c.origin) ?? 0) + 1);
      dp.backfilled++;
      dp.backfill_ran = true;
      dp.backfilled_by_origin[c.origin] = (dp.backfilled_by_origin[c.origin] ?? 0) + 1;
    }

    out.push(c);
    return true;
  };

  // Pass A: reserve up to MIN_TRUSTED_PERPLEXITY slots for trusted Perplexity candidates,
  // walked in the same global score-sorted order. Quality-gated only — no blind top-N.
  let reserved = 0;
  const reservedIds = new Set<string>();
  for (const c of sorted) {
    if (reserved >= MIN_TRUSTED_PERPLEXITY) break;
    if (!isTrustedPerplexity(c)) continue;
    if (tryAdmit(c)) {
      reservedIds.add(c.candidate_id);
      reserved++;
    }
  }

  // Pass B: existing tier-priority fill. Already-admitted candidates fall out via dedup sets
  // (by document_id / url / title). Track candidate_id explicitly for items without those keys.
  for (const c of sorted) {
    if (reservedIds.has(c.candidate_id)) continue;
    tryAdmit(c);
    if (out.length >= POOL_CAP) break;
  }


  const counts = {
    by_origin: {} as Record<string, number>,
    by_role: {} as Record<string, number>,
    by_claim: {} as Record<string, number>,
  };
  for (const c of out) {
    counts.by_origin[c.origin] = (counts.by_origin[c.origin] ?? 0) + 1;
    counts.by_role[c.role] = (counts.by_role[c.role] ?? 0) + 1;
    counts.by_claim[c.claim_id] = (counts.by_claim[c.claim_id] ?? 0) + 1;
  }

  // A candidate can be provisionally rejected in pass A (trusted reservation)
  // and admitted later in pass B; keep only drops for candidates that never
  // made it into the final pool, deduped by candidate_id (first reason wins).
  const admittedIds = new Set(out.map((c) => c.candidate_id));
  const seenDropIds = new Set<string>();
  const drops = dropLog.filter((d) => {
    if (admittedIds.has(d.candidate_id)) return false;
    if (seenDropIds.has(d.candidate_id)) return false;
    seenDropIds.add(d.candidate_id);
    return true;
  });

  // Integrity rejects (placeholder / malformed / search pages) never reach the
  // verifier; log them alongside the dedup drops.
  for (const c of rejected) {
    const integ = integrityById.get(c.candidate_id)!;
    drops.push({
      candidate_id: c.candidate_id,
      title: c.title,
      url: c.source_url ?? null,
      source_type: c.source_type,
      origin: c.origin,
      retrieval_method: c.retrieval_method,
      role: c.role,
      claim_id: c.claim_id,
      rank_before_drop: -1,
      drop_reason: "source_integrity_reject",
      drop_key: integ.reject_reason ?? "integrity",
      score: c.score,
    });
  }

  const integrity: IntegrityLogRow[] = out.map((c) => {
    const integ = integrityById.get(c.candidate_id)!;
    const sr = assignSynthesisRole({
      role: c.role,
      integrity: integ,
      title: c.title,
      snippet: c.snippet,
    });
    return {
      candidate_id: c.candidate_id,
      title: c.title,
      url: c.source_url ?? null,
      role: c.role,
      original_source_type: c.source_type,
      authority_tier: integ.authority_tier,
      text_usability: integ.text_usability,
      citable_as: integ.citable_as,
      integrity_flags: integ.integrity_flags,
      can_satisfy_role: canSatisfyRole(integ, c.role),
      is_judgment_document: integ.is_judgment_document ?? false,
      has_holding_text: integ.has_holding_text ?? false,
      synthesis_role: sr.synthesis_role,
      synthesis_role_seeded_from: sr.seeded_from,
      synthesis_role_overridden: sr.overridden,
      downgrade_reason: integ.downgrade_reason,
    };
  });

  // docket_aware_url_dedup_v1 telemetry.
  const admittedIdSet = new Set(out.map((c) => c.candidate_id));
  const url_dedupe: UrlDedupeLogRow[] = [];
  const identityCounts: Record<string, number> = {};
  const legacyCollapseSeen = new Set<string>();
  let rescued = 0;
  for (const c of all) {
    const d = dedupeKeyById.get(c.candidate_id)!;
    identityCounts[d.identity_source] = (identityCounts[d.identity_source] ?? 0) + 1;
    if (d.identity_source !== "normal_url" && admittedIdSet.has(c.candidate_id)) {
      // Admitted candidates that would have collided under the legacy key.
      if (legacyCollapseSeen.has(d.normalized_url_old)) rescued++;
      legacyCollapseSeen.add(d.normalized_url_old);
    }
    url_dedupe.push({
      candidate_id: c.candidate_id,
      title: c.title,
      original_url: c.source_url ?? null,
      normalized_url_old: d.normalized_url_old,
      dedupe_key: d.key,
      dedupe_identity_params_used: d.identity_params_used,
      dedupe_identity_source: d.identity_source,
      admitted: admittedIdSet.has(c.candidate_id),
    });
  }

  // discovery_precision — suppressed candidates are recorded as diagnostics
  // drops so they are auditable but never consume any downstream budget.
  for (const c of suppressed) {
    const p = precisionById.get(c.candidate_id)!;
    drops.push({
      candidate_id: c.candidate_id,
      title: c.title,
      url: c.source_url ?? null,
      source_type: c.source_type,
      origin: c.origin,
      retrieval_method: c.retrieval_method,
      role: c.role,
      claim_id: c.claim_id,
      rank_before_drop: baselineRank.get(c.candidate_id) ?? -1,
      drop_reason: "discovery_listing_suppressed",
      drop_key: p.suppress_reason ?? p.discovery_class,
      score: c.score,
    });
  }
  dp.pool_before = all.length;
  dp.pool_after = out.length;
  dp.final_raw_index_or_listing_ratio = ratio(out.filter(listingLike).length, out.length);
  dp.final_suppressible_listing_ratio = ratio(
    out.filter(suppressibleListing).length,
    out.length,
  );
  if (dpEnabled) dp.status = "completed";
  dp.ms = Date.now() - dpT0;


  // local_retrieval_precision_tuning_v1 — per-candidate rerank rows. The
  // "old rank" is the untuned ordering of the same survivor set.
  const untunedRank = new Map<string, number>();
  [...survivors]
    .sort((a, b) => {
      const t0 = (c: Candidate) =>
        c.retrieval_method === "exact_authority" ? 0
          : c.retrieval_method === "text" ? 1
          : c.retrieval_method === "perplexity" ? 2
          : 3;
      const t = t0(a) - t0(b);
      if (t !== 0) return t;
      return (b.score + (precisionById.get(b.candidate_id)?.rank_delta ?? 0)) -
        (a.score + (precisionById.get(a.candidate_id)?.rank_delta ?? 0));
    })
    .forEach((c, i) => untunedRank.set(c.candidate_id, i));

  const reranking: LocalRerankRow[] = [];
  for (const c of survivors) {
    const reason = promoted.get(c.candidate_id);
    if (!reason) continue;
    const oldRank = untunedRank.get(c.candidate_id) ?? -1;
    const newRank = rankOf.get(c.candidate_id) ?? -1;
    if (newRank < 0 || newRank >= oldRank) continue;
    reranking.push({
      candidate_id: c.candidate_id,
      title: c.title,
      source_type: c.source_type,
      method: c.retrieval_method,
      old_rank: oldRank,
      new_rank: newRank,
      rerank_reason: reason,
      displaced_candidate_method: null,
      displaced_candidate_reason: null,
    });
  }

  return {
    candidates: out,
    found: allRaw.length,
    after_dedup: out.length,
    dedup_drops,
    drops,
    integrity,
    integrity_rejects: rejected.length,
    url_dedupe,
    url_dedupe_identity_source_counts: identityCounts,
    url_dedupe_rescued_from_legacy_collapse: rescued,
    discovery_precision: dp,
    counts,
    vector_tuning: tuningOn
      ? {
        mode: options.task_intent ?? null,
        enabled: true,
        old_quota: MAX_VECTOR_PER_CLAIM,
        new_quota: LOCAL_VECTOR_QUOTA_TUNED,
        vector_candidates_seen: all.filter((c) =>
          c.origin === "local_db" && c.retrieval_method === "vector"
        ).length,
        vector_candidates_admitted_before: 0, // filled by the wrapper
        vector_candidates_admitted_after: out.filter((c) =>
          c.origin === "local_db" && c.retrieval_method === "vector"
        ).length,
        text_candidates_displaced: 0, // filled by the wrapper
        final_pool_size_before: 0, // filled by the wrapper
        final_pool_size_after: out.length,
        average_vector_score: avg(
          out.filter((c) => c.retrieval_method === "vector").map((c) => rawSim(c)),
        ),
        elapsed_ms: Date.now() - dpT0,
      }
      : null,
    reranking,
    pool_collapse: {
      academic_mode: academicMode,
      raw_found: allRaw.length,
      after_integrity: all.length,
      after_listing_and_precision: survivors.length,
      final_pool: out.length,
      origin_cap_used: originCap,
      origin_cap_base: baseOriginCap,
      backfill_origin_cap_drops,
      drops_by_reason: dropLog.reduce((acc: Record<string, number>, d) => {
        acc[d.drop_reason] = (acc[d.drop_reason] ?? 0) + 1;
        return acc;
      }, {}),
    },
  };
}

function avg(xs: number[]): number {
  if (!xs.length) return 0;
  return Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(4));
}

/**
 * local_retrieval_precision_tuning_v1 — public entry point.
 *
 * Runs the tuned pool. In broad/academic modes it also runs the untuned pool
 * (pure CPU, same inputs) purely to produce before/after telemetry; the tuned
 * result is always the one returned. Listing suppression, source integrity,
 * dedupe and `CAPS.MAX_CANDIDATES` are identical in both passes.
 */
export function buildCandidatePool(
  allRaw: Candidate[],
  options: BuildPoolOptions = {},
): PoolResult {
  const t0 = Date.now();
  if (!isBroadIntent(options.task_intent)) {
    return buildCandidatePoolInner(allRaw, options, false);
  }
  // Baseline first: its size becomes the hard cap for the tuned pass, so the
  // tuning can only *replace* candidates, never expand the pool.
  const baseline = buildCandidatePoolInner(allRaw, options, false);
  const tuned = buildCandidatePoolInner(
    allRaw,
    options,
    true,
    baseline.candidates.length,
  );
  if (!tuned.vector_tuning) return tuned;
  const tunedIds = new Set(tuned.candidates.map((c) => c.candidate_id));
  const displaced = baseline.candidates.filter(
    (c) => !tunedIds.has(c.candidate_id) && c.retrieval_method === "text",
  );
  tuned.vector_tuning.vector_candidates_admitted_before = baseline.candidates.filter(
    (c) => c.origin === "local_db" && c.retrieval_method === "vector",
  ).length;
  tuned.vector_tuning.text_candidates_displaced = displaced.length;
  tuned.vector_tuning.final_pool_size_before = baseline.candidates.length;
  tuned.vector_tuning.elapsed_ms = Date.now() - t0;
  // Attach the displaced counterpart to each rerank row, positionally.
  tuned.reranking.forEach((row, i) => {
    const d = displaced[i];
    if (!d) return;
    row.displaced_candidate_method = d.retrieval_method;
    row.displaced_candidate_reason = `displaced_by_local_vector rank=${
      baseline.candidates.indexOf(d)
    } score=${d.score.toFixed(3)}`;
  });
  return tuned;
}



