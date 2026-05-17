// Internal JSON contracts for the Legal Research pipeline.
// These types are INTERNAL — they live between stages (decomposition →
// source pack → claim map → drafting). They MUST NOT leak to the
// user-facing response. `BANNED_KEYS` + `sanitizeResponse` enforce that.

export type LegalQuestionType =
  | "normative"
  | "applied"
  | "interpretive"
  | "current_status"
  | "comparative"
  | "mixed";

export interface LegalResearchDecomposition {
  mainIssue: string;
  subIssues: string[];
  questionType: LegalQuestionType;
  domain?: string;
  jurisdiction: "israel";
  requiresLegislation: boolean;
  requiresCaselaw: boolean;
  requiresSecondarySources: boolean;
  requiresCurrentSources: boolean;
  userDocumentsRelevant: boolean;
  notes?: string[];
}

export type LegalAuthorityClass =
  | "primary_legislation"
  | "primary_caselaw"
  | "secondary_official"
  | "secondary_academic"
  | "external_reference"
  | "user_document"
  | "unknown";

export type LegalProvenanceInternal =
  | "local"
  | "perplexity"
  | "perplexity_completion"   // Milestone B — verified primary source recovered via targeted Perplexity call
  | "claim_verified_recall"   // Recall-vs-Proof — low-threshold candidate promoted by Claim Verification
  | "document"
  | "verified"
  | "unknown";

// ─── Phase 6.5 — Source role taxonomy ─────────────────────────────────
// Roles describe HOW a source supports the answer, not WHAT court it came
// from. A family-court ruling can be a legitimate `application_example`;
// a Supreme Court ruling on a different doctrine is `background_context`,
// not a `doctrinal_anchor`. The classifier (sourceRoleClassifier.ts)
// assigns the role; the planner (legalResearchPlanner.ts) declares which
// roles a competent answer requires.
export type SourceRole =
  | "doctrinal_anchor"      // landmark ruling that establishes / interprets the doctrine in question
  | "statutory_anchor"      // the actual statute / section the question is about
  | "legislative_history"   // bills, committee reports, Knesset research that explain a statute
  | "academic_commentary"   // peer commentary on the doctrine / statute
  | "theoretical_anchor"    // canonical academic position cited as a position, not as authority
  | "policy_analysis"       // policy / institutional analysis, often by think-tanks or research bodies
  | "case_example"          // ruling that illustrates the doctrine in practice (any court)
  | "application_example"   // narrow application of the doctrine to specific facts (often lower courts)
  | "counter_position"      // dissent / minority view / opposing scholarly position
  | "institutional_context" // background on the relevant institution / process
  | "background_context"    // general context, not directly supporting any specific claim
  | "weak_or_uncertain";    // classifier could not place the source confidently

export type CitationQuality = "strong" | "weak" | "placeholder";

export type CitationQualityReason =
  | "docket_only"            // case_number with no party names
  | "missing_case_name"      // caselaw with no recognizable party / case identifier
  | "court_only"             // court name with nothing else
  | "too_short"              // total citation < 12 chars
  | "truncated_court"        // citation appears to end in a truncated court / phrase
  | "missing_year"           // legislation / academic missing year token
  | "unbalanced_parentheses" // ( without matching ) etc.
  | "placeholder_marker"     // contains [חסר: ...] markers
  | "no_substantive_content"; // generic placeholder text only

export interface LegalSourcePackItem {
  sourceId: string;            // e.g. "src-12"
  title: string;
  sourceType: string;
  authorityClass: LegalAuthorityClass;
  date?: string;
  url?: string;
  caseNumber?: string;
  excerpt?: string;
  anchorPresent: boolean;
  usableForAnalysis: boolean;
  usableForCitation: boolean;
  /** INTERNAL — stripped by sanitizeResponse. */
  provenanceInternal?: LegalProvenanceInternal;
  /** INTERNAL — retrieval-stage similarity (0–1). Drives source-pack promotion gate. */
  relevanceScore?: number;
  /** Phase 6 — stable Card→Claim contract ID, e.g. "S3". */
  contractId?: string;
  /** Phase 6 — deterministic citation string used by the contract footnote builder. */
  canonicalCitation?: string;
  /** Phase 6.5 — role assigned by SourceRoleClassifier. INTERNAL. */
  role?: SourceRole;
  /** Phase 6.5 — classifier confidence in the role. INTERNAL. */
  roleConfidence?: "high" | "medium" | "low";
  /** Phase 6.5 — short Hebrew rationale from the classifier. INTERNAL. */
  roleRationale?: string;
  /** Phase 6.5 — deterministic citation quality (citationQualityScorer). INTERNAL. */
  citationQuality?: CitationQuality;
  /** Phase 6.5 — reason codes that drove citationQuality. INTERNAL. */
  citationQualityReasons?: CitationQualityReason[];
  metadata?: Record<string, unknown>;
}

