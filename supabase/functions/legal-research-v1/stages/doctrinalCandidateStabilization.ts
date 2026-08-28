/**
 * doctrinal_candidate_pool_stabilization_v1
 *
 * Deterministic, read-mostly helpers that stabilise the *doctrinal* candidate
 * pool before sufficiency runs. Three jobs:
 *
 *  1. Conservative listing/index suppression, so clear search/category/listing
 *     pages do not consume secondary-acquisition budget that direct/partial
 *     doctrinal candidates need. A candidate with strong article/report
 *     identity and a plausible body path is NEVER suppressed on URL shape.
 *
 *  2. A reconsideration predicate: verifier direct/partial candidates whose
 *     initial `source_type` is imperfect but that look like legal scholarship
 *     may earn ONE acquisition attempt. Signals justify an *attempt* only —
 *     never eligibility, never citation. Eligibility still requires an
 *     acquired body plus source-integrity plus doctrinal typing.
 *
 *  3. A pre-sufficiency pool snapshot + a strictly bounded recovery trigger.
 *     Recovery may fail safely: when it does not produce acquired,
 *     integrity-passing, eligible doctrinal sources, the normal insufficiency
 *     branch proceeds and the exact failure is logged.
 *
 * Nothing here relaxes a sufficiency threshold, touches claim-source-match,
 * judgment identity, docket limitation, statute authority or footnotes.
 */

import type { Candidate, SupportLevel, Verdict } from "../lib/types.ts";
import type { SourceUsePlan } from "../lib/types.ts";

/** Task intents for which doctrinal pool stabilization is meaningful. */
export const DOCTRINAL_TASK_INTENTS = new Set([
  "doctrinal_explanation",
  "case_law_synthesis",
  "literature_map",
  "seminar_planning",
  "source_recommendation",
  "legal_research_guidance",
]);

/** Depth modes on which recovery may run at all. */
export const DOCTRINAL_DEPTH_MODES = new Set([
  "broad_research",
  "academic_research",
  "narrow_doctrine",
]);

const DEEP_DEPTH_MODES = new Set(["academic_research", "broad_research"]);

export const RECOVERY_LIMITS = {
  MAX_CANDIDATES: 3,
  MAX_LOCAL_LOOKUPS: 2,
  MAX_WEB_ATTEMPTS_NORMAL: 1,
  MAX_WEB_ATTEMPTS_DEEP: 2,
  TOTAL_MS_NORMAL: 10_000,
  TOTAL_MS_DEEP: 15_000,
  /** Below this many acquired eligible doctrinal sources recovery may fire. */
  ELIGIBLE_FLOOR: 2,
} as const;

export function recoveryBudgetFor(depthMode: string | null): {
  max_candidates: number;
  max_local_lookups: number;
  max_web_attempts: number;
  total_ms: number;
  deep: boolean;
} {
  const deep = DEEP_DEPTH_MODES.has(String(depthMode ?? ""));
  return {
    max_candidates: RECOVERY_LIMITS.MAX_CANDIDATES,
    max_local_lookups: RECOVERY_LIMITS.MAX_LOCAL_LOOKUPS,
    max_web_attempts: deep
      ? RECOVERY_LIMITS.MAX_WEB_ATTEMPTS_DEEP
      : RECOVERY_LIMITS.MAX_WEB_ATTEMPTS_NORMAL,
    total_ms: deep ? RECOVERY_LIMITS.TOTAL_MS_DEEP : RECOVERY_LIMITS.TOTAL_MS_NORMAL,
    deep,
  };
}

// ── shared signal vocabulary ──────────────────────────────────────────────

const ARTICLE_SIGNAL_RE =
  /(מאמר|כתב עת|רבעון|עיוני משפט|משפטים|הפרקליט|משפט וממשל|עלי משפט|מחקרי משפט|law review|journal|article)/i;
