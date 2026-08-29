// discovery_precision_and_listing_suppression_v1
//
// Deterministic, pre-verifier classification of discovered candidates so that
// listing / index / search / category pages do not occupy pool slots, verifier
// slots, acquisition budget or drafter pack slots.
//
// Hard rules (approved guardrails):
//  - metadata_only is DEMOTED, never suppressed, unless it also matches clear
//    listing / search / category signals.
//  - exact-source, exact-authority, exact-docket and exact-statute candidates
//    are NEVER suppressed here. Later identity / statute gates decide usability.
//  - Suppression must be explainable: no explicit reason string ⇒ no suppression.
//
// No network calls, no LLM calls. Pure functions only.

import type { Candidate } from "../lib/types.ts";
import type { SourceIntegrity } from "./sourceIntegrity.ts";

export const DISCOVERY_CLASSES = [
  "citable_candidate",
  "possible_body_page",
  "index_or_listing",
  "search_result_page",
  "category_page",
  "metadata_only",
  "not_citable",
] as const;
export type DiscoveryClass = typeof DISCOVERY_CLASSES[number];

export interface DiscoveryPrecision {
  discovery_class: DiscoveryClass;
  /** Human-readable signal strings that produced the class. */
  reasons: string[];
  /** True when the candidate may never be suppressed by this stage. */
  protected: boolean;
  protection_reason?: string;
  /** True when this stage is allowed to suppress the candidate. */
  suppressible: boolean;
  /** Why the candidate is not suppressible (protection or class). */
  not_suppressible_reason?: string;
  /** Suppress from the main pool (only ever true with a non-empty reason). */
  suppress: boolean;
  suppress_reason?: string;
  /** Bounded score delta applied within the existing retrieval tier. */
  rank_delta: number;
  rank_signals: string[];
}


export interface DiscoveryInput {
  candidate: Candidate;
  integrity?: SourceIntegrity | null;
  /** Planned task intent; enables doctrinal-mode demotions. */
  task_intent?: string | null;
}

const DOCTRINAL_INTENTS = new Set([
  "doctrinal_explanation",
  "broad_research",
  "academic_research",
  "literature_map",
  "seminar_planning",
]);

// ── URL shape signals ──────────────────────────────────────────────────────
const SEARCH_PATH_RE =
  /(^|\/)(search|searchresults|results|find|query|כתובות)(\/|$)|[?&](q|query|search|s|keywords|freetext)=/i;
const CATEGORY_PATH_RE = /(^|\/)(category|categories|tag|tags|topics?|subjects?|section)(\/|$)/i;
const LISTING_PATH_RE =
  /(^|\/)(index|indexes|list|lists|listing|listings|archive|archives|catalog|catalogue|browse|directory|sitemap|feed|rss|all)(\.[a-z]{2,4})?(\/|$)|(^|\/)page\/\d+(\/|$)/i;