export interface LegalSourcePack {
  coreSources: LegalSourcePackItem[];        // primary_legislation + primary_caselaw + user_document
  supportingSources: LegalSourcePackItem[];  // secondary_official + secondary_academic
  secondarySources: LegalSourcePackItem[];   // external_reference + unknown
}

export type LegalStatementMode = "direct" | "qualified" | "omit";

export interface LegalClaimMapItem {
  claimId: string;             // e.g. "c-1"
  claimText: string;
  subIssue: string;
  sourceIds: string[];
  authorityLevel: "high" | "medium" | "low";
  confidence: "high" | "medium" | "low";
  needsPinpoint: boolean;
  allowedToState: boolean;
  statementMode: LegalStatementMode;
  notes?: string;
}

export interface LegalClaimMap {
  claims: LegalClaimMapItem[];
  uncoveredSubIssues: string[];
  draftingNotes?: string[];
}

export interface LegalDraftingInput {
  userQuestion: string;
  decomposition: LegalResearchDecomposition;
  sourcePack: LegalSourcePack;
  claimMap: LegalClaimMap;
  userDocumentContext?: string;
  responseStyle?: "short" | "regular" | "detailed";
}

// ─── Phase 6.5 — Legal Research Plan (planner output) ─────────────────
// The Planner sits between Router/Decomposition and retrieval. It declares
// what answer SHAPE we need, which source ROLES are required vs preferred,
// and produces canonical search targets that retrieval consumes directly
// (not just for telemetry).
//
// Hierarchy:
//   - LegalIssueRouter → query_type + legal_domain (deterministic-ish classification)
//   - LegalResearchPlanner → answer_strategy + required source roles + search targets
//   - If router and planner materially disagree, log telemetry but trust the
//     planner for retrieval shaping (planner sees decomposition + discovery).

export type AnswerStrategy =
  | "doctrinal_synthesis"       // what is the doctrine; resolve a doctrinal question
  | "statutory_application"     // apply statute X to fact pattern
  | "amendment_comparison"      // compare pre/post amendment; did doctrine change?
  | "theoretical_analysis"      // analyze a phenomenon (e.g. "is the court activist?")
  | "procedural_explanation"    // explain a procedural rule / process
  | "current_status_summary"    // what's the current state of X
  | "comparative_analysis"      // israeli vs foreign / between domains
  | "mixed";

export interface RequiredRole {
  role: SourceRole;
  /** Minimum number of distinct sources that should fill this role. */
  minCount: number;
  /** "must" → gate gap if missing; "should" → preferred but won't trigger rescue alone. */
  priority: "must" | "should";
  /** Short Hebrew rationale from the planner — telemetry only. */
  rationale: string;
}

// Phase 6.7 — Discovery-driven retrieval strategy.
// Discovery NEVER becomes citeable authority, but it MAY drive retrieval.
// "db_first"        → narrow doctrinal/statutory question with clear anchors.
// "discovery_first" → theoretical / critical / institutional / policy / reform
//                     / academic / unclear-source-universe; discovery queries
//                     dominate trusted-DB fan-out.
// "hybrid"          → mixed (doctrinal anchor exists but normative/critical
//                     framing also requires academic/policy verification).
export type RetrievalStrategy = "db_first" | "discovery_first" | "hybrid";

export interface DiscoveryAlignment {
  /** Discovery resolved_entities the planner adopted (by name). */
  consumedEntities: string[];
  /** Discovery suggested_trusted_queries the planner adopted. */
  consumedQueries: string[];
  /** Discovery resolved_entities the planner explicitly chose to ignore + why. */
  ignoredEntities: { value: string; reason: string }[];
  /** Canonical names/titles the planner asks downstream retrieval to verify. */
  requiredVerificationTargets: string[];
}

export interface LegalResearchPlan {
  /** Stable id (timestamp-based) for telemetry correlation. */
  planId: string;
  /** Snapshot of the routing the planner consumed (for disagreement diffing). */
  consumedRoute: {
    queryType: string | null;
    legalDomain: string | null;
  };
  /** What kind of answer this question wants. Drives required roles. */
  answerStrategy: AnswerStrategy;
  /** Roles that MUST be present (or the gate logs a gap). */
  requiredRoles: RequiredRole[];
  /** Roles that strengthen the answer when present, but don't trigger rescue alone. */
  preferredRoles: SourceRole[];
  /** Concrete retrieval queries that go INTO round-1 retrieval, not just telemetry. */
  canonicalSearchTargets: string[];
  /** Optional doctrinal anchor names the planner identified with confidence. */
  doctrinalAnchorNames?: string[];
  /** Optional statute names the planner identified with confidence. */
  statuteNames?: string[];
  /** Free-text planner notes — telemetry only. */
  notes?: string;
  /** Planner-reported confidence (0..1). */
  confidence: number;
  /** Phase 6.7 — retrieval strategy decision. */
  retrievalStrategy?: RetrievalStrategy;
  /** Phase 6.7 — short Hebrew rationale for the strategy choice (telemetry only). */
  retrievalStrategyRationale?: string;
  /** Phase 6.7 — how the planner consumed Discovery output. */
  discoveryAlignment?: DiscoveryAlignment;
}

