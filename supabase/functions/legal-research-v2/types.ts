/**
 * legal-research-v2 — shared types for the agentic research core.
 *
 * Architecture (one path, no stages-per-fix):
 *   Question → Intake → Research Agent (3 tools) → Research Memo
 *            → Verification (4 checks) → Verified Evidence Pack
 *            → Drafter → Deterministic Citation Renderer → Answer
 */

import type { AcademicProjectContext } from "./academic/projectContext.ts";

// ─── Intake ─────────────────────────────────────────────────────────────────

export interface DocketObligation {
  docket_id: string;
  display: string;
  variants: string[];
}

export interface StatuteObligation {
  statute: string;
  section: string | null;
  variants: string[];
}

export type DeliverableKind = "focused" | "developed";

export interface Intake {
  run_id: string;
  question: string;
  normalized_question: string;
  docket_obligations: DocketObligation[];
  statute_obligations: StatuteObligation[];
  attachment_text: string | null;
  /** What the user asked to receive: a focused answer or a developed product. */
  deliverable: DeliverableKind;
  budgets: ToolBudgets;
  /**
   * Evaluation-only Research Agent model override (model bake-off).
   * Null / absent keeps the configured default. Verifier and drafter are
   * never overridable.
   */
  agent_model?: string | null;
  /**
   * Academic Writing body chapter only. Framing context for the paper the
   * chapter belongs to — never evidence, never citable. Absent for every
   * normal legal-research run.
   */
  academic_context?: AcademicProjectContext | null;
  /** Continuous footnote numbering across chapters (0 for normal research). */
  footnote_offset?: number;
}

export interface ToolBudgets {
  max_agent_steps: number;
  max_search_calls: number;
  max_fetch_calls: number;
  max_lookup_calls: number;
}

export const DEFAULT_BUDGETS: ToolBudgets = {
  max_agent_steps: 30,
  max_search_calls: 8,
  max_fetch_calls: 12,
  max_lookup_calls: 6,
};

// ─── Tools ──────────────────────────────────────────────────────────────────

export type SearchScope = "web" | "corpus" | "official" | "academic";

export interface SearchResult {
  result_id: string;
  title: string;
  url?: string;
  snippet?: string;
  origin: string;
  possible_docket?: string;
  possible_source_type?: string;
}

export interface LookupCandidate {
  label: string;
  kind: "case" | "statute";
  docket?: string;
  statute?: string;
  section?: string;
  url?: string;
  origin: string;
  local_document_id?: string;
  note?: string;
}

// ─── Evidence store ─────────────────────────────────────────────────────────

export interface IdentityFields {
  dockets: string[];
  statutes: string[];
  sections: string[];
}

export interface EvidenceSource {
  source_id: string;
  url?: string;
  title: string;
  /** Short deterministic description handed to the agent instead of the body. */
  summary?: string;
  sha256: string;
  fetch_status: "ok" | "error";
  fetch_error?: string;
  extracted_text: string;
  text_length: number;
  identity_fields: IdentityFields;
  is_actual_document: boolean;
  not_document_reason?: string;
  origin: string;
  fetched_at: string;
}

// ─── Research memo (agent output) ───────────────────────────────────────────

export interface MemoEvidence {
  source_id: string;
  quoted_span: string;
  locator?: string;
  reason: string;
}

export interface MemoClaim {
  claim_id: string;
  proposition: string;
  importance: "core" | "supporting";
  /**
   * Agent-declared: the proposition asserts what the law IS now (safeguard A).
   * A deterministic Hebrew cue check is applied as a backstop.
   */
  current_state_claim?: boolean;
  evidence: MemoEvidence[];
}


export interface ResearchMemo {
  issue_summary: string;
  claims: MemoClaim[];
  unresolved_questions: string[];
  research_complete: boolean;
}

// ─── Verification ───────────────────────────────────────────────────────────

export type RejectionReason =
  | "unknown_source_id"
  | "fetch_failed"
  | "empty_body"
  | "not_actual_document"
  | "identity_mismatch"
  | "span_not_found"
  | "span_too_short"
  | "support_does_not_support"
  | "verifier_unavailable";

export interface RejectedPair {
  claim_id: string;
  source_id: string;
  reason: RejectionReason;
  detail: string;
}

export type SupportVerdict = "supports" | "supports_partially" | "does_not_support";

/** Safeguard A — current-law validity of a claim (never of a source). */
export type TemporalStatus =
  | "not_applicable"
  | "current_verified"
  | "unresolved"
  | "contradicted";

