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
