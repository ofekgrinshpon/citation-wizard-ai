// Pre-acquisition judgment candidate ranking.
//
// Scope: discovery / candidate selection only. This module does NOT fetch
// anything, does not change sufficiency, the drafter, or model routing. It
// answers one question deterministically: *given the pool we already have,
// which judgment candidates deserve the acquisition budget first?*
//
// Hard rules:
// - no doctrine dictionaries, no landmark case names, no hardcoded holdings;
// - purely structural signals (URL shape, document type, docket/title
//   patterns, verifier verdict, planner role, integrity classification).

import type { Candidate } from "../lib/types.ts";
import type { SourceIntegrity } from "./sourceIntegrity.ts";
import type { DocketRef } from "./docketDetection.ts";

export interface RankSignal {
  id: string;
  weight: number;
}

export interface JudgmentRank {
  candidate_id: string;
  title: string;
  url: string | null;
  rank: number;
  score: number;
  positive_signals: string[];
  negative_signals: string[];
  rank_reason: string;
  is_official_judgment_document: boolean;
  is_institutional_or_listing: boolean;
}

export interface RankInput {
  candidate: Candidate;
  integrity: SourceIntegrity | undefined;
  dockets: DocketRef[];
  synthesis_role: string;
  /** Exact docket asked for in the question. */
  is_requested_docket: boolean;
  /** Verifier verdict when already available (`direct` | `partial` | …). */
  verdict?: string | null;
  /** Does the candidate's legal domain match the question's? */
  domain_match?: boolean;
}

// ─── Structural signal patterns ─────────────────────────────────────────────

