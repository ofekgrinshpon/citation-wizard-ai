/**
 * legal-research-v2 — shared types for the agentic research core.
 *
 * Architecture (one path, no stages-per-fix):
 *   Question → Intake → Research Agent (3 tools) → Research Memo
 *            → Verification (4 checks) → Verified Evidence Pack
 *            → Drafter → Deterministic Citation Renderer → Answer
 */

import type { AcademicProjectContext } from "./academic/projectContext.ts";
import type { BibliographicMetadata } from "./shared/bibliographic.ts";
import type { ExtractionStatus, TextQuality } from "./shared/academicText.ts";

export type { BibliographicMetadata, ExtractionStatus, TextQuality };

/** How a document body was (or was not) obtained over the wire. */
export type AcquisitionStatus =
  | "not_attempted"
  | "http_failed"
  | "blocked"
  | "unsupported_response"
  | "acquired";

/** Bounded PDF extraction observability for one source. */
export interface PdfExtractionMeta {
  total_pages?: number;
  pages_attempted?: number;
  pages_extracted?: number;
  first_page?: number | null;
  last_page?: number | null;
  chars_extracted?: number;
  stop_reason?: string;
  /** Pages already read by a bounded continuation read. */
  continued_through_page?: number;
}

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

// Research depth is decided by the Research Agent itself — no deterministic
// deliverable classification exists in V2 any more.

export interface Intake {
  run_id: string;
  question: string;
  normalized_question: string;
  docket_obligations: DocketObligation[];
  statute_obligations: StatuteObligation[];
  /** Legacy inline attachment text (backwards compatibility only). */
  attachment_text: string | null;
  /** Owned files to preload as V2 evidence sources before research starts. */
  attachments?: Array<{
    storage_path: string;
    file_name: string;
    mime_type: string;
    size?: number;
  }>;
  /** Owner of the attachment storage paths (ownership check input). */
  attachment_owner_id?: string | null;
  /**
   * Compact, agent-facing description of the preloaded user documents. Filled
   * after preload; survives chunk resume with the rest of the intake.
   */
  attachment_manifest?: Array<{
    source_id: string;
    file_name: string;
    kind: "pdf" | "docx";
    page_count: number;
    head: string;
    docket_match: boolean;
    truncated: boolean;
  }>;
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
  /**
   * Evaluation-only deliverable-level research contract (bake-off harness).
   * Reachable only from the internal smoke/eval entry point; production
   * requests never set it.
   */
  research_contract?: string | null;
  /**
   * What the run terminates in. "answer" (default) = drafter + citation
   * renderer, unchanged. "sources" = deterministic Source Renderer, no
   * answer drafter. Nothing else in the pipeline branches on this.
   */
  output_mode?: "answer" | "sources";
}

export interface ToolBudgets {
  max_agent_steps: number;
  max_search_calls: number;
  max_fetch_calls: number;
  max_lookup_calls: number;
  /**
   * Broad-web (`raw_web_search`) discovery calls. Deliberately small: this is
   * a recovery lane next to the existing research-oriented search, not a
   * second general search budget.
   */
  max_raw_search_calls: number;
}

export const DEFAULT_BUDGETS: ToolBudgets = {
  max_agent_steps: 30,
  max_search_calls: 8,
  max_fetch_calls: 12,
  max_lookup_calls: 6,
  max_raw_search_calls: 3,
};

// ─── Tools ──────────────────────────────────────────────────────────────────

export type SearchScope = "web" | "corpus" | "official" | "academic";

/** What a candidate URL is, as far as deterministic code can tell. */
export type CandidateKind = "document" | "local_document" | "discovery_entry";

export interface ExpectedAuthorityIdentity {
  docket?: string;
  statute?: string;
  section?: string;
}

export interface SearchResult {
  result_id: string;
  title: string;
  url?: string;
  snippet?: string;
  origin: string;
  possible_docket?: string;
  possible_source_type?: string;
  /**
   * Set when this candidate was produced while resolving a NAMED authority.
   * It travels with the candidate so a later `fetch({result_id})` does not
   * depend on the model restating the docket / statute. It is an acquisition
   * TARGET only — binding still requires body corroboration.
   */
  authority_key?: string;
  expected_identity?: ExpectedAuthorityIdentity;
  candidate_kind?: CandidateKind;
  /**
   * Set when this candidate is a row in the local corpus. Its body can be
   * acquired from `legal_documents.content` without any HTTP fetch. Durable
   * candidate metadata only — the model can never supply or override it.
   */
  local_document_id?: string;
  local_match_basis?: "case_number_exact" | "citation_docket" | "title_ilike";
  /** Broad-web discovery metadata (raw_web_search only). Never evidence. */
  domain?: string;
  published_date?: string;
  /** Durable dedupe key of the raw query that produced this candidate. */
  query_key?: string;
}

