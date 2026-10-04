import type { ResearchMemo, VerifiedEvidencePack } from "../types.ts";
import type { CoverageAssessment } from "./centralIssueCoverage.ts";

/** Completion of execution is separate from completeness of the requested answer. */
export function assessAnswerCompleteness(input: {
  memo: ResearchMemo | null;
  pack: VerifiedEvidencePack;
  coverage?: CoverageAssessment;
  reflectionCompleted: boolean;
  hasCitedAnswer: boolean;
  answerGaps: boolean;
}): {
  research_complete: boolean | null;
  completeness_status: "complete" | "partial" | "unknown" | "insufficient";
  central_issue_covered: boolean | null;
} {
  const declared = typeof input.memo?.research_complete === "boolean"
    ? input.memo.research_complete : null;
  // The narrowing check is not a general semantic completeness certificate.
  const central = !input.pack.claims.length ? false
    : input.coverage?.assessed ? input.coverage.central_issue_covered : null;
  const partial = input.answerGaps || declared === false || central === false ||
    !!input.memo?.unresolved_questions?.length ||
    input.pack.unsupported_claims.some((c) => c.importance === "core");
  return {
    research_complete: declared,
    completeness_status: !input.pack.claims.length || !input.hasCitedAnswer ? "insufficient"
      : partial ? "partial"
      : declared === true && input.reflectionCompleted ? "complete" : "unknown",
    central_issue_covered: central,
  };
}

export const PARTIAL_ANSWER_NOTICE =
  "תשובה חלקית: המחקר לא ביסס את כל הממדים שהתבקשו. הממצאים המאומתים מובאים להלן; הפערים שצוינו אינם מסקנות משפטיות.";
