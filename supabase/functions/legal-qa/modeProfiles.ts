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
  /**
   * Cap on patches the anchor pass may apply per response. Fast keeps a
   * tighter cap to bound latency; Deep allows the larger envelope.
   * Replaces the previously hardcoded `>= 4` cap inside anchorPass.ts.
   */
  anchorPassMaxPatches: number;

  // ─── QA guard ───
  /**
   * Threshold at which the `excessive_trigger` QA flag fires for Stage 5e.
   * Fast: 5 (Stage 5e is a tight fallback). Deep: 8 (richer source pack and
   * larger answer envelope mean more legitimate completions are expected).
   * Read by the qa_guard block in index.ts.
   */
  qaGuardExcessiveTriggerThreshold: number;

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

  // ─── Phase C — research-mode Stage 2 party-lookup retry ───
  /**
   * Enable Stage 2 Perplexity party-lookup retry on caselaw footnotes
   * flagged `needs_party_lookup` by the research-mode legal resolver.
   * Off by default for Fast (latency-sensitive); on for Deep.
   * When false, the research-engine block stays in Phase B behaviour
   * (canonical re-emission only).
   */
  partyLookupRetryEnabled: boolean;

  /**
   * When the Stage 2 retry succeeds but the resolver could only emit a
   * citation with `[חסר: ...]` placeholders, whether to keep the partial
   * citation (`emit`) or discard it (`drop`). Mirrors the chapter
   * best-effort policy — partial caselaw is more useful than none.
   */
  partyLookupPlaceholderPolicy: "emit" | "drop";

  /**
   * Hard ceiling on dockets batched into a single `lookupPartyNames`
   * call per request. Bounds latency for caselaw-heavy questions.
   * Excess pending entries fall back to honest `needs_party_lookup`
   * telemetry under `failure_reasons.skipped_over_batch_cap`.
   */
  partyLookupMaxBatchSize: number;

  // ─── Phase 1 (research safeguards) — Legal Issue Router ───
  /**
   * When true, run `legalIssueRouter` BEFORE decomposition and bias the
   * decomposition prompt with the route. Bounded by a 12s wall-clock
   * timeout (`raceWithTimeout`) so a slow router never starves decomposition.
   * On timeout, decomposition runs unbiased (legacy behaviour).
   */
  legalIssueRouter: boolean;
}

export const MODE_PROFILES: Record<ResearchDepth, ModeProfile> = {
  fast: {
    // ─── LOCKED DEFAULT (validated 2026-04) ──────────────────────────────
    // Confirmed Fast grounding architecture after multiple eval batches:
    //   • Anchor pass = PRIMARY claim-to-source grounding path.
    //   • Stage 5e (statute completion) = FALLBACK only, gated by source-pack
    //     coverage and anchor-marker proximity (±240 chars).
    //   • All Stage 5e markers placed at SENTENCE END, never name-adjacent.
    // Regressions in these invariants are surfaced as `qa_guard.flags` in
    // qa_logs.metadata.statute_completion (see index.ts).
    // Do NOT change anchorPassEnabled / anchorPassMaxPatches / the Stage 5e
    // gating in index.ts without a fresh eval batch.
    wordRangeMin: 400,
    wordRangeMax: 700,
    footnoteFloor: 2,
    footnoteTargetMax: 6,
    retrievalRounds: 1,
    perplexityCompletionMinAnchored: 2,
    anchorPassEnabled: true,
    anchorPassMaxPatches: 2,
    qaGuardExcessiveTriggerThreshold: 5,
    drafterVariant: "structured",
    drafterTimeoutMs: 120000,
    creditCost: 5,
    // Phase C: Fast Stage 2 retry — LOCKED ON 2026-04-26.
    // Initial Fast-on probe (phase-c-fast-on-0e91a9a7, 2026-04-25) failed
    // 6× with `no_candidates` because cards stored bare `case_number`
    // without `בג"ץ`/`ע"א` prefix. Fix C (2026-04-26) now stores prefixed
    // dockets in `card.case_number`, passes `card.docket_prefix` as the
    // `caseTypeHint` priority-1 to the resolver, and partyLookup prepends
    // the prefix to the docket line in the Perplexity prompt.
    // Re-probe (phase-c-fast-on-2973bd49) results across Q1+Q6 × 2:
    //   • attempted=4, recovered=3, failed=1 (no_match)
    //   • survival: 3/3 recovered citations appear in final response.footnotes
    //     with real party names + dates (e.g. `בג"ץ 2592/20 בן שושן
    //     נ' יועמ"ש לממשלה (פורסם ב, 28.5.2025)`).
    //   • wall-time median 42.5s — well within the "few seconds" gate.
    // Stage 2 cost: ~3s per request when triggered.
    partyLookupRetryEnabled: true,
    partyLookupPlaceholderPolicy: "emit",
    partyLookupMaxBatchSize: 3,
    legalIssueRouter: true,
  },
  deep: {
    // ─── DEEP (post-2026-04 partial revert) ──────────────────────────────
    // Deep shares the same primary grounding architecture as Fast (anchor
    // pass = primary, Stage 5e = fallback) and keeps the mode-aware QA
    // guard. The two drafting-envelope softening changes attempted in the
    // 2026-04 batch were REVERTED because the eval did not validate them:
    //   • perplexityCompletionMinAnchored stays at 6 (the 4 attempt did
    //     not produce a clear shrink in Stage 5e work and Q6 anchored
    //     coverage regressed 5→3).
    //   • The Deep footnoteFloorBlock in index.ts stays as a hard floor
    //     ("רצפה קשיחה"), not the soft "טיב לפני כמות" target that Fast
    //     uses — Deep's product promise is a richer envelope.
    // What we KEPT from the batch:
    //   • qaGuardExcessiveTriggerThreshold = 8 (vs Fast's 5) — pure
    //     observability win, correctly identified Q21 as a list-heavy
    //     question rather than a regression.
    wordRangeMin: 1200,
    wordRangeMax: 2000,
    footnoteFloor: 8,
    footnoteTargetMax: 14,
    retrievalRounds: 2,
    perplexityCompletionMinAnchored: 6,
    anchorPassEnabled: true,
    anchorPassMaxPatches: 4,
    qaGuardExcessiveTriggerThreshold: 8,
    drafterVariant: "legacy", // gpt-5 instead of gpt-5-mini
    drafterTimeoutMs: 180000,
    creditCost: 5, // No multiplier yet — will be revisited once production cost is known.
    // Phase C: Deep is the default-on mode for Stage 2 retry. Deep already
    // takes longer (legacy gpt-5 + retrievalRounds=2) so the marginal
    // Perplexity round-trip is acceptable, and Deep's product promise is
    // richer caselaw coverage. Placeholder policy mirrors the chapter
    // default — partial caselaw is more useful than none, and the final
    // `placeholder_dominant` filter still gates anything genuinely empty.
    partyLookupRetryEnabled: true,
    partyLookupPlaceholderPolicy: "emit",
    partyLookupMaxBatchSize: 6,
    legalIssueRouter: true,
  },
};

/** Resolve `depth` from request body to a profile. Defaults to Fast. */
export function resolveModeProfile(depth: unknown): { depth: ResearchDepth; profile: ModeProfile } {
  const d: ResearchDepth = depth === "deep" ? "deep" : "fast";
  return { depth: d, profile: MODE_PROFILES[d] };
}
