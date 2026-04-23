// Centralized model routing for the Legal Research pipeline.
// One place to swap providers/models for each stage.

export const LEGAL_RESEARCH_MODELS = {
  decomposition: {
    // Tier-2 tuning (pilot v3): gpt-5-nano showed ~50% parse_error rate on this
    // schema and the nano→mini retry didn't help end-to-end. Promote mini to
    // primary; reliability matters more than the latency saving.
    primary: "openai/gpt-5-mini",
    fallback: "google/gemini-2.5-flash",
  },
  claimMap: {
    // Tier-1.5 tuning: kept on gpt-5-mini. Claim mapping requires synthesizing
    // 4-12 anchored claims from a 10-source pack — heavier reasoning than nano.
    primary: "openai/gpt-5-mini",
    fallback: "google/gemini-2.5-flash",
  },
  drafting: {
    // Legacy/fallback drafter (no claim map): heavier reasoning needed because
    // the model is doing both legal analysis and prose. Used by pleading_analysis,
    // academic mode, and structured-with-no-claim-map paths.
    primary: "openai/gpt-5",
    fallback: "google/gemini-2.5-flash",
  },
  structuredDrafting: {
    // Structured drafter (with claim map): the heavy reasoning has already
    // happened in decomposition + claim_map. The drafter's job is anchored
    // assembly + Hebrew prose, which gpt-5-mini handles in ~40-60s vs.
    // gpt-5's 90s+ (which timed out on every pilot v4 call). This is the
    // single biggest latency win in the v5 pass.
    primary: "openai/gpt-5-mini",
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