const HEB_LISTING_RE = /(חיפוש|תוצאות|קטגוריה|קטגוריות|תגית|תגיות|ארכיון|רשימת|מאגר\s+פסקי|כל\s+ה)/;
const BODY_PATH_RE = /\.(pdf|docx?|rtf|txt)(\?|#|$)|\/(download|files?|documents?|uploads?|attachment)s?\//i;
// NOTE: no \b anchors — Hebrew letters are non-word chars for JS word boundaries.
const DOCKET_RE = /(בג"?ץ|בג״ץ|ע"?א|רע"?א|ע"?פ|רע"?פ|בש"?א|עה"?ס|עע"?ם|ד"?נ)\s*\d{1,6}\/\d{2,4}(?!\d)/;

const ARTICLE_IDENTITY_RE =
  /(מאמר|כתב\s*עת|עיוני\s*משפט|משפטים|הפרקליט|מחקר|דו"?ח|דוח|report|article|journal|working\s*paper|chapter|פרק\s+בספר)/i;
const STATUTE_IDENTITY_RE = /(חוק|תקנות|פקודת|חוק\s*יסוד|צו\s|statute|act\b|regulation)/i;

function hostOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

const OFFICIAL_HOST_RE =
  /(knesset\.gov\.il|reshumot\.gov\.il|justice\.gov\.il|court\.gov\.il|supreme\.court\.gov\.il|nevo\.co\.il|takdin\.co\.il|gov\.il)$/i;
const ACADEMIC_HOST_RE =
  /(ac\.il|\.edu$|jstor\.org$|ssrn\.com$|papers\.ssrn\.com$|academia\.edu$|researchgate\.net$|heinonline\.org$)/i;

function listLike(snippet: string): boolean {
  if (!snippet) return false;
  const bullets = (snippet.match(/(^|\n)\s*[-•*\d]+[.)]?\s/g) || []).length;
  const pipes = (snippet.match(/\s\|\s/g) || []).length;
  return (bullets >= 4 || pipes >= 4) && snippet.length < 900;
}

/** exact-source / exact-authority / exact docket / exact statute protection. */
function protectionFor(
  c: Candidate,
  integ: SourceIntegrity | null | undefined,
  cls: DiscoveryClass,
): string | null {
  const meta = (c.metadata ?? {}) as Record<string, unknown>;
  const url = c.source_url ?? "";
  const hay = `${c.title} ${url}`;

  if ((c.retrieval_method as string) === "exact_authority") return "exact_authority_candidate";
  if (meta.exact_source === true || meta.is_exact_source === true) return "exact_source_candidate";
  if (meta.fast_lane === true || meta.exact_docket_resolved === true) return "exact_docket_candidate";
  if (meta.body_acquired === true || meta.acquired_body === true) return "acquired_body";
  if (typeof meta.body_text === "string" && (meta.body_text as string).length >= 800) {
    return "acquired_body";
  }
  if (DOCKET_RE.test(hay)) return "exact_docket_identity";
  if (integ?.is_judgment_document) return "judgment_document";
  if (integ?.authority_tier === "official_primary" || integ?.authority_tier === "statute_mirror") {
    return "official_primary_page";
  }
  if (
    (c.role === "primary_statute" || c.role === "regulation") &&
    STATUTE_IDENTITY_RE.test(c.title) &&
    OFFICIAL_HOST_RE.test(hostOf(url))
  ) {
    return "official_statute_page";
  }
  if (BODY_PATH_RE.test(url) && ARTICLE_IDENTITY_RE.test(c.title)) {
    return "article_or_report_with_body_path";
  }
  // discovery_precision_stage2_blockers_v1 — local-corpus origin ALONE no
  // longer protects. A local document is protected only when its integrity
  // says it is substantive/citable (all body/identity protections above have
  // already been checked and did not fire).
  if (c.document_id) {
    const substantive = (cls === "citable_candidate" || cls === "possible_body_page") &&
      integ?.citable_as !== "not_citable";
    if (substantive) return "local_corpus_substantive";
  }

  return null;
}


export function classifyDiscoveryPrecision(input: DiscoveryInput): DiscoveryPrecision {
  const c = input.candidate;
  const integ = input.integrity ?? null;
  const url = c.source_url ?? "";
  const host = hostOf(url);
  let path = "";
  try {
    const u = new URL(url);
    path = `${u.pathname}${u.search}`;
  } catch {
    path = url;
  }
  const title = c.title ?? "";
  const snippet = c.snippet ?? "";
  const reasons: string[] = [];

  // ── listing / search / category signals ─────────────────────────────────
  const isSearch = SEARCH_PATH_RE.test(path) || /תוצאות\s*חיפוש|search results/i.test(title);
  const isCategory = CATEGORY_PATH_RE.test(path) || /^(קטגוריה|תגית|tag|category)\s*[:：]/i.test(title.trim());
  const isListingPath = LISTING_PATH_RE.test(path);
  const isListingTitle = HEB_LISTING_RE.test(title) || /^index of\b/i.test(title.trim());
  // Local corpus documents have no web URL; source-integrity defaults them to
  // "index_or_listing", which is not a discovery signal. Ignore it for them.
  const localCorpusDoc = !!c.document_id && !url;
  const integrityListing = !localCorpusDoc &&
    (integ?.authority_tier === "index_or_listing" || integ?.text_usability === "listing_page");
  const isListLike = listLike(snippet);

  if (isSearch) reasons.push("search_url_or_title");
  if (isCategory) reasons.push("category_or_tag_page");
  if (isListingPath) reasons.push("listing_url_path");
  if (isListingTitle) reasons.push("listing_title_pattern");
  if (integrityListing) reasons.push("integrity_index_or_listing");
  if (isListLike) reasons.push("list_like_snippet_structure");

  const hasBodyPath = BODY_PATH_RE.test(url);
  const thinSnippet = snippet.trim().length < 160;
  const metadataOnly = integ?.text_usability === "metadata_only" || (thinSnippet && !hasBodyPath);
  const notCitable = integ?.citable_as === "not_citable";

  // ── class ───────────────────────────────────────────────────────────────
  let discovery_class: DiscoveryClass;
  if (isSearch) discovery_class = "search_result_page";
  else if (isCategory) discovery_class = "category_page";
  else if (isListingPath || isListingTitle || integrityListing) discovery_class = "index_or_listing";
  else if (notCitable) discovery_class = "not_citable";
  else if (hasBodyPath || snippet.trim().length >= 600) discovery_class = "possible_body_page";
  else if (metadataOnly) discovery_class = "metadata_only";
  else discovery_class = "citable_candidate";

  if (discovery_class === "metadata_only") reasons.push("thin_or_metadata_only_body");
  if (discovery_class === "not_citable") reasons.push("integrity_not_citable");

  // ── protection ──────────────────────────────────────────────────────────
  const protection_reason = protectionFor(c, integ, discovery_class) ?? undefined;
  const isProtected = !!protection_reason;

  // ── suppression (conservative + explainable) ────────────────────────────
  const suppressibleClass = discovery_class === "index_or_listing" ||
    discovery_class === "search_result_page" ||
    discovery_class === "category_page";
  // metadata_only / not_citable are demoted only, unless they *also* carry a
  // clear listing/search/category signal (which puts them in a class above).
  const clearSignals = reasons.filter((r) =>
    r === "search_url_or_title" ||
    r === "category_or_tag_page" ||
    r === "listing_url_path" ||
    r === "listing_title_pattern" ||
    r === "integrity_index_or_listing"
  );
  const suppressible = suppressibleClass && !isProtected && clearSignals.length > 0;
  const not_suppressible_reason = suppressible
    ? undefined
    : isProtected
    ? `protected:${protection_reason}`
    : !suppressibleClass
    ? `class_not_suppressible:${discovery_class}`
    : "no_clear_listing_signal";
  const suppress = suppressible;
  const suppress_reason = suppress ? `${discovery_class}:${clearSignals.join("+")}` : undefined;


  // ── bounded ranking delta (applies within the existing retrieval tier) ──
  const rank_signals: string[] = [];
  let rank_delta = 0;
  const bump = (v: number, sig: string) => {
    rank_delta += v;
    rank_signals.push(sig);
  };

  if (discovery_class === "possible_body_page") bump(0.12, "body_or_pdf_path");
  if (ARTICLE_IDENTITY_RE.test(title)) bump(0.08, "article_or_report_identity");
  if (DOCKET_RE.test(`${title} ${url}`)) bump(0.1, "judgment_identity");
  if (STATUTE_IDENTITY_RE.test(title) && OFFICIAL_HOST_RE.test(host)) bump(0.1, "statute_identity");
  if (OFFICIAL_HOST_RE.test(host)) bump(0.06, "official_host");
  if (ACADEMIC_HOST_RE.test(host)) bump(0.06, "academic_host");
  if (host.endsWith(".il") || /\.gov\.il$|\.ac\.il$/.test(host)) bump(0.03, "jurisdiction_fit");

  if (discovery_class === "metadata_only") bump(-0.15, "metadata_only_demotion");
  if (discovery_class === "not_citable") bump(-0.25, "not_citable_demotion");
  if (isListLike && !suppress) bump(-0.08, "list_like_demotion");
  if (
    DOCTRINAL_INTENTS.has(String(input.task_intent ?? "")) &&
    (c.role === "persuasive_case_law") &&
    !ARTICLE_IDENTITY_RE.test(title)
  ) {
    bump(-0.12, "unrelated_case_law_in_doctrinal_mode");
  }

  // Cap the delta so it can reorder inside a tier but never outrank a real
  // authority on signal alone.
  rank_delta = Math.max(-0.3, Math.min(0.3, Number(rank_delta.toFixed(3))));

  return {
    discovery_class,
    reasons,
    protected: isProtected,
    protection_reason,
    suppressible,
    not_suppressible_reason,
    suppress,
    suppress_reason,
    rank_delta,
    rank_signals,
  };
}

export interface DiscoveryDiagnostics {
  /** Lifecycle: emitted even when the stage never ran (see `status`). */
  status: "not_started" | "started" | "completed";
  not_run_reason?: string;
  candidates_at_start: number;
  suppression_ran: boolean;
  backfill_ran: boolean;
  /** O(n) guard: candidates processed must equal candidates at start. */
  processed: number;
  o_n_guard_ok: boolean;
  classified: number;
  class_counts: Record<string, number>;
  suppressed: Array<{
    candidate_id: string;
    title: string;
    url: string | null;
    discovery_class: DiscoveryClass;
    reason: string;
  }>;
  suppressed_reason_counts: Record<string, number>;
  protected_counts: Record<string, number>;
  /** Why non-suppressible candidates were kept (protection / class / signal). */
  not_suppressible_reason_counts: Record<string, number>;
  /** Listing-class candidates that are protected, by protection reason. */
  protected_listing_counts: Record<string, number>;
  backfilled: number;
  backfilled_by_origin: Record<string, number>;
  /** All listing/index/search/category candidates ÷ pool before. */
  raw_index_or_listing_ratio: number;
  /** Only unprotected listing candidates ÷ pool before — the acceptance gate. */
  suppressible_index_or_listing_ratio: number;
  /** Unprotected listing candidates remaining in the final pool ÷ pool after. */
  final_suppressible_listing_ratio: number;
  /** Raw listing ratio in the final pool (diagnostic only). */
  final_raw_index_or_listing_ratio: number;
  pool_before: number;
  pool_after: number;
  ms: number;
}

export function emptyDiscoveryDiagnostics(): DiscoveryDiagnostics {
  return {
    status: "not_started",
    candidates_at_start: 0,
    suppression_ran: false,
    backfill_ran: false,
    processed: 0,
    o_n_guard_ok: true,
    classified: 0,
    class_counts: {},
    suppressed: [],
    suppressed_reason_counts: {},
    protected_counts: {},
    not_suppressible_reason_counts: {},
    protected_listing_counts: {},
    backfilled: 0,
    backfilled_by_origin: {},
    raw_index_or_listing_ratio: 0,
    suppressible_index_or_listing_ratio: 0,
    final_suppressible_listing_ratio: 0,
    final_raw_index_or_listing_ratio: 0,
    pool_before: 0,
    pool_after: 0,
    ms: 0,
  };
}


/** Diversity guard: no single origin may take more than 60% of freed slots. */
export function backfillOriginCap(freedSlots: number): number {
  return Math.max(1, Math.ceil(freedSlots * 0.6));
}