const OFFICIAL_COURT_HOST_RE = /(supremedecisions\.court\.gov\.il|elyon\d*\.court\.gov\.il|court\.gov\.il)/i;
const DOWNLOAD_ENDPOINT_RE = /(\/Home\/Download\?|[?&]path=|[?&]fileName=|[?&]download=)/i;
const JUDGMENT_FILE_RE = /\.(pdf|docx?|rtf|txt)(\?|#|$)/i;
const CASE_TITLE_RE = /\S+\s+(נ'|נ׳|נגד)\s+\S+/;
const INSTITUTIONAL_RE =
  /(\/Pages\/(Overview|About|Default|Home|Contact|Search|Info)\b|\/about\b|\/overview\b|\/HomePage|\/Units\/|\/Pages\/default\.aspx|\/spokesperson|\/departments?\/|\/he\/departments)/i;
const LISTING_RE =
  /(PadiArchive|SearchResults?|\/search\b|[?&]page=\d+|[?&]skip=\d+|\/archive\b|\/index\b|\/tags?\/|\/category\/|verdicts?list|psakim\/?$)/i;
const HELP_OVERVIEW_RE = /(\/help\b|\/faq\b|שאלות\s+נפוצות|אודות|מדריך|עמוד\s+הבית)/i;
const COMMENTARY_RE = /(מאמר|בלוג|blog|article|news|עורך[- ]?דין|משרד\s+עורכי)/i;

const LEADING_ROLES = new Set([
  "leading_candidate",
  "applying_candidate",
  "limiting_or_distinguishing_candidate",
]);

function isRootPage(url: string): boolean {
  try {
    const u = new URL(url);
    return u.pathname === "/" || u.pathname === "" || /^\/(he|en)\/?$/i.test(u.pathname);
  } catch {
    return false;
  }
}

export function isOfficialJudgmentDocument(url: string | null | undefined): boolean {
  const u = String(url ?? "");
  if (!u) return false;
  const isDoc = JUDGMENT_FILE_RE.test(u) || DOWNLOAD_ENDPOINT_RE.test(u);
  return isDoc && OFFICIAL_COURT_HOST_RE.test(u);
}

// ─── Scoring ────────────────────────────────────────────────────────────────

export function scoreJudgmentCandidate(input: RankInput): {
  score: number;
  positive: string[];
  negative: string[];
  official_document: boolean;
  institutional_or_listing: boolean;
} {
  const c = input.candidate;
  const url = c.source_url ?? "";
  const integ = input.integrity;
  const positive: string[] = [];
  const negative: string[] = [];
  let score = 0;

  const add = (cond: boolean, id: string, w: number, bucket: string[]) => {
    if (!cond) return;
    bucket.push(id);
    score += w;
  };

  const isDocFile = JUDGMENT_FILE_RE.test(url) || DOWNLOAD_ENDPOINT_RE.test(url);
  const officialHost = OFFICIAL_COURT_HOST_RE.test(url);
  const officialDoc = isDocFile && officialHost;

  // Positive signals (spec order).
  add(officialHost && (isDocFile || /supremedecisions/i.test(url)), "official_court_download_url", 40, positive);
  add(isDocFile, "direct_judgment_document", 30, positive);
  add(input.dockets.length > 0, "docket_signal", 25, positive);
  add(input.is_requested_docket, "exact_requested_docket", 60, positive);
  add(CASE_TITLE_RE.test(c.title ?? ""), "case_title_pattern", 15, positive);
  add(input.verdict === "direct", "verifier_direct", 20, positive);
  add(LEADING_ROLES.has(input.synthesis_role), "planner_judgment_role", 12, positive);
  add(input.synthesis_role === "leading_candidate", "planner_leading_role", 10, positive);
  add(input.domain_match === true, "legal_domain_match", 8, positive);
  add(
    integ?.citable_as === "judgment" || integ?.is_judgment_document === true,
    "integrity_judgment_document",
    18,
    positive,
  );

  // Negative signals.
  const institutional = !isDocFile && (INSTITUTIONAL_RE.test(url) || isRootPage(url));
  const listing = !isDocFile && LISTING_RE.test(url);
  add(institutional, "institutional_or_root_page", -60, negative);
  add(listing, "listing_or_index_page", -50, negative);
  add(!isDocFile && HELP_OVERVIEW_RE.test(`${url} ${c.title ?? ""}`), "overview_or_help_page", -30, negative);
  add(input.dockets.length === 0 && !CASE_TITLE_RE.test(c.title ?? ""), "no_docket_or_title_signal", -35, negative);
  add(
    integ?.authority_tier === "index_or_listing" || integ?.citable_as === "not_citable",
    "integrity_listing_or_not_citable",
    -55,
    negative,
  );
  add(
    (integ?.citable_as === "scholarship" || integ?.citable_as === "commentary" ||
      COMMENTARY_RE.test(`${url} ${c.title ?? ""}`)) && !isDocFile,
    "commentary_with_case_mention_only",
    -25,
    negative,
  );
  add(input.verdict === "tangential", "verifier_tangential", -20, negative);
  add(input.verdict === "unrelated", "verifier_unrelated", -40, negative);

  return {
    score,
    positive,
    negative,
    official_document: officialDoc,
    institutional_or_listing: institutional || listing,
  };
}

/**
 * Rank judgment candidates before any acquisition budget is spent.
 * Highest score first; ties broken by the retrieval score.
 */
export function rankJudgmentCandidates(inputs: RankInput[]): JudgmentRank[] {
  const scored = inputs.map((i) => {
    const s = scoreJudgmentCandidate(i);
    return { i, s };
  });
  scored.sort((a, b) => b.s.score - a.s.score || b.i.candidate.score - a.i.candidate.score);
  return scored.map(({ i, s }, idx) => ({
    candidate_id: i.candidate.candidate_id,
    title: i.candidate.title,
    url: i.candidate.source_url ?? null,
    rank: idx + 1,
    score: s.score,
    positive_signals: s.positive,
    negative_signals: s.negative,
    rank_reason: [
      s.positive.length ? `+${s.positive.join(",")}` : "",
      s.negative.length ? `-${s.negative.join(",")}` : "",
    ].filter(Boolean).join(" | ") || "no_signals",
    is_official_judgment_document: s.official_document,
    is_institutional_or_listing: s.institutional_or_listing,
  }));
}
