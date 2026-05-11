// Academic Writing profiles.
//
// Mirrors the modeProfiles.ts pattern: every per-academic-step knob lives here
// as a typed field, not as a hardcoded constant inside index.ts. This makes
// changes to chapter envelopes, abstract caps, context windows, or QA-guard
// thresholds visible in one file and auto-loggable via metadata.profile_used_academic.
//
// Academic mode = a state machine over four sub-modes (`academicStep`):
//   topics            → suggest_topics      (free, light path)
//   validate          → validate_question   (free, light path)
//   outline           → propose_outline     (free, light path)
//   abstract          → write_chapter + isAbstract=true   (8 credits, synthesis-only)
//   chapter           → write_chapter (real chapter)      (8 credits, full Deep pipeline)
//
// IMPORTANT: chapters explicitly inherit the Deep `MODE_PROFILES.deep` profile —
// `inheritsFrom: "deep"` is documentation, not magic. The override is performed
// in index.ts after `resolveModeProfile`.

export type AcademicStep =
  | "topics"
  | "validate"
  | "outline"
  | "abstract"
  | "chapter"
  | "introduction"
  | "conclusion";

export interface AcademicProfile {
  // ─── Billing ───
  /** Credit cost for this sub-mode. */
  creditCost: number;

  // ─── Context windows (chapter / abstract only) ───
  /** Per-previous-chapter content slice in characters. Default 2000. */
  prevChapterContextChars: number;
  /** Per-document context slice in characters (overrides MAX_CONTEXT_CHARS). */
  documentContextChars: number;

  // ─── Abstract envelope ───
  /** Hard word cap for the synthesised abstract. */
  abstractWordCap: number;

  // ─── Chapter envelope (only meaningful when inheritsFrom === "deep") ───
  /** Whether this sub-mode runs the full Deep pipeline. */
  enableDeepPipeline: boolean;
  /** Mode profile to inherit retrieval/drafting envelope from. */
  inheritsFrom: "deep" | null;

  // ─── QA guard (chapter only) ───
  /**
   * Flag if `unresolved_count / total_footnotes` exceeds this share.
   * Indicates citation engine resolver is dropping too many candidates.
   */
  qaGuardUnresolvedShareThreshold: number;
  /**
   * Flag if the answer is below this fraction of the inherited
   * `modeProfile.wordRangeMin`. Catches silent claim-map-miss collapses.
   */
  qaGuardUnderWordFloorRatio: number;
  /**
   * Flag if `narrative_violation_count >= this`. A narrative-citation
   * violation is a `[N]` marker that has no narrative phrase
   * ("בעניין X", "פרופ' Y", "ועדת Z") within ±120 chars before it.
   * Academic style mandates narrative citations (see line ~1110 in index.ts).
   */
  qaGuardNarrativeViolationThreshold: number;

  // ─── Critic pass (chapter-class only) ───
  /** When true, run the critic stage after the structured drafter. */
  criticEnabled?: boolean;
  /**
   * Revision triggers if `claims_supported / claims_total` falls below this.
   * Defaults to 0.7 in `shouldRevise` when omitted.
   */
  criticMinCoverage?: number;
}

