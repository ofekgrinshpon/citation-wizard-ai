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
  | "document"
  | "verified"
  | "unknown";

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
] as const;