/** Safeguard B — where the verified support actually came from. */
export type SupportProvenance = "primary_direct" | "authoritative_derivative";

export interface VerifiedSourceRef {
  source_id: string;
  display_title: string;
  url?: string;
  verified_span: string;
  locator?: string;
  support: SupportVerdict;
  support_provenance?: SupportProvenance;
}

export interface VerifiedClaim {
  claim_id: string;
  proposition: string;
  importance: "core" | "supporting";
  support_status: "supported" | "partially_supported";
  current_state_claim?: boolean;
  temporal_status?: TemporalStatus;
  sources: VerifiedSourceRef[];
}


export interface UnsupportedClaim {
  claim_id: string;
  proposition: string;
  importance: "core" | "supporting";
  reasons: string[];
}

export interface VerifiedEvidencePack {
  claims: VerifiedClaim[];
  unsupported_claims: UnsupportedClaim[];
}

export interface VerificationOutcome {
  pack: VerifiedEvidencePack;
  rejected: RejectedPair[];
  counters: {
    total_evidence_pairs: number;
    identity_verified_pairs: number;
    span_verified_pairs: number;
    support_verdicts: Record<SupportVerdict, number>;
  };
}

// ─── Drafting / rendering ───────────────────────────────────────────────────

export interface DraftBlock {
  type: "heading" | "paragraph" | "list_item";
  text: string;
  source_ids: string[];
}

export interface Footnote {
  index: number;
  source_id: string;
  citation: string;
  url?: string;
}

export interface RenderedAnswer {
  answer_markdown: string;
  footnotes: Footnote[];
  cited_source_ids: string[];
  invariant_errors: string[];
}

import type { AuthorityLedgerRow } from "./tools/acquisitionLedger.ts";
import type { AgentTurnRecord } from "./shared/timing.ts";

// ─── Telemetry ──────────────────────────────────────────────────────────────

export interface SourceFunnelRow {
  source_id: string;
  title: string;
  url?: string;
  discovered: boolean;
  fetched: boolean;
  identity_verified: boolean;
  span_verified: boolean;
  support_verified: boolean;
  cited: boolean;
}

export interface V2Telemetry {
  run_id: string;
  agent_steps: number;
  search_calls: Record<SearchScope, number>;
  fetch_calls: number;
  lookup_calls: number;
  documents_fetched: number;
  successful_body_reads: number;
  research_claim_count: number;
  verified_claim_count: number;
  unsupported_claim_count: number;
  total_evidence_pairs: number;
  identity_verified_pairs: number;
  span_verified_pairs: number;
  support_verdicts: Record<SupportVerdict, number>;
  cited_source_count: number;
  footnote_count: number;
  repair_cycles: number;
  latency_ms: number;
  model_calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  estimated_cost_usd: number | null;
  /** Context / token discipline (legal_research_v2_core_bottlenecks_v1). */
  prompt_tokens_per_call: number[];
  max_prompt_tokens_single_call: number;
  largest_tool_response_chars: number;
  evidence_context_chars_last_turn: number;
  repeated_tool_calls_prevented: number;
  commit_directives: string[];
  chunks_executed: number;
  /** Latency efficiency (legal_research_v2_latency_efficiency_v1). */
  phase_ms?: Record<string, number>;
  agent_turns?: AgentTurnRecord[];
  already_read_actions?: number;
  noop_already_read_suppressed?: number;
  authority_reacquisitions_prevented?: number;
  context_compactions?: number;
  context_chars_saved?: number;
  /** Statute section acquisition + same-source exhaustion (statute_section_acquisition_v1). */
  section_reads_yielded?: number;
  section_reads_missing?: number;
  sources_marked_exhausted?: number;
  unresolved_authorities?: string[];
  /** Why a research reopen was NOT performed after verification, when it wasn't. */
  repair_skip_reason?: string | null;
  /** Safeguard A — current-law / temporal validity. */
  temporal_sensitive_claims: number;
  temporal_checks_attempted: number;
  temporal_current_verified: number;
  temporal_unresolved: number;
  temporal_contradicted: number;
  temporal_repairs: number;
  /** Safeguard B — unreadable primary authority fallback. */
  primary_authority_obligations: string[];
  primary_unreadable: string[];
  derivative_fallback_attempted: boolean;
  derivative_supported_authorities: string[];
  derivative_disclosure_shown: boolean;

  acquisition_ledger: AuthorityLedgerRow[];
  source_funnel: SourceFunnelRow[];
}
