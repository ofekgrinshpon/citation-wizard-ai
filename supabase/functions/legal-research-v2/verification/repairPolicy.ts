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
  context?: {
    question: string;
    issue_summary?: string;
    /** Answer mode only: activate the empty-core sufficiency assessment. */
    assess_empty_core_sufficiency?: boolean;
  },
): RepairDecision {
  const coreUnsupported = verification.pack.unsupported_claims.filter((c) => c.importance === "core");
  const survivingCore = verification.pack.claims.filter((c) => c.importance === "core");
  if (!coreUnsupported.length) {
    // The memo never put a core proposition on the table, verified or rejected.
    // Only then is the surviving pack measured against the central issue.
    const emptyCore = !survivingCore.length && !!context?.assess_empty_core_sufficiency &&
      !!context?.question;
    if (!emptyCore) return { repair: false, reason: "no_unsupported_core_claims" };
    const coverage = assessCentralIssueCoverage({
      question: context!.question,
      issue_summary: context!.issue_summary,
      pack: verification.pack,
      rejected: verification.rejected,
      assess_empty_core_sufficiency: true,
    });
    if (coverage.central_issue_covered) {
      return { repair: false, reason: "no_unsupported_core_claims", coverage };
    }
    return coverage.research_fixable
      ? { repair: true, reason: "central_issue_not_covered_after_narrowing", coverage }
      : { repair: false, reason: "central_gap_not_research_fixable", coverage };
  }
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

/**
 * Should a re-verified repaired memo replace the pre-repair one?
 *
 * For ordinary repairs the historic rule stands: the repair must not shrink the
 * verified pack. For a repair triggered by `central_issue_not_covered_after_
 * narrowing` that rule is actively wrong — the whole point was that the large
 * pack answered the wrong thing. There, the same deterministic coverage
 * mechanism is re-run on the repaired pack and acceptance follows coverage, not
 * counts. No model call, no minimum source/claim/citation/length requirement.
 */
export interface RepairAcceptance {
  accept: boolean;
  reason:
    | "coverage_restored"
    | "coverage_still_missing"
    | "verified_claims_not_reduced"
    | "verified_claims_reduced"
    | "verified_claims_produced"
    | "still_zero_verified_claims";
  coverage_after?: CoverageAssessment;
}

export function decideRepairAcceptance(input: {
  triggerReason: RepairDecision["reason"];
  before: VerificationOutcome;
  after: VerificationOutcome;
  question?: string;
  issue_summary?: string;
}): RepairAcceptance {
  if (input.triggerReason === "central_issue_not_covered_after_narrowing") {
    const coverage_after = assessCentralIssueCoverage({
      question: input.question ?? "",
      issue_summary: input.issue_summary,
      pack: input.after.pack,
      rejected: input.after.rejected,
      // A repaired pack that still contains no core proposition at all must not
      // be treated as covered by default.
      assess_empty_core_sufficiency: true,
    });
    return coverage_after.central_issue_covered
      ? { accept: true, reason: "coverage_restored", coverage_after }
      : { accept: false, reason: "coverage_still_missing", coverage_after };
  }
  // A repair triggered because NOTHING verified cannot be accepted while the
  // repaired pack still verifies nothing: 0 >= 0 is not an improvement, it is
  // the same empty terminal state. Exactly one verified claim is enough; no
  // higher minimum is introduced.
  if (input.triggerReason === "no_verified_claims") {
    return input.after.pack.claims.length >= 1
      ? { accept: true, reason: "verified_claims_produced" }
      : { accept: false, reason: "still_zero_verified_claims" };
  }
  return input.after.pack.claims.length >= input.before.pack.claims.length
    ? { accept: true, reason: "verified_claims_not_reduced" }
    : { accept: false, reason: "verified_claims_reduced" };
}