// ─── Phase 6.5 — Source Pack Gate V2 (role-based) ─────────────────────
export interface RoleCoverageGap {
  role: SourceRole;
  required: number;
  found: number;
  priority: "must" | "should";
}

export interface SourcePackGateV2Result {
  /** "off" | "shadow" | "on" — mirrors the modeProfile flag. */
  mode: "off" | "shadow" | "on";
  /** True when all `must` roles are satisfied. */
  satisfied: boolean;
  /** Per-role coverage counts. */
  coverage: Partial<Record<SourceRole, number>>;
  /** Roles whose minCount was not met. Includes both `must` and `should` for visibility. */
  gaps: RoleCoverageGap[];
  /** Subset of `gaps` with priority="must" (these would trigger rescue retrieval). */
  blockingGaps: RoleCoverageGap[];
  /** True when the soft banner was attached to the drafter prompt. Always false in shadow mode. */
  bannerAttached: boolean;
}

// ─── Phase 7 — Issue Map / Candidate Claims / Claim Ledger ─────────────
// Stage 1 (Issue Map) explores the open web broadly to build a non-citeable
// background map. Stage 2 (Candidate Claims) extracts hypotheses. Stage 3
// (Claim Verification) scores each claim against local DB + trusted
// allowlist sources only. Stage 4 (Claim Ledger) records verdicts that
// constrain Stage 5 (the drafter): only verified, directly/partially
// supported claims may be asserted.
//
// Hard invariants:
// - Issue Map URLs/snippets NEVER enter the SourcePack.
// - Tangential / unrelated sources NEVER support a claim, even if verified.

export interface IssueMapDoctrine {
  name: string;
  summary: string;
}
export interface IssueMapCase {
  name: string;
  docket?: string;
  relevance: string;
}
export interface IssueMapStatute {
  name: string;
  year?: string;
  relevance: string;
}
export interface IssueMapSecondary {
  author?: string;
  title?: string;
  type: "academic" | "committee" | "report" | "news" | "other";
  relevance: string;
}
export interface IssueMapPosition {
  stance: string;
  rationale: string;
}

export interface IssueMap {
  framing: string;
  doctrines: IssueMapDoctrine[];
  leading_cases: IssueMapCase[];
  statutes: IssueMapStatute[];
  secondary_sources: IssueMapSecondary[];
  competing_positions: IssueMapPosition[];
  open_questions: string[];
}

export type CandidateClaimKind =
  | "doctrinal"
  | "empirical"
  | "normative"
  | "procedural";

export interface CandidateClaim {
  id: string;                     // e.g. "C1"
  statement: string;              // Hebrew, single sentence
  kind: CandidateClaimKind;
  required_evidence: Array<"statute" | "case" | "academic" | "committee" | "news">;
  generated_search_queries: string[];
  source_hint: "issue_map";       // marker — never citeable as-is
}

export type ClaimRelevanceScore =
  | "direct_support"
  | "partial_support"
  | "tangential"
  | "unrelated";

export type ClaimVerdict =
  | "supported"
  | "partially_supported"
  | "unsupported";

export interface ClaimRelevanceHit {
  /** SourcePack contract id ("S1", "S2", …) when known; otherwise numeric pack id. */
  sourceId: string;
  score: ClaimRelevanceScore;
  rationale: string;
}

export interface ClaimLedgerItem {
  id: string;
  statement: string;
  verdict: ClaimVerdict;
  /** SourcePack ids that *directly* or *partially* support the claim. */
  sourceIds: string[];
  /** Short Hebrew note describing how the evidence supports the claim. */
  evidenceNotes: string;
  hits: ClaimRelevanceHit[];
}

export interface ClaimLedger {
  claims: ClaimLedgerItem[];
}

// ─── Provenance hardening ────────────────────────────────────────
// Keys that must NEVER appear in the user-facing JSON payload.
// `sanitizeResponse` walks the payload and strips any of these.
export const BANNED_KEYS: readonly string[] = [
  "provenanceInternal",
  "relevanceScore",            // INTERNAL retrieval similarity, never user-facing
  "decomposition",
  "claimMap",
  "sourcePack",
  "draftingNotes",
  "uncoveredSubIssues",
  "provenance",                // legacy name on footnotes
  // Phase 6.5 internals
  "role",
  "roleConfidence",
  "roleRationale",
  "citationQuality",
  "citationQualityReasons",
  "legalResearchPlan",
  "sourcePackGateV2",
  "roleClassification",
  // Phase 6.7 — discovery-driven research planning internals
  "discoveryAlignment",
  "retrievalStrategy",
  "retrievalStrategyRationale",
  // Phase 7 — Issue Map / Candidate Claims / Claim Ledger internals
  "issueMap",
  "issue_map_raw",
  "candidateClaims",
  "claimLedger",
  "claim_ledger",
  "relevance_scores",
  "verification_summary",
] as const;
