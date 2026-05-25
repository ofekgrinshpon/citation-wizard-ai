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

export interface AnalyzerOutput {
  confidence: number;
  legal_area: string;
  answer_type: AnswerType;
  claims: Claim[];
}

export interface Query {
  claim_id: string;
  role: SourceRole;
  query_he: string;
  targets: QueryTarget[];
  expected_source_type: ExpectedSourceType;
  reason: string;
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

export interface Verdict {
  candidate_id: string;
  claim_id: string;
  support: SupportLevel;
  role_match: boolean;
  supported_points: string[];
  reason: string;
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
  // Phase B (Rule 37) telemetry — UI ignores these optional fields.
  is_short_form?: boolean;
  short_form_of?: number;       // full-citation footnote number this short-forms
  candidate_id?: string;        // for back-reference validation only
  short_form_kind?: "shem" | "supra";
}

export interface Rule37Report {
  enabled: boolean;
  applied: boolean;             // false if disabled, no-op, discarded, or validation failed
  discarded_reason: string | null;
  validation_failed: string | null;
  total_repeats_rewritten: number;
  shem_count: number;
  supra_count: number;
  shortname_fallback_count: number;
  pre_footnote_count: number;
  post_footnote_count: number;
  wrong_back_references: number;
  samples: Array<{ from_num: number; to_num: number; kind: "shem" | "supra"; short_text: string }>;
}

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
}