export interface LookupCandidate {
  /** Durable id: this candidate is fetchable exactly like a search result. */
  result_id?: string;
  label: string;
  kind: "case" | "statute";
  docket?: string;
  statute?: string;
  section?: string;
  url?: string;
  origin: string;
  local_document_id?: string;
  local_match_basis?: "case_number_exact" | "citation_docket" | "title_ilike";
  note?: string;
  authority_key?: string;
  expected_identity?: ExpectedAuthorityIdentity;
  candidate_kind?: CandidateKind;
}

// ─── Evidence store ─────────────────────────────────────────────────────────

export interface IdentityFields {
  dockets: string[];
  statutes: string[];
  sections: string[];
}

/**
 * Identity CONFIRMED by the extracted body alone (body_only_identity_v1).
 *
 * `identity_fields` above is discovery/display metadata and may be polluted by
 * a title or a filename — it claims an identity. Only `body_identity` may
 * confirm one, and only authority verification consumes it.
 */
export interface BodyIdentity {
  /** Canonical docket ids (`raa:3365/20`) found in the identity/header zone. */
  primary_docket_ids: string[];
  /** Canonical docket ids anywhere in the body (incidental citations too). */
  body_docket_ids: string[];
  statutes: string[];
  sections: string[];
  identity_zone_chars: number;
  reversed_pdf_detected: boolean;
  ambiguous: boolean;
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
  /** Body-only confirmed identity. The only identity authority checks trust. */
  body_identity?: BodyIdentity;
  is_actual_document: boolean;
  not_document_reason?: string;
  origin: string;
  fetched_at: string;
  /**
   * Present only for sources preloaded from a user-uploaded file. Carries the
   * provenance a footnote needs (file, page map) and nothing internal is ever
   * shown to the user.
   */
  user_document?: UserDocumentMeta;
  /**
   * Structured bibliographic identity (academic_bibliographic_identity_v1).
   * Identification / attribution / citation only — NEVER evidence of a legal
   * proposition, and never a precondition for a source being usable.
   */
  bibliographic?: BibliographicMetadata;
  /** Evaluation-only acquisition + extraction diagnostics. */
  acquisition_status?: AcquisitionStatus;
  extraction_status?: ExtractionStatus;
  content_type?: string;
  text_quality?: TextQuality;
  pdf_extraction?: PdfExtractionMeta;
}

export interface UserDocumentMeta {
  file_name: string;
  mime_type: string;
  kind: "pdf" | "docx";
  /** Internal storage reference — never rendered, never linked. */
  storage_path: string;
  page_count: number;
  truncated: boolean;
  docket_match: boolean;
  matched_dockets: string[];
  /** Offsets of each page/section inside `extracted_text`. */
  page_map: Array<{ page: number; start: number; end: number }>;
}

// ─── Research memo (agent output) ───────────────────────────────────────────

