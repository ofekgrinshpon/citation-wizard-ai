// Research Core v1 — shared contracts.
// Internal name: "core_v1". Nothing here imports from V2/V3/V4 modules.

export type ClaimId = `C${number}`;
export type AuthorityId = `A${number}`;
export type CandidateId = string;
export type LedgerSourceId = `LS${number}`;

// ─────────────────── Step 1: Planner ───────────────────

export type EvidenceKind =
  | "binding_caselaw"
  | "persuasive_caselaw"
  | "statute_section"
  | "regulation"
  | "scholarship"
  | "doctrinal_definition";

export type SourceTypeFilter = "caselaw" | "legislation" | "scholarship" | null;

export interface SearchTarget {
  hebrew_terms: string[];
  doctrine: string;
  source_type_filter?: SourceTypeFilter;
}

export interface ExpectedAuthority {
  id: AuthorityId;
  type: "caselaw" | "statute" | "regulation" | "scholarship";
  name: string;
  docket?: string;
  section?: string;
  year?: string;
  why_central: string;
}

export interface Claim {
  id: ClaimId;
  text: string;
  required_evidence: EvidenceKind[];
  search_targets: SearchTarget[];
  supporting_authorities: AuthorityId[];
}

export interface PlanV1 {
  doctrinal_frame: string;
  thesis: string;
  claims: Claim[];
  expected_authorities: ExpectedAuthority[];
}

// ─────────────────── Step 2: Retrieval ───────────────────

export type CandidateOrigin =
  | "local_text"
  | "local_vector"
  | "exact_authority"
  | "approved_web";

export interface CandidateSource {
  candidate_id: CandidateId;
  claim_id: ClaimId;
  origin: CandidateOrigin;
  document_id?: string;
  source_type: string;
  title: string;
  citation: string;
  url?: string;
  snippet: string;
  metadata: Record<string, unknown>;
}

// ─────────────────── Step 3: Verifier ───────────────────

export type Support = "direct" | "partial" | "tangential" | "unrelated";

export interface Verdict {
  candidate_id: CandidateId;
  support: Support;
  rationale: string;
  pinpoint?: string;
}

export interface VerificationResult {
  claim_id: ClaimId;
  verdicts: Verdict[];
}

// ─────────────────── Step 4: Ledger ───────────────────

export type LedgerStatus = "supported" | "hedged" | "unsupported";

export interface LedgerSource {
  ls_id: LedgerSourceId;
  candidate_id: CandidateId;
  claim_id: ClaimId;
  origin: CandidateOrigin;
  support: "direct" | "partial";
  pinpoint?: string;
  title: string;
  citation: string;
  url?: string;
  domain?: string;
  snippet: string;
  source_type: string;
  document_id?: string;
  normalized_key: string;
  is_primary: boolean;
}

export interface LedgerEntry {
  claim_id: ClaimId;
  text: string;
  status: LedgerStatus;
  direct_count: number;
  partial_count: number;
  sources: LedgerSource[];
}

export interface LedgerInvariants {
  unresolved_authorities_in_ledger: number;  // must be 0
  tangential_or_unrelated_in_ledger: number; // must be 0
  duplicates_dropped: number;
}

export interface LedgerTotals {
  supported: number;
  hedged: number;
  unsupported: number;
  sources: number;
  primary_sources: number;
  secondary_sources: number;
  by_origin: Record<CandidateOrigin, number>;
}

export interface LedgerResult {
  entries: LedgerEntry[];                    // supported + hedged only
  unsupported_claim_ids: ClaimId[];
  unresolved_authority_ids: AuthorityId[];
  totals: LedgerTotals;
  invariants: LedgerInvariants;
  duration_ms: number;
}

export type Ledger = LedgerEntry[];


// ─────────────────── Step 6: Canonical Citation + Footnotes + Quality ─────

export type CitationQuality = "ok" | "partial" | "failed" | "needs_review";

export interface ShortFormInputs {
  is_legislation: boolean;
  law_name?: string;
  short_label?: string;
  default_section?: string;
  default_pinpoint?: string;
}

