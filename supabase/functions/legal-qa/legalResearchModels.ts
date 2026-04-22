// Centralized model routing for the Legal Research pipeline.
// One place to swap providers/models for each stage.

export const LEGAL_RESEARCH_MODELS = {
  decomposition: {
    primary: "openai/gpt-5-mini",
    fallback: "google/gemini-2.5-flash-lite",
  },
  claimMap: {
    primary: "openai/gpt-5-mini",
    fallback: "google/gemini-2.5-flash",
  },
  drafting: {
    primary: "openai/gpt-5",
    fallback: "google/gemini-2.5-flash",
  },
} as const;

export type LegalResearchStage = keyof typeof LEGAL_RESEARCH_MODELS;

/**
 * Returns the active model name for a stage, choosing primary if OpenAI is
 * available and fallback otherwise. Used for diagnostic logging.
 */
export function getActiveModel(
  stage: LegalResearchStage,
  hasOpenAI: boolean,
): { provider: "openai" | "gemini"; model: string } {
  const cfg = LEGAL_RESEARCH_MODELS[stage];
  if (hasOpenAI && cfg.primary.startsWith("openai/")) {
    return { provider: "openai", model: cfg.primary };
  }
  return { provider: "gemini", model: cfg.fallback };
}