export interface MemoEvidence {
  source_id: string;
  /**
   * Verbatim span copied from the source body. Optional only because an
   * evidence pair may instead point at a stored quote (`quote_id`), which the
   * server resolves into exactly this field before verification.
   */
  quoted_span?: string;
  /** Id of an excerpt already served from THIS source in this run. */
  quote_id?: string;
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

/**
 * Organizational structure the research agent discovered. It is NEVER
 * evidence: it may only point at claim ids whose propositions went through
 * normal verification. A relationship whose relationship_claim_id fails
 * verification disappears entirely.
 */
export type SynthesisSourceRole =
  | "primary_authority"
  | "scholarship_position"
  | "critique"
  | "historical_context"
  | "comparative_material"
  | "factual_context"
  | "user_document"
  | "other";

export type SynthesisRelationshipKind =
  | "agreement"
  | "disagreement"
  | "development"
  | "contrast"
  | "qualification"
  | "application";

export interface SynthesisSection {
  heading: string;
  purpose?: string;
  claim_ids: string[];
}

export interface SynthesisSourceRole_Entry {
  source_id: string;
  role: SynthesisSourceRole;
  claim_ids: string[];
}

export interface SynthesisRelationship {
  kind: SynthesisRelationshipKind;
  /** The verified claim that CARRIES the substantive relationship statement. */
  relationship_claim_id: string;
  related_claim_ids: string[];
}

export interface ResearchSynthesis {
  sections: SynthesisSection[];
  source_roles: SynthesisSourceRole_Entry[];
  relationships: SynthesisRelationship[];
}

/** Projection of ResearchSynthesis onto the FINAL verified evidence pack. */
export type VerifiedResearchSynthesis = ResearchSynthesis;

/**
 * What the user asked for as a deliverable, as understood by the research
 * agent from the request itself (agent_owned_drafting_brief_v1).
 *
 * WRITING GUIDANCE ONLY. It is never evidence: it cannot assert law, create
 * authority, add a claim or license the drafter to write anything the
 * verified evidence pack does not support. Length targets are soft.
 */
export type DraftingDeliverable =
  | "short_answer"
  | "legal_analysis"
  | "research_answer"
  | "academic_introduction"
  | "academic_body_chapter"
  | "literature_review"
  | "comparative_analysis"
  | "conclusion"
  | "other";

export interface DraftingBrief {
  deliverable: DraftingDeliverable;
  depth: "concise" | "standard" | "deep";
  audience?: "general" | "legal_professional" | "law_student" | "academic";
  target_words?: { min?: number; max?: number };
  goals?: string[];
  structure?: string[];
  emphasis?: string[];
  style?: string;
  limitations?: string[];
}

export interface ResearchMemo {
  issue_summary: string;
  claims: MemoClaim[];
  unresolved_questions: string[];
  research_complete: boolean;
  /** Optional; legacy memos and resumed runs without it work unchanged. */
  research_synthesis?: ResearchSynthesis;
  /** Optional deliverable description handed to the drafter. */
  drafting_brief?: DraftingBrief;
}


// ─── Verification ───────────────────────────────────────────────────────────

export type RejectionReason =
  | "unknown_source_id"
  | "fetch_failed"
  | "empty_body"
  | "not_actual_document"
  | "identity_mismatch"
  | "user_document_not_legal_authority"
  | "span_not_found"
  | "span_too_short"
  | "support_does_not_support"
  | "verifier_unavailable";

/** Verification stage a pair reached before it was rejected. Telemetry only. */
export type VerificationStage = "readable" | "identity" | "span" | "support" | "temporal";

export interface RejectedPair {
  claim_id: string;
  source_id: string;
  reason: RejectionReason;
  detail: string;
  /** Terminal stage of this rejection — never inferred from final-pack membership. */
  stage?: VerificationStage;
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
  /** Carried to the deterministic renderer so a footnote can be a citation. */
  bibliographic?: BibliographicMetadata;
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
  /** Furthest verification stage each source reached (true per-stage funnel). */
  per_source?: Record<string, {
    readable: boolean;
    identity: boolean;
    span: boolean;
    support: boolean;
    identity_basis?: string;
    terminal_stage?: VerificationStage;
    rejection_code?: string;
    rejection_detail?: string;
  }>;
  counters: {
    total_evidence_pairs: number;
    identity_verified_pairs: number;
    span_verified_pairs: number;
    support_verdicts: Record<SupportVerdict, number>;
  };
  /** Evaluation-only: why an uploaded document was / was not legal authority. */
  authority_promotions?: AuthorityPromotionTelemetry[];
}

export type AuthorityPromotionReason =
  | "body_docket_confirmed"
  | "body_statute_confirmed"
  | "no_body_docket"
  | "body_docket_mismatch"
  | "proceeding_type_mismatch"
  | "ambiguous_primary_docket"
  | "body_identity_not_confirmed";

export interface AuthorityPromotionTelemetry {
  source_id: string;
  origin: string;
  expected_docket_ids: string[];
  expected_statutes: string[];
  primary_docket_ids: string[];
  body_docket_ids: string[];
  identity_zone_chars: number;
  reversed_pdf_detected: boolean;
  accepted: boolean;
  reason: AuthorityPromotionReason;
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
  /** Text shown for THIS occurrence (full citation / שם / לעיל ה"ש). */
  citation: string;
  url?: string;
  /** Occurrence bookkeeping (rule 37). Internal — never shown to the user. */
  full_citation?: string;
  first_occurrence?: number;
  repeat_kind?: "full" | "ibid" | "supra";
  locator?: string;
  /** Every verified source cited at this one textual point (compound footnote). */
  source_ids?: string[];
  sources?: Array<{
    source_id: string;
    citation: string;
    full_citation?: string;
    first_occurrence?: number;
    repeat_kind?: "full" | "ibid" | "supra";
    locator?: string;
    url?: string;
  }>;
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

/** Where a readable source stopped contributing (academic_evidence_yield_v1). */
export type SpanYieldOutcome =
  | "VERIFIED"
  | "NOT_ACQUIRED"
  | "UNUSABLE_EXTRACTION"
  | "READ_NO_QUOTE_REQUESTED"
  | "QUOTE_REQUESTED_NO_WINDOW"
  | "WINDOW_SERVED_NOT_MEMOED"
  | "MEMOED_SPAN_NOT_FOUND"
  | "MEMOED_SUPPORT_FAILED";

export type TerminalLossStage =
  | "acquisition"
  | "extraction"
  | "agent_read"
  | "quote_generation"
  | "memo_selection"
  | "span_verification"
  | "support_verification"
  | null;

export interface AcademicSourceYieldRow {
  source_id: string;
  url?: string;
  title?: string;
  academic_source: boolean;
  acquisition_status?: AcquisitionStatus;
  extraction_status?: ExtractionStatus;
  content_type?: string;
  text_chars?: number;
  text_quality?: TextQuality;
  pdf_extraction?: PdfExtractionMeta;
  quotes_served: number;
  memo_evidence_pairs: number;
  span_verified_pairs: number;
  support_verified_pairs: number;
  outcome: SpanYieldOutcome;
  terminal_loss_stage: TerminalLossStage;
  has_bibliographic: boolean;
  metadata_basis?: string[];
  cited: boolean;
}

export interface SourceFunnelRow {
  source_id: string;
  title: string;
  url?: string;
  discovered: boolean;
  fetched: boolean;
  /** Body read and usable as a document. */
  readable?: boolean;
  identity_verified: boolean;
  /** Detail returned by the identity check itself. */
  identity_basis?: string;
  span_verified: boolean;
  support_verified: boolean;
  /** Temporal validity of the claims this source ended up supporting. */
  temporal_ok?: boolean;
  /** Stage where this source's last rejection occurred, from verification. */
  terminal_stage?: VerificationStage;
  rejection_code?: string;
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
  /** Span-hunting discipline (v2_span_hunting_efficiency_v1). */
  targeted_rereads?: number;
  targeted_rereads_new_quote?: number;
  targeted_rereads_no_new_quote?: number;
  span_hunting_exhaustions?: number;
  span_hunting_reads_suppressed?: number;
  new_quotes_served?: number;
  duplicate_quotes_resurfaced?: number;
  authority_reacquisitions_prevented?: number;
  /** Authority-binding safety (v2_acquisition_ledger_verified_authority_binding_v1). */
  authority_bindings_created?: number;
  authority_bindings_withheld?: number;
  context_compactions?: number;
  context_chars_saved?: number;
  /** Statute section acquisition + same-source exhaustion (statute_section_acquisition_v1). */
  section_reads_yielded?: number;
  section_reads_missing?: number;
  sources_marked_exhausted?: number;
  unresolved_authorities?: string[];
  /** Research → drafter synthesis handoff (evaluation only, never quotas). */
  memo_synthesis_sections?: number;
  memo_synthesis_relationships?: number;
  memo_synthesis_source_roles?: number;
  verified_synthesis_sections?: number;
  verified_synthesis_relationships?: number;
  synthesis_claim_refs_dropped?: number;
  synthesis_source_refs_dropped?: number;
  verified_sources_available_to_drafter?: number;
  verified_sources_cited?: number;
  /** Why a research reopen was NOT performed after verification, when it wasn't. */
  repair_skip_reason?: string | null;
  repair_acceptance_reason?: string | null;

