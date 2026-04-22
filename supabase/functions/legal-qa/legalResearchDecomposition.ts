// Wrapper around `decomposeAndPlan` that maps the snake_case tool output
// to the camelCase internal contract `LegalResearchDecomposition`.
// The underlying tool schema is intentionally kept in snake_case to maximize
// LLM-side compliance — only the boundary is normalized here.

import type { Decomposition, DecomposedPlan } from "./decomposition.ts";
import type {
  LegalResearchDecomposition,
  LegalQuestionType,
} from "./contracts.ts";

const QUESTION_TYPE_MAP: Record<Decomposition["question_type"], LegalQuestionType> = {
  doctrinal: "interpretive",
  procedural: "applied",
  factual_legal: "applied",
  comparative: "comparative",
  policy: "current_status",
  mixed: "mixed",
};

const CURRENT_SOURCES_REGEX = /\b(כיום|נכון לעכשיו|נכון להיום|השנה|לאחרונה|בימים אלה|עדכני)\b/;

/**
 * Maps the raw tool output (snake_case) to the formal contract (camelCase).
 * Adds heuristics for `requiresCurrentSources` and `userDocumentsRelevant`.
 */
export function mapToDecompositionV2(
  plan: DecomposedPlan,
  hasUserDocument: boolean,
  question: string,
): LegalResearchDecomposition {
  const d = plan.decomposition;
  return {
    mainIssue: d.main_issue,
    subIssues: Array.isArray(d.sub_issues) ? d.sub_issues : [],
    questionType: QUESTION_TYPE_MAP[d.question_type] ?? "mixed",
    jurisdiction: "israel",
    requiresLegislation: !!d.requires_legislation,
    requiresCaselaw: !!d.requires_caselaw,
    requiresSecondarySources: !!d.requires_secondary_sources,
    requiresCurrentSources: CURRENT_SOURCES_REGEX.test(question),
    userDocumentsRelevant: hasUserDocument,
  };
}
