/**
 * legal-research-v2 — "did the surviving verified pack still answer the
 * question?" (v2_central_issue_coverage_v1)
 *
 * Verification strictness is untouched. This module only measures, purely
 * deterministically and with information already present in the run, whether
 * narrowing the memo down to what verified has removed the proposition the
 * user actually came for.
 *
 * It is NOT a length / claim-count / source-count / citation-count heuristic:
 * the only signal used is substantive lexical coverage of the central issue
 * (the user question + the agent's own issue_summary) by the surviving
 * verified propositions, compared against what the rejected core propositions
 * would have contributed.
 *
 * No model call. No doctrine knowledge. No minimum counts.
 */

import type { RejectedPair, VerifiedEvidencePack } from "../types.ts";

/** Function words carry no subject matter; they must never drive a repair. */
const STOPWORDS = new Set([
  "של","על","עם","אל","את","כי","אם","או","גם","רק","כל","לא","אין","יש","זה","זו","זאת","הוא","היא","הם","הן",
  "אשר","כאשר","לפי","בין","מן","עד","אחרי","לפני","תחת","מתי","האם","מה","מהי","מהו","מיהו","איך","כיצד","למה",
  "מדוע","תסביר","הסבר","הסברי","נא","בבקשה","אנא","אודות","לגבי","בנוגע","שאלה","תשובה","סוגיה","סוגיית","עניין",
  "במקרה","כללי","באופן","יותר","פחות","אחד","אחת","שני","שתי","וכן","אבל","אולם","לכן","מכאן","אפשר","ניתן",
  "the","and","for","with","that","this","what","how","why","about","does","are","was","were","from","into","please",
]);

/** Hebrew one-letter clitics that hide the same content word behind a prefix. */
function normalize(word: string): string {
  let w = word.replace(/[".,;:()[\]{}"'׳״!?–—\-]/g, "");
  if (w.length > 4 && /^[והבלמכש]/.test(w)) w = w.slice(1);
  return w;
}

export function contentTerms(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of String(text ?? "").split(/\s+/)) {
    const w = normalize(raw);
    if (w.length < 3) continue;
    if (STOPWORDS.has(w)) continue;
    if (/^\d+$/.test(w)) continue;
    out.add(w);
  }
  return out;
}

function intersect(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((t) => b.has(t));
}

/** Rejections that additional research cannot plausibly repair. */
const NOT_RESEARCH_FIXABLE = new Set(["support_does_not_support", "span_too_short"]);

export interface CoverageAssessment {
  assessed: boolean;
  central_issue_covered: boolean;
  coverage_ratio: number;
  /** Central-issue terms that only the rejected core propositions carried. */
  lost_central_terms: string[];
  surviving_core_claim_ids: string[];
  unsupported_core_claim_ids: string[];
  research_fixable: boolean;
}

/**
 * Coverage is judged "lost" only when BOTH hold:
 *   1. a core proposition was dropped and it carried central-issue subject
 *      matter that NO surviving verified proposition also carries
 *      (so redundant / alternative formulations never trigger repair), and
 *   2. the surviving pack covers less than `MIN_COVERAGE` of the central issue.
 */
const MIN_COVERAGE = 0.6;

export function assessCentralIssueCoverage(input: {
  question: string;
  issue_summary?: string;
  pack: VerifiedEvidencePack;
  rejected: RejectedPair[];
}): CoverageAssessment {
  const unsupportedCore = input.pack.unsupported_claims.filter((c) => c.importance === "core");
  const survivingCore = input.pack.claims.filter((c) => c.importance === "core");
  const base: CoverageAssessment = {
    assessed: true,
    central_issue_covered: true,
    coverage_ratio: 1,
    lost_central_terms: [],
    surviving_core_claim_ids: survivingCore.map((c) => c.claim_id),
    unsupported_core_claim_ids: unsupportedCore.map((c) => c.claim_id),
    research_fixable: false,
  };
  if (!unsupportedCore.length) return base;

  const central = contentTerms(`${input.question ?? ""} ${input.issue_summary ?? ""}`);
  if (!central.size) return base;

  const survived = contentTerms(input.pack.claims.map((c) => c.proposition).join(" "));
  const dropped = contentTerms(unsupportedCore.map((c) => c.proposition).join(" "));

  const covered = intersect(central, survived);
  const ratio = covered.length / central.size;
  const lost = intersect(central, dropped).filter((t) => !survived.has(t));

  const ids = new Set(unsupportedCore.map((c) => c.claim_id));
  const relevant = input.rejected.filter((r) => ids.has(r.claim_id));
  const research_fixable = !relevant.length ||
    relevant.some((r) => !NOT_RESEARCH_FIXABLE.has(r.reason));

  return {
    ...base,
    central_issue_covered: !(lost.length > 0 && ratio < MIN_COVERAGE),
    coverage_ratio: Number(ratio.toFixed(3)),
    lost_central_terms: lost,
    research_fixable,
  };
}