  /** Central-issue coverage after narrowing (v2_central_issue_coverage_v1). */
  sufficiency_assessed?: boolean;
  surviving_core_claims?: string[];
  unsupported_core_claims?: string[];
  central_issue_covered?: boolean;
  central_coverage_ratio?: number;
  central_coverage_gap_terms?: string[];
  repair_due_to_central_insufficiency?: boolean;
  /** Evaluation-only forensic verification chain (never shown to end users). */
  verification_forensics?: unknown[];
  verification_forensics_repaired?: unknown[];
  /** Attachments (v2_attachments_v1) — routing + preload observability. */
  pipeline?: string;
  attachment_count?: number;
  attachment_documents_loaded?: number;
  attachment_chars_loaded?: number;
  attachment_extract_errors?: Array<{ file_name: string; message: string }>;
  attachment_sources_preloaded?: string[];
  attachment_sources_cited?: string[];
  attachment_authority_rejections?: number;
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
  /** Academic evidence yield (academic_evidence_yield_v1) — diagnostic only. */
  academic_discovered?: number;
  academic_fetch_attempted?: number;
  academic_acquired?: number;
  academic_extracted_usable?: number;
  academic_quotes_served?: number;
  academic_sources_memoed?: number;
  academic_sources_span_verified?: number;
  academic_sources_support_verified?: number;
  academic_sources_final_pack?: number;
  academic_yield_ratios?: Record<string, number>;
  academic_source_yield?: AcademicSourceYieldRow[];
  /** Bibliographic identity coverage (academic_bibliographic_identity_v1). */
  bibliographic_sources_with_metadata?: number;
  bibliographic_sources_with_authors?: number;
  bibliographic_citations_rendered?: number;
  /** Repository landing pages resolved to their PDF via citation_pdf_url. */
  repository_pdf_followed?: number;
  /** Bounded later-page continuation reads of an academic PDF. */
  pdf_continuation_reads?: number;
  pdf_continuation_chars_added?: number;
  /** Malformed URLs deterministically repaired before fetching. */
  urls_repaired?: number;
  /** Bodies acquired from the stored corpus, with no HTTP fetch. */
  local_corpus_acquisitions?: number;
  local_corpus_bindings?: number;
  /** Broad web search (v2_raw_web_search_v1). */
  raw_web_search_calls?: number;
  raw_web_search_results?: number;
  raw_web_search_unique_domains?: number;
  raw_web_search_deduped_queries?: number;
  raw_web_results_fetched?: number;
  raw_web_identity_rejects?: number;
  /** Bounded authority acquisition (v2_authority_acquisition_orchestrator_v1). */
  authority_targets_opened?: number;
  authority_candidates_attached?: number;
  authority_concrete_attempts?: number;
  authority_discovery_refreshes?: number;
  authority_targets_acquired?: number;
  authority_targets_exhausted?: number;
  authority_candidates_skipped_attempted?: number;
  authority_candidates_skipped_discovery_entry?: number;
  authority_parent_statute_reuse?: number;
  authority_section_from_parent?: number;
  authority_identity_conflicts?: number;
  authority_memo_gate_used?: number;
  /** Exact-authority recovery (v2_exact_authority_recovery_v1). */
  authority_recovery_triggered?: number;
  /** Same-work live recovery (same_work_live_recovery_v1). Diagnostic only. */
  same_work_recovery_triggered?: number;
  same_work_recovery_query_count?: number;
  same_work_candidates_seen?: number;
  same_work_candidates_rejected_identity?: number;
  same_work_candidates_rejected_host?: number;
  same_work_recovery_success?: number;
  same_work_recovery_failed?: number;
  same_work_recovery_failed_reasons?: string[];
  same_work_recovery_skipped_no_identity?: number;
  same_work_recovery_basis?: string[];
  same_work_recovered_host?: string[];
  /** Same-work identity enrichment (same_work_identity_enrichment_v1). */
  same_work_enrichment_triggered?: number;
  same_work_enrichment_landing_meta?: number;
  same_work_enrichment_doi_lookup?: number;
  same_work_enrichment_crossref?: number;
  same_work_enrichment_openalex?: number;
  same_work_enrichment_search_metadata?: number;
  same_work_enrichment_success?: number;
  same_work_enrichment_still_insufficient?: number;
  same_work_enrichment_conflict?: number;
  same_work_recovered_after_enrichment?: number;
  same_work_equivalence_basis?: string[];
  same_work_enrichment_basis?: string[];
  /** Same-work trust boundary (same_work_trust_boundary_v1). */
  same_work_original_identity_trusted_fields?: string[];
  same_work_search_hint_fields?: string[];
  same_work_agent_hint_used_for_query?: number;
  /** Invariant: always 0. */
  same_work_agent_hint_used_for_equivalence?: number;
  /** Pre-memo coverage reflection (agent_owned_coverage_check_v1). Diagnostic only. */
  memo_coverage_check_triggered?: number;
  memo_coverage_unused_read_sources?: number;
  memo_coverage_used_existing_read_source?: number;
  memo_coverage_continued_research?: number;
  memo_coverage_claims_added?: number;
  memo_coverage_gap_left_explicit?: number;
  memo_coverage_reverted_to_pre_check?: number;
  authority_recovery_candidates_attached?: number;
  authority_recovery_success?: number;
  authority_recovery?: Array<Record<string, unknown>>;
  /** Outbound URLs refused by the deterministic safety gate. */
  unsafe_urls_blocked?: number;
  /** Compact per-run egress state (direct official + court relay). */
  egress?: Record<string, unknown>;
}
