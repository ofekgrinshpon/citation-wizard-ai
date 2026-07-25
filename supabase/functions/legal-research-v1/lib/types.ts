// Shared types for legal-research-v1.

export const SOURCE_ROLES = [
  "primary_statute",
  "regulation",
  "binding_case_law",
  "persuasive_case_law",
  "scholarship",
  "factual_report",
  "government_report",
] as const;
export type SourceRole = typeof SOURCE_ROLES[number];

export const ANSWER_TYPES = [
  "doctrinal_explanation",
  "application",
  "comparison",
  "factual_legal",
  "other",
] as const;
export type AnswerType = typeof ANSWER_TYPES[number];

export const EXPECTED_SOURCE_TYPES = [
  "statute",
  "regulation",
  "case",
  "academic",
  "report",
  "other",
] as const;
export type ExpectedSourceType = typeof EXPECTED_SOURCE_TYPES[number];

export const QUERY_TARGETS = ["local_db", "perplexity"] as const;
export type QueryTarget = typeof QUERY_TARGETS[number];

export interface Claim {
  claim_id: string;
  text_he: string;
  required_roles: SourceRole[];
  is_black_letter: boolean;
  reason: string;
}

// Lightweight output-shape hint emitted by the analyzer. This is a *format*
// signal only. Confidence/caveat behaviour stays with the existing downstream
// evidence (missingRequiredAnchors, verifier support, snippet coverage).
export const OUTPUT_SHAPES = [
  "quote",
  "definition",
  "list",
  "timeline",
  "case_holding",
  "analysis",
  "comparison",
  "unknown",
] as const;
export type OutputShape = typeof OUTPUT_SHAPES[number];

export interface AnswerIntent {
  output_shape: OutputShape;
}

export interface AnalyzerOutput {
  confidence: number;
  legal_area: string;
  answer_type: AnswerType;
  claims: Claim[];
  /**
   * Optional free-text note from the analyzer recording how it disambiguated
   * a key term in the user's question (e.g. "מנדטורי פורש כפקודה מתקופת המנדט
   * הבריטי"). Surfaced into planning debug metadata and passed to the query
   * planner so it can bias query generation accordingly.
   */
  interpretation_note?: string;
  /**
   * Optional structured "answer intent" emitted by the analyzer in the same
   * LLM call (no extra call). The drafter uses it to pick output shape,
   * confidence posture, and required inclusions/avoidances. Backwards
   * compatible: absent → drafter falls back to prior behavior.
   */
  answer_intent?: AnswerIntent;
}


export interface Query {
  claim_id: string;
  role: SourceRole;
  query_he: string;
  targets: QueryTarget[];
  expected_source_type: ExpectedSourceType;
  reason: string;
  // Optional non-schema metadata (e.g. required_anchor_id). Validated planner
  // output never includes this; the index pipeline appends required-anchor
  // queries that carry metadata so retrieval/verifier/drafter can trace them.
  metadata?: Record<string, unknown>;
}

export interface PlannerOutput {
  queries: Query[];
}

export interface StageRun {
  stage: string;
  model?: string;
  ms: number;
  ok: boolean;
  escalated?: boolean;
  http_status?: number;
  http_error?: string;
  parse_error?: string;
  retry_skipped_reason?: string;
}

export const MODEL_MINI = "openai/gpt-5-mini";
export const MODEL_FULL = "openai/gpt-5";

export const CAPS = {
  MAX_CLAIMS: 7,
  MAX_QUERIES_PER_CLAIM: 4,
  MAX_CANDIDATES: 30,
  LOCAL_PER_QUERY: 6,
  PERPLEXITY_PER_QUERY: 5,
} as const;

export type Origin = "local_db" | "perplexity";
export type RetrievalMethod = "text" | "vector" | "perplexity";

export interface Candidate {
  candidate_id: string;
  claim_id: string;
  role: SourceRole;
  origin: Origin;
  retrieval_method: RetrievalMethod;
  title: string;
  source_type: string;
  document_id?: string | null;
  source_url?: string | null;
  snippet?: string | null;
  query_he: string;
  score: number;
  expected_source_type?: ExpectedSourceType;
  metadata?: Record<string, unknown>;
}

export interface DroppedSource {
  query_he: string;
  claim_id: string;
  role: SourceRole;
  origin: Origin;
  title?: string;
  url?: string;
  drop_reason: string;
}

// ─── P4: Verifier ──────────────────────────────────────────────────────────
export const SUPPORT_LEVELS = ["direct", "partial", "tangential", "unrelated"] as const;
export type SupportLevel = typeof SUPPORT_LEVELS[number];

// Optional diagnostic sub-classification of a verdict, used by the deterministic
// post-verdict subject-identity pass (verifier.ts). Additive: absence is fine.
export const SUPPORT_SUBTYPES = [
  "exact_subject",
  "same_domain",
  "analogical",
  "background",
  "wrong_subject",
] as const;
export type SupportSubtype = typeof SUPPORT_SUBTYPES[number];

export interface Verdict {
  candidate_id: string;
  claim_id: string;
  support: SupportLevel;
  role_match: boolean;
  supported_points: string[];
  reason: string;
  support_subtype?: SupportSubtype;
}

export interface DroppedCandidate {
  candidate_id: string;
  title: string;
  role: SourceRole;
  origin: Origin;
  retrieval_method: RetrievalMethod;
  reason: string;
  worst_support: SupportLevel;
}

export interface UsableCandidate {
  candidate_id: string;
  best_support: SupportLevel;
  role_match: boolean;
  verdict_claim_ids: string[];
}

// ─── P5: Drafter ───────────────────────────────────────────────────────────
export interface UsedSource {
  candidate_id: string;
  number: number;
  title: string;
  url: string | null;
  source_type: string;
  origin: Origin | "user_upload";
}

export interface Footnote {
  number: number;
  title: string;
  url: string | null;
  source_type?: string;
  sources?: Array<{ title: string; url: string | null; source_type: string }>;
}

export type MarkerFormat = "legacy_superscript";

export interface PlacementReport {
  ok: boolean;
  cluster_count: number;
  cluster_samples: string[];
  out_of_order_count: number;
  end_paragraph_dump_count: number;
  end_dump_samples: string[];
  superscript_parens_count?: number;
  repaired?: boolean;
  repair_failed?: boolean;
  // Cluster telemetry (measurement only, no gating).
  max_cluster_len?: number;
  cluster_run_count?: number;
  final_paragraph_marker_count?: number;
  final_paragraph_last_sentence_marker_count?: number;
  final_summary_dump?: boolean;
  final_summary_dump_count?: number;
}

export interface CitationCleanupReport {
  phase1: {
    applied: boolean;
    changed: boolean;
    before_order: number[];
    after_order: number[];
    discarded_reason?: "marker_validation_failed" | "no_markers";
  };
  phase2: {
    applied: boolean;
    punct_swaps: number;
    discarded_reason?: "marker_validation_failed";
  };
  clusters: {
    count: number;
    examples: Array<{ run: string; index: number; context: string }>;
  };
}

export interface MarkerValidation {
  ok: boolean;
  markers_in_answer: number[];
  unused_sources: number[];
  missing_sources: number[];
  internal_id_leak: boolean;
  leaked_tokens: string[];
  repaired: boolean;
  error?: string;
  placement?: PlacementReport;
  citation_cleanup?: CitationCleanupReport;
}



