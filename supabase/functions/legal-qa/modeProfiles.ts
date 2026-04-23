// Mode profiles for the Legal Research pipeline.
//
// Fast vs Deep is a configuration toggle, NOT a code branch. Every per-mode
// difference lives here; index.ts reads from the resolved `ModeProfile`
// instead of using hardcoded knobs. A new mode = a new entry in MODE_PROFILES.
//
// IMPORTANT: This file is referenced by `legal-qa/index.ts` only. The frontend
// passes `depth: "fast" | "deep"` in the request body; the contract field is
// already documented in mem://tech/request-contract/legal-qa.

export type ResearchDepth = "fast" | "deep";

export interface ModeProfile {
  // ─── Drafting envelope (read by buildCompactStructuredPrompt) ───
  /** Soft target lower bound for body word count. */
  wordRangeMin: number;
  /** Soft target upper bound for body word count. */
  wordRangeMax: number;
  /** Minimum anchored footnotes the drafter should aim for. */
  footnoteFloor: number;
  /** Soft cap on anchored footnotes (drafter shaping only — no hard reject). */
  footnoteTargetMax: number;

  // ─── Retrieval ───
  /** When 2, runs a second retrieval pass scoped to claim-map gaps (Deep only). */
  retrievalRounds: 1 | 2;

  // ─── Stage E.5 (Perplexity completion) ───
  /** Stage E.5 fires when core source-pack count < this number. */
  perplexityCompletionMinAnchored: number;

  // ─── Anchor pass ───
  /** Run the post-draft anchor pass to inject extra footnotes. */
  anchorPassEnabled: boolean;

  // ─── Models / drafter ───
  /** Drafter variant: "structured" → gpt-5-mini (fast), "legacy" → gpt-5 (deep). */
  drafterVariant: "structured" | "legacy";
  /** Drafter HTTP timeout. Deep allows the heavier model more headroom. */
  drafterTimeoutMs: number;

  // ─── Billing ───
  // Held here for future use. The credit charge in index.ts currently uses
  // a flat `creditCost` constant; once Deep ships behind the toggle we'll
  // switch the charge to `profile.creditCost`. For now both modes cost the
  // same so the toggle is a quality control, not a billing decision.
  creditCost: number;
}

export const MODE_PROFILES: Record<ResearchDepth, ModeProfile> = {
  fast: {
    wordRangeMin: 400,
    wordRangeMax: 700,
    footnoteFloor: 2,
    footnoteTargetMax: 6,
    retrievalRounds: 1,
    perplexityCompletionMinAnchored: 2,
    anchorPassEnabled: false, // Fast = structured path skips anchor pass (v7.6)
    drafterVariant: "structured",
    drafterTimeoutMs: 120000,
    creditCost: 5,
  },
  deep: {
    wordRangeMin: 1200,
    wordRangeMax: 2000,
    footnoteFloor: 8,
    footnoteTargetMax: 14,
    retrievalRounds: 2,
    perplexityCompletionMinAnchored: 6,
    anchorPassEnabled: true,
    drafterVariant: "legacy", // gpt-5 instead of gpt-5-mini
    drafterTimeoutMs: 180000,
    creditCost: 5, // No multiplier yet — will be revisited once production cost is known.
  },
};

/** Resolve `depth` from request body to a profile. Defaults to Fast. */
export function resolveModeProfile(depth: unknown): { depth: ResearchDepth; profile: ModeProfile } {
  const d: ResearchDepth = depth === "deep" ? "deep" : "fast";
  return { depth: d, profile: MODE_PROFILES[d] };
}