const BOOK_SIGNAL_RE = /(ספר|כרך|מהדורה|הוצאת|בתוך:|עורכ|treatise|chapter|בעריכת)/;
const COMMENTARY_SIGNAL_RE = /(פרשנות|פירוש|ניתוח משפטי|סקירה משפטית|דוקטרינ|commentary|doctrin)/i;
const REPORT_SIGNAL_RE =
  /(דו"ח|דוח|דין וחשבון|נייר עמדה|מחקר מדיניות|מרכז המחקר והמידע|מבקר המדינה|ועדת|report|policy paper)/;
const ACADEMIC_HOST_RE =
  /(ac\.il|\.edu|jstor|heinonline|repository|journals?|ssrn|academia\.edu|idi\.org\.il|knesset\.gov\.il\/mmm|mevaker\.gov\.il)/i;

const NEWS_HOST_RE =
  /(ynet|walla|mako|calcalist|globes|haaretz|maariv|israelhayom|n12|kan\.org\.il|prnewswire|businesswire)/i;
const NEWS_SIGNAL_RE = /(הודעה לעיתונות|כתבה|מבזק|press release)/;

/** Clear listing/index/search/category URL shapes. */
const LISTING_URL_RE =
  /(\/search\b|[?&](q|query|search|keyword)=|\/results?\b|\/tagged?\b|\/category\/|\/categories\/|\/index\.(html?|php)$|\/archive\/?$|\/list(ing)?s?\b|\/browse\b|\/sitemap)/i;
/** Paths that plausibly lead to a body / downloadable full text. */
const BODY_PATH_RE = /(\.pdf|\.docx?|\/download|\/fulltext|\/article|\/publication|\/files?\/|\/pdf\/)/i;

function textOf(c: Candidate): string {
  return `${c.title ?? ""} ${c.snippet ?? ""}`;
}

function integrityOf(c: Candidate): Record<string, unknown> {
  const meta = (c.metadata ?? {}) as Record<string, unknown>;
  return (meta.source_integrity as Record<string, unknown>) ?? {};
}

export function hasAcquiredBody(c: Candidate): boolean {
  const meta = (c.metadata ?? {}) as Record<string, unknown>;
  return meta.body_acquired === true || meta.secondary_body_acquired === true ||
    meta.judgment_text_acquired === true || meta.statute_text_acquired === true;
}

/** Strong article/report identity — protects a candidate from suppression. */
export function hasStrongDoctrinalIdentity(c: Candidate): boolean {
  const hay = textOf(c);
  const url = String(c.source_url ?? "");
  return ARTICLE_SIGNAL_RE.test(hay) || BOOK_SIGNAL_RE.test(hay) ||
    REPORT_SIGNAL_RE.test(hay) || ACADEMIC_HOST_RE.test(url);
}

/**
 * Conservative listing suppression. Suppress ONLY clear index / listing /
 * search / category pages. A candidate with strong article/report identity and
 * a plausible body or download path is never suppressed on URL shape alone.
 */
export function assessListingSuppression(
  c: Candidate,
): { suppress: boolean; reason: string } {
  if (hasAcquiredBody(c)) return { suppress: false, reason: "body_already_acquired" };

  const integ = integrityOf(c);
  const tier = String(integ.authority_tier ?? "");
  const citable = String(integ.citable_as ?? "");
  const usability = String(integ.text_usability ?? "");
  const url = String(c.source_url ?? "");

  const strong = hasStrongDoctrinalIdentity(c);
  const bodyPath = BODY_PATH_RE.test(url);
  if (strong && bodyPath) return { suppress: false, reason: "strong_identity_with_body_path" };

  if (tier === "index_or_listing" || usability === "listing_page") {
    return { suppress: true, reason: "integrity_index_or_listing" };
  }
  if (citable === "not_citable" && !strong) {
    return { suppress: true, reason: "integrity_not_citable" };
  }
  if (LISTING_URL_RE.test(url) && !strong) {
    return { suppress: true, reason: "listing_url_shape" };
  }
  return { suppress: false, reason: "not_a_listing" };
}

/**
 * May this candidate earn ONE acquisition attempt despite an imperfect
 * `source_type`? Signals justify an attempt only — never eligibility.
 */
export function assessDoctrinalReconsideration(
  c: Candidate,
  support: SupportLevel | null,
): { reconsider: boolean; reason: string; evidence: string[] } {
  const evidence: string[] = [];
  const no = (reason: string) => ({ reconsider: false, reason, evidence });

  if (support !== "direct" && support !== "partial") return no("verifier_not_direct_or_partial");
  if (hasAcquiredBody(c)) return no("body_already_acquired");

  const suppression = assessListingSuppression(c);
  if (suppression.suppress) return no(`listing_suppressed:${suppression.reason}`);

  const type = String(c.source_type ?? "").toLowerCase();
  if (
    type === "case" || type === "caselaw" || type === "judgment" || type === "statute" ||
    type === "israeli_law" || type === "legislation" || type === "legislation_primary" ||
    type === "legislation_secondary" || type === "regulation"
  ) {
    return no("primary_law_or_case_law");
  }

  const url = String(c.source_url ?? "");
  const hay = textOf(c);
  if (NEWS_HOST_RE.test(url) || NEWS_SIGNAL_RE.test(hay)) return no("news_or_pr_page");

  const integ = integrityOf(c);
  if (String(integ.text_usability ?? "") === "metadata_only" && !url && !BODY_PATH_RE.test(url)) {
    return no("metadata_only_no_body_path");
  }
  if (!url && String(c.origin ?? "") !== "local_db") return no("no_path_to_body");

  if (ARTICLE_SIGNAL_RE.test(hay)) evidence.push("article_signal");
  if (BOOK_SIGNAL_RE.test(hay)) evidence.push("book_or_chapter_signal");
  if (COMMENTARY_SIGNAL_RE.test(hay)) evidence.push("commentary_or_doctrine_signal");
  if (REPORT_SIGNAL_RE.test(hay)) evidence.push("report_signal");
  if (ACADEMIC_HOST_RE.test(url)) evidence.push("academic_host");
  if (c.role === "scholarship" || c.role === "government_report") {
    evidence.push(`role:${c.role}`);
  }
  if (String(c.snippet ?? "").length >= 300) evidence.push("substantive_snippet");

  if (evidence.length === 0) return no("no_doctrinal_signal");
  return { reconsider: true, reason: "promising_doctrinal_candidate", evidence };
}

// ── pool snapshot ─────────────────────────────────────────────────────────

const DOCTRINAL_TYPES = new Set([
  "legal_article",
  "journal_article",
  "article",
  "scholarship",
  "book",
  "book_chapter",
  "book_or_chapter",
  "chapter",
  "commentary",
  "doctrinal_commentary",
  "secondary_commentary",
]);
const INSTITUTIONAL_TYPES = new Set([
  "report",
  "government_report",
  "institutional_report",
]);

function integrityPasses(c: Candidate): boolean {
  const integ = integrityOf(c);
  if (integ.reject === true) return false;
  const tier = String(integ.authority_tier ?? "");
  const usability = String(integ.text_usability ?? "");
  if (tier === "index_or_listing" || tier === "non_authority") return false;
  if (usability === "metadata_only" || usability === "listing_page") return false;
  if (String(integ.citable_as ?? "") === "not_citable") return false;
  return true;
}

/** Acquired body + integrity + doctrinal typing. No signal-only shortcuts. */
export function isAcquiredEligibleDoctrinal(c: Candidate): boolean {
  if (!hasAcquiredBody(c)) return false;
  if (!integrityPasses(c)) return false;
  return DOCTRINAL_TYPES.has(String(c.source_type ?? "").toLowerCase());
}

export function isAcquiredEligibleInstitutional(c: Candidate): boolean {
  if (!hasAcquiredBody(c)) return false;
  if (!integrityPasses(c)) return false;
  return INSTITUTIONAL_TYPES.has(String(c.source_type ?? "").toLowerCase());
}

export interface DoctrinalPoolSnapshot {
  total_candidates: number;
  verifier_direct: number;
  verifier_partial: number;
  secondary_typed: number;
  institutional_typed: number;
  blocked_not_doctrinal_type: number;
  skipped_no_body_acquisition_attempted: number;
  index_or_listing: number;
  not_citable: number;
  acquired_bodies: number;
  doctrinal_eligible: number;
  institutional_eligible: number;
  reconsiderable_candidate_ids: string[];
  /** Why promising direct/partial candidates were NOT reconsidered. */
  reconsideration_rejections: Record<string, number>;
}

export function bestSupportByCandidate(verdicts: Verdict[]): Map<string, SupportLevel> {
  const rank: Record<string, number> = { direct: 3, partial: 2, tangential: 1, unrelated: 0 };
  const out = new Map<string, SupportLevel>();
  for (const v of verdicts) {
    const prev = out.get(v.candidate_id);
    if (!prev || (rank[v.support] ?? 0) > (rank[prev] ?? 0)) out.set(v.candidate_id, v.support);
  }
  return out;
}

export function buildDoctrinalPoolSnapshot(input: {
  candidates: Candidate[];
  verdicts: Verdict[];
  attempted_candidate_ids?: string[];
}): DoctrinalPoolSnapshot {
  const support = bestSupportByCandidate(input.verdicts);
  const attempted = new Set(input.attempted_candidate_ids ?? []);
  const snap: DoctrinalPoolSnapshot = {
    total_candidates: input.candidates.length,
    verifier_direct: 0,
    verifier_partial: 0,
    secondary_typed: 0,
    institutional_typed: 0,
    blocked_not_doctrinal_type: 0,
    skipped_no_body_acquisition_attempted: 0,
    index_or_listing: 0,
    not_citable: 0,
    acquired_bodies: 0,
    doctrinal_eligible: 0,
    institutional_eligible: 0,
    reconsiderable_candidate_ids: [],
    reconsideration_rejections: {},
  };

  for (const c of input.candidates) {
    const s = support.get(c.candidate_id) ?? null;
    if (s === "direct") snap.verifier_direct++;
    if (s === "partial") snap.verifier_partial++;

    const type = String(c.source_type ?? "").toLowerCase();
    if (DOCTRINAL_TYPES.has(type)) snap.secondary_typed++;
    if (INSTITUTIONAL_TYPES.has(type)) snap.institutional_typed++;

    const integ = integrityOf(c);
    if (String(integ.authority_tier ?? "") === "index_or_listing") snap.index_or_listing++;
    if (String(integ.citable_as ?? "") === "not_citable") snap.not_citable++;

    if (hasAcquiredBody(c)) snap.acquired_bodies++;
    if (isAcquiredEligibleDoctrinal(c)) snap.doctrinal_eligible++;
    if (isAcquiredEligibleInstitutional(c)) snap.institutional_eligible++;

    const promising = (s === "direct" || s === "partial") && !hasAcquiredBody(c);
    if (promising && !DOCTRINAL_TYPES.has(type) && !INSTITUTIONAL_TYPES.has(type)) {
      snap.blocked_not_doctrinal_type++;
    }
    if (promising && !attempted.has(c.candidate_id)) {
      snap.skipped_no_body_acquisition_attempted++;
    }

    const rec = assessDoctrinalReconsideration(c, s);
    if (rec.reconsider && !attempted.has(c.candidate_id)) {
      snap.reconsiderable_candidate_ids.push(c.candidate_id);
    } else if (promising) {
      const key = attempted.has(c.candidate_id) ? "already_attempted" : rec.reason;
      snap.reconsideration_rejections[key] = (snap.reconsideration_rejections[key] ?? 0) + 1;
    }
  }
  return snap;
}

export interface RecoveryDecision {
  should_run: boolean;
  reason: string;
  candidate_ids: string[];
  budget: ReturnType<typeof recoveryBudgetFor>;
}

/**
 * Recovery may run only for doctrinal/academic tasks that are about to fall to
 * insufficiency with fewer than 2 acquired eligible doctrinal sources while
 * promising direct/partial candidates were never acquired.
 */
export function decideDoctrinalRecovery(input: {
  snapshot: DoctrinalPoolSnapshot;
  plan: SourceUsePlan | null | undefined;
  depth_mode: string | null;
  candidates: Candidate[];
  verdicts: Verdict[];
  budget_allows: boolean;
}): RecoveryDecision {
  const budget = recoveryBudgetFor(input.depth_mode);
  const none = (reason: string): RecoveryDecision => ({
    should_run: false,
    reason,
    candidate_ids: [],
    budget,
  });

  const intent = String(input.plan?.user_task_intent ?? "");
  const secondary = String(input.plan?.secondary_task_intent ?? "");
  const intentOk = DOCTRINAL_TASK_INTENTS.has(intent) ||
    (input.plan?.mixed_plan === true && DOCTRINAL_TASK_INTENTS.has(secondary));
  if (!intentOk) return none(`task_intent_not_doctrinal:${intent || "unknown"}`);
  if (intent === "case_holding" && !input.plan?.mixed_plan) return none("case_holding_task");
  if (!DOCTRINAL_DEPTH_MODES.has(String(input.depth_mode ?? ""))) {
    return none(`depth_mode_not_eligible:${input.depth_mode ?? "unknown"}`);
  }
  if (input.snapshot.doctrinal_eligible >= RECOVERY_LIMITS.ELIGIBLE_FLOOR) {
    return none("eligible_floor_already_met");
  }
  if (input.snapshot.reconsiderable_candidate_ids.length === 0) {
    return none("no_promising_skipped_candidates");
  }
  if (!input.budget_allows) return none("runtime_budget_exhausted");

  const support = bestSupportByCandidate(input.verdicts);
  const byId = new Map(input.candidates.map((c) => [c.candidate_id, c]));
  const ranked = input.snapshot.reconsiderable_candidate_ids
    .map((id) => {
      const c = byId.get(id);
      const s = c ? support.get(id) ?? null : null;
      const rec = c ? assessDoctrinalReconsideration(c, s) : { evidence: [] as string[] };
      return {
        id,
        direct: s === "direct" ? 1 : 0,
        local: c && String(c.origin ?? "") === "local_db" ? 1 : 0,
        evidence: rec.evidence.length,
      };
    })
    .sort((a, b) =>
      b.direct - a.direct || b.local - a.local || b.evidence - a.evidence ||
      a.id.localeCompare(b.id)
    )
    .slice(0, budget.max_candidates)
    .map((r) => r.id);

  return {
    should_run: true,
    reason: "weak_fixable_doctrinal_pool",
    candidate_ids: ranked,
    budget,
  };
}
