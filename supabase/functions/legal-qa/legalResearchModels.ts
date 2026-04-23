// Centralized model routing for the Legal Research pipeline.
// One place to swap providers/models for each stage.

export const LEGAL_RESEARCH_MODELS = {
  decomposition: {
    // Pilot v7 (Fast-mode feasibility): pinned to Gemini 2.5 Flash, mirroring
    // the v6 claim_map migration. gpt-5-mini consistently took ~25s on this
    // tool-call schema; Flash returns the same JSON shape in ~6-10s, freeing
    // ~15s of the edge-function budget. Decomposition is structured planning
    // on a small JSON schema — well within Flash's strengths. Revert is a
    // one-line flip back to "openai/gpt-5-mini" if parse_error rate >10%.
    primary: "google/gemini-2.5-flash",
    fallback: "openai/gpt-5-mini",
    forceProvider: "gemini",
  },
  claimMap: {
    // Pilot v7.5 (revert): claim_map back on Gemini Flash for Fast mode.
    // v7.4 pinned this stage to OpenAI gpt-5-mini for determinism (seed=7),
    // but the cost was unacceptable for Fast: claim_map alone took ~30-45s
    // and the 9-shot test showed Q1 hitting the 45s ceiling with 3/3 silent
    // legacy fallbacks (worse than v7.3). Gemini's seed-ignoring variance is
    // the lesser evil at the Fast tier; OpenAI claim_map is preserved as a
    // candidate for a future Deep / high-confidence mode (separate timeout
    // budget, not part of the Fast 3-stage flow). To re-enable for Deep,
    // pass `forceProvider: "openai"` from decomposition.ts based on a
    // request-level `depth: "deep"` flag.
    primary: "google/gemini-2.5-flash",
    fallback: "openai/gpt-5-mini",
    forceProvider: "gemini",
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
 * Returns the active model name for a stage. Honors `forceProvider` (Gemini-only
 * stages like decomposition v7 and claim_map v6), then prefers OpenAI when its
 * key is available and the primary is OpenAI-routed; otherwise picks Gemini.
 * Used for diagnostic logging only.
 */
export function getActiveModel(
  stage: LegalResearchStage,
  hasOpenAI: boolean,
): { provider: "openai" | "gemini"; model: string } {
  const cfg = LEGAL_RESEARCH_MODELS[stage] as { primary: string; fallback: string; forceProvider?: "openai" | "gemini" };
  const forced = cfg.forceProvider;
  const pickGemini = () => {
    const m = cfg.primary.startsWith("google/") ? cfg.primary : cfg.fallback;
    return { provider: "gemini" as const, model: m };
  };
  const pickOpenAI = () => {
    const m = cfg.primary.startsWith("openai/") ? cfg.primary.replace(/^openai\//, "") : cfg.fallback.replace(/^openai\//, "");
    return { provider: "openai" as const, model: m };
  };
  if (forced === "gemini") return pickGemini();
  if (forced === "openai" && hasOpenAI) return pickOpenAI();
  if (hasOpenAI && cfg.primary.startsWith("openai/")) return pickOpenAI();
  return pickGemini();
}