export const ACADEMIC_PROFILES: Record<AcademicStep, AcademicProfile> = {
  topics: {
    creditCost: 0,
    prevChapterContextChars: 0,
    documentContextChars: 6000,
    abstractWordCap: 0,
    enableDeepPipeline: false,
    inheritsFrom: null,
    qaGuardUnresolvedShareThreshold: 0,
    qaGuardUnderWordFloorRatio: 0,
    qaGuardNarrativeViolationThreshold: 0,
  },
  validate: {
    creditCost: 0,
    prevChapterContextChars: 0,
    documentContextChars: 6000,
    abstractWordCap: 0,
    enableDeepPipeline: false,
    inheritsFrom: null,
    qaGuardUnresolvedShareThreshold: 0,
    qaGuardUnderWordFloorRatio: 0,
    qaGuardNarrativeViolationThreshold: 0,
  },
  outline: {
    creditCost: 0,
    prevChapterContextChars: 0,
    documentContextChars: 6000,
    abstractWordCap: 0,
    enableDeepPipeline: false,
    inheritsFrom: null,
    qaGuardUnresolvedShareThreshold: 0,
    qaGuardUnderWordFloorRatio: 0,
    qaGuardNarrativeViolationThreshold: 0,
  },
  abstract: {
    creditCost: 8,
    prevChapterContextChars: 0, // synthesis uses full content, not a slice
    documentContextChars: 6000,
    abstractWordCap: 250,
    enableDeepPipeline: false, // pure synthesis, no retrieval / no claim map
    inheritsFrom: null,
    qaGuardUnresolvedShareThreshold: 0,
    qaGuardUnderWordFloorRatio: 0,
    qaGuardNarrativeViolationThreshold: 0,
  },
  chapter: {
    creditCost: 8,
    prevChapterContextChars: 2000,
    documentContextChars: 12000,
    abstractWordCap: 0,
    enableDeepPipeline: true,
    inheritsFrom: "deep",
    // ─── QA guard thresholds (informed by chapter_engine telemetry history) ───
    qaGuardUnresolvedShareThreshold: 0.4,
    qaGuardUnderWordFloorRatio: 0.7, // <70% of Deep's 1200 floor → flag
    qaGuardNarrativeViolationThreshold: 3,
    criticEnabled: true,
    criticMinCoverage: 0.7,
  },
  // ─── Introduction (write_introduction) ─────────────────────────────
  // Generated LATE — after every body chapter and the conclusion are written.
  // Inherits Deep envelope but consumes paper-level synthesis context (full
  // body chapter content) rather than per-chapter document slices, so the
  // local document context window is unused. Word range stays Deep-class
  // (~800–1400 typical for an introduction); QA guard relaxes the word-floor
  // ratio because intros legitimately come in shorter than body chapters.
  introduction: {
    creditCost: 8,
    prevChapterContextChars: 0,
    documentContextChars: 0,
    abstractWordCap: 0,
    enableDeepPipeline: true,
    inheritsFrom: "deep",
    qaGuardUnresolvedShareThreshold: 0.4,
    qaGuardUnderWordFloorRatio: 0.5, // intros are framing — looser floor
    qaGuardNarrativeViolationThreshold: 3,
    criticEnabled: true,
    criticMinCoverage: 0.6, // intros: lighter coverage demand
  },
  // ─── Conclusion (write_conclusion) ─────────────────────────────────
  // Generated LAST among substantive chapters. Synthesizes the actual body,
  // not the outline. Same Deep envelope shape as introduction.
  conclusion: {
    creditCost: 8,
    prevChapterContextChars: 0,
    documentContextChars: 0,
    abstractWordCap: 0,
    enableDeepPipeline: true,
    inheritsFrom: "deep",
    qaGuardUnresolvedShareThreshold: 0.4,
    qaGuardUnderWordFloorRatio: 0.5,
    qaGuardNarrativeViolationThreshold: 3,
    criticEnabled: true,
    criticMinCoverage: 0.6,
  },
};

/**
 * Resolve the academic step name used in the request to its profile.
 * Returns `null` for non-academic requests or unknown steps.
 *
 * Mapping mirrors the request contract:
 *   academicStep === "suggest_topics"      → topics
 *   academicStep === "validate_question"   → validate
 *   academicStep === "propose_outline"     → outline
 *   academicStep === "write_chapter" + isAbstract → abstract
 *   academicStep === "write_chapter" (else)       → chapter
 *   academicStep === "write_introduction"         → introduction
 *   academicStep === "write_conclusion"           → conclusion
 */
export function resolveAcademicProfile(
  academicStep: unknown,
  isAbstract: unknown,
): { step: AcademicStep; profile: AcademicProfile } | null {
  if (typeof academicStep !== "string") return null;
  switch (academicStep) {
    case "suggest_topics":
      return { step: "topics", profile: ACADEMIC_PROFILES.topics };
    case "validate_question":
      return { step: "validate", profile: ACADEMIC_PROFILES.validate };
    case "propose_outline":
      return { step: "outline", profile: ACADEMIC_PROFILES.outline };
    case "write_chapter":
      return isAbstract
        ? { step: "abstract", profile: ACADEMIC_PROFILES.abstract }
        : { step: "chapter", profile: ACADEMIC_PROFILES.chapter };
    case "write_introduction":
      return { step: "introduction", profile: ACADEMIC_PROFILES.introduction };
    case "write_conclusion":
      return { step: "conclusion", profile: ACADEMIC_PROFILES.conclusion };
    default:
      return null;
  }
}
