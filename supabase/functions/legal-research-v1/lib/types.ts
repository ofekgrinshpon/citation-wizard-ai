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

export interface FootnoteItem {
  source_number: number;
  title: string;
  url: string | null;
  source_type?: string;
  is_short_form?: boolean;
  short_form_kind?: "ibid" | "supra";
  back_ref_number?: number;
  source_candidate_id?: string;
}

export interface Footnote {
  number: number;
  title: string;
  url: string | null;
  source_type?: string;
  // Phase 3 (occurrence-footnote) additive fields. Absent when phase3 not applied.
  source_number?: number;          // points to used_sources[].number for the unique source
  is_short_form?: boolean;
  short_form_kind?: "ibid" | "supra";
  back_ref_number?: number;        // first-occurrence footnote number of the source
  source_candidate_id?: string;    // debug only, never rendered
  // Phase 3 v3 — compound footnote (same-position citation cluster).
  is_compound?: boolean;
  source_numbers?: number[];
  items?: FootnoteItem[];
}

// ─── Phase C.1: Atomic marker representation ──────────────────────────────
export type AtomicMode = "off" | "validate";
export type MarkerFormat = "legacy_superscript";

export interface AtomicReport {
  mode: AtomicMode;
  normalize_ok: boolean;
  normalize_reason?: string;
  validation: MarkerValidation | null;
  used_sources_byte_equal: boolean;
  superscript_marker_count: number;
  atomic_marker_count: number;
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
  // Added by cluster-prevention phase (measurement only, no gating).
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
  phase3?: {
    applied: boolean;
    occurrence_count?: number;
    unique_source_count?: number;
    short_form_count?: number;
    ibid_count?: number;
    supra_count?: number;
    examples?: Array<{ marker_number: number; rendering: string }>;
    discarded_reason?:
      | "ambiguous_adjacent_markers"
      | "multi_digit_occurrences_require_boundary_tokens"
      | "would_create_ambiguous_markers"
      | "marker_validation_failed"
      | "footnote_resolution_failed"
      | "no_markers"
      | "disabled_by_env"
      | "ambiguous_raw_superscript_run"
      | "adjacent_tokens_would_render_ambiguous"
      | "token_leak_detected";
    cluster_examples?: string[];
    ambiguous_run_samples?: Array<{ run: string; context: string; candidates: string[] }>;
    multi_digit_marker_runs_count?: number;
    multi_digit_runs_from_single_token_count?: number;
    every_multi_digit_run_from_single_token?: boolean;
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
  // Phase 3 additive fields.
  occurrence_mode?: boolean;
  occurrence_count?: number;
  unique_source_count?: number;
  short_form_count?: number;
  ibid_count?: number;
  supra_count?: number;
  every_marker_has_footnote?: boolean;
  every_footnote_in_usable?: boolean;
  no_adjacent_marker_clusters?: boolean;
  // Token-aware multi-digit proof (Phase 3 v2). Report-only; do not gate on
  // `no_adjacent_marker_clusters` after v2 — the token-adjacency guard inside
  // applyOccurrenceFootnotes is the real safety net.
  multi_digit_marker_runs_count?: number;
  multi_digit_runs_from_single_token_count?: number;
  every_multi_digit_run_from_single_token?: boolean;
  token_model_ok?: boolean;
}