export interface LedgerSourceCitation {
  ls_id: LedgerSourceId;
  source_type: string;
  declared_type: "statute" | "caselaw" | "none";
  canonical_citation: string;
  citation_quality: CitationQuality;
  citation_errors: string[];
  placeholders: string[];
  engine_used: "resolver" | "passthrough" | "none";
  short_form_inputs: ShortFormInputs;
}

export type RemovalReason =
  | "quality_failed"
  | "off_domain"
  | "placeholder"
  | "malformed"
  | "duplicate_secondary";

export interface Footnote {
  number: number;
  ls_id: LedgerSourceId;
  text: string;
  is_repeated: boolean;
  first_footnote_number?: number;
  repeated_citation_text?: string;
  source_type: string;
  url?: string;
  /** Where the footnote text came from. Telemetry only. */
  footnote_text_source?: "canonical_citation" | "repeated_rule37" | "passthrough_fallback";
  /** True if this footnote text came from an enrichment safety-net rebuild. */
  partial_enriched_used_in_footnote?: boolean;
}

export interface MarkerToFootnote {
  occurrence_index: number;
  ls_id: LedgerSourceId;
  /** Undefined for skipped occurrences (unknown LS / dropped citation). */
  footnote_number: number | undefined;
  is_repeated: boolean;
  first_footnote_number?: number;
}

export interface FlaggedFootnote {
  number: number;
  ls_id: LedgerSourceId;
  reason: string;
}

export interface RemovedCitation {
  ls_id: LedgerSourceId;
  claim_id?: ClaimId;
  reason: string;
}

export type CitationQualityStatus =
  | "ok"
  | "needs_review"
  | "insufficient_verified_sources";

export interface CitationQualityResult {
  status: CitationQualityStatus;
  rendered_answer: string;
  footnotes: Footnote[];
  marker_to_footnote: MarkerToFootnote[];
  removed_citations: RemovedCitation[];
  flagged_footnotes: FlaggedFootnote[];
  claims_lost_all_support: ClaimId[];
  citation_summary: {
    ok: number;
    partial: number;
    failed: number;
    off_domain: number;
    repeated: number;
    legislation_supra_blocked: number;
    partial_enriched_kept: number;
    footnote_text_sources: {
      canonical_citation: number;
      repeated_rule37: number;
      passthrough_fallback: number;
    };
  };
  duration_ms: number;
}

// ─────────────────── Telemetry ───────────────────

export interface StageRun {
  stage: string;
  duration_ms: number;
  status: "ok" | "error" | "empty";
  model?: string;
  error?: string;
}

export interface CoreMetadata {
  version: "core_v1";
  plan: PlanV1;
  retrieval: {
    per_claim: Array<{
      claim_id: ClaimId;
      local_text_count: number;
      local_vector_count: number;
      exact_authority_count: number;
      approved_web_count: number;
      approved_web_domains: string[];
      web_verified_direct: number;
      web_verified_partial: number;
      web_rejected: number;
      candidate_ids: CandidateId[];
    }>;
    total_candidates: number;
    total_web_candidates: number;
    web_global_cap_hit: boolean;
  };
  verification: Array<{
    claim_id: ClaimId;
    verdict_counts: Record<Support, number>;
  }>;
  ledger: {
    supported: ClaimId[];
    hedged: ClaimId[];
    unsupported: ClaimId[];
  };
  citation_pass: {
    before: number;
    after: number;
    removed: Array<{ candidate_id: CandidateId; reason: RemovalReason }>;
  };
  stage_runs: StageRun[];
  total_duration_ms: number;
}

export type CoreResult =
  | {
      ok: true;
      answer: string;
      footnotes: Footnote[];
      metadata: { core: CoreMetadata };
    }
  | {
      ok: false;
      reason:
        | "insufficient_verified_sources"
        | "planner_failed"
        | "drafter_empty";
      answer: string;
      footnotes: [];
      metadata: { core: CoreMetadata };
    };
