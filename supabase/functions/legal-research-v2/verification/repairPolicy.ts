/**
 * legal-research-v2 — when a verification rejection actually justifies
 * reopening research.
 *
 * Verification strictness is untouched: a rejected pair stays rejected and an
 * unsupported claim stays unsupported. The only question answered here is
 * whether ANOTHER research cycle could plausibly change the outcome.
 *
 *   • rejected because a body is missing / unreadable / the wrong document
 *       → more research can help                          → repair
 *   • rejected because the quoted span or the support failed on bodies that
 *     were read successfully
 *       → the memo can simply be narrowed to what verified → no repair
 */

import type { VerificationOutcome } from "../types.ts";
import { assessCentralIssueCoverage, type CoverageAssessment } from "./centralIssueCoverage.ts";

/** Rejection reasons that describe an acquisition gap rather than a drafting gap. */
const ACQUISITION_REASONS = new Set([
  "unknown_source_id",
  "fetch_failed",
  "empty_body",
  "not_actual_document",
  "identity_mismatch",
  "verifier_unavailable",
]);

export interface RepairDecision {
  repair: boolean;
  reason:
    | "no_unsupported_core_claims"
    | "no_verified_claims"
    | "unreadable_or_missing_body"
    | "central_issue_not_covered_after_narrowing"
    | "central_gap_not_research_fixable"
    | "narrowable_to_verified_propositions";
  /** Present whenever the coverage assessment actually ran. */
  coverage?: CoverageAssessment;
}

/**
 * `context` is optional so existing call sites keep their exact semantics.
 * When the user question is supplied, one extra conservative exception is
 * available: narrowing away an unsupported core claim is NOT acceptable if the
 * surviving verified propositions no longer cover the central issue.
 */
export function decideResearchRepair(
  verification: VerificationOutcome,
  context?: { question: string; issue_summary?: string },
): RepairDecision {
  const coreUnsupported = verification.pack.unsupported_claims.filter((c) => c.importance === "core");
  if (!coreUnsupported.length) return { repair: false, reason: "no_unsupported_core_claims" };
  // Nothing verified at all: the answer would be empty, so research must reopen.
  if (!verification.pack.claims.length) return { repair: true, reason: "no_verified_claims" };

  const ids = new Set(coreUnsupported.map((c) => c.claim_id));
  const rejected = verification.rejected.filter((r) => ids.has(r.claim_id));
  const acquisitionGap = rejected.some((r) => ACQUISITION_REASONS.has(r.reason));

  const coverage = context?.question
    ? assessCentralIssueCoverage({
      question: context.question,
      issue_summary: context.issue_summary,
      pack: verification.pack,
      rejected: verification.rejected,
    })
    : undefined;

  if (acquisitionGap) return { repair: true, reason: "unreadable_or_missing_body", coverage };

  if (coverage && !coverage.central_issue_covered) {
    return coverage.research_fixable
      ? { repair: true, reason: "central_issue_not_covered_after_narrowing", coverage }
      : { repair: false, reason: "central_gap_not_research_fixable", coverage };
  }

  return { repair: false, reason: "narrowable_to_verified_propositions", coverage };
}
