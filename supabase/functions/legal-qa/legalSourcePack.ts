// Assembles the formal `LegalSourcePack` contract from the internal
// `SourcePackEntry[]` already built in `index.ts`. Splits into 3 groups
// (core / supporting / secondary) by authority class, and remaps fields
// from snake_case to camelCase. INTERNAL ONLY — never serialized to UI.

import type {
  LegalAuthorityClass,
  LegalProvenanceInternal,
  LegalSourcePack,
  LegalSourcePackItem,
} from "./contracts.ts";

// Subset of the internal SourcePackEntry shape used in index.ts.
// Defined inline to avoid a circular import.
export interface InternalSourcePackEntry {
  source_id: number;
  title: string;
  source_type: string;
  authority_class: string;            // legacy 12-value enum from index.ts
  url?: string;
  provenance: "local" | "perplexity" | "perplexity_completion" | "claim_verified_recall" | "document";
  excerpt: string;
  case_number?: string;
  usable_for_analysis: boolean;
  usable_for_citation: boolean;
  anchor_present: boolean;
  /** Retrieval similarity (0–1). 0 if absent (e.g. perplexity/document). */
  relevance_score?: number;
  /**
   * Milestone B — for perplexity_completion entries only. Declares the
   * primary-source type the AG-style guard accepted. Used by mapAuthorityClass
   * to skip the URL-based fallback and route directly to primary_legislation /
   * primary_caselaw, since these candidates are verified-source-matched.
   */
  completion_candidate_type?: "statute" | "caselaw";
  /** Fix C — true docket prefix (בג"ץ, ע"א, …) for case-law entries. */
  docket_prefix?: string;
  /** Fix C — broad subject category (משפחה, פלילי, …) when procedure_type
   *  isn't a docket-shaped prefix. */
  procedure_category?: string;
}

/** Map the legacy 12-value authority enum to the formal 7-value enum. */
function mapAuthorityClass(
  legacy: string,
  provenance: InternalSourcePackEntry["provenance"],
  url: string | undefined,
  completionType?: "statute" | "caselaw",
): LegalAuthorityClass {
  if (provenance === "document") return "user_document";
  // Recall-vs-Proof: claim_verified_recall items are local chunks promoted via
  // per-claim relevance. They keep their legacy authority mapping (so case-law
  // candidates land in primary_caselaw, knesset_research in secondary_official,
  // etc.). Fall through to the legacy switch below.
  // Milestone B: perplexity_completion candidates have already passed the
  // citation-shape regex + URL allowlist guards in runPerplexityCompletion
  // (see index.ts). Their declared type is therefore trusted and they go
  // directly to primary authority, bypassing the URL-based fallback.
  if (provenance === "perplexity_completion") {
    if (completionType === "statute") return "primary_legislation";
    if (completionType === "caselaw") return "primary_caselaw";
    // Defensive: if a completion candidate slipped through without a type,
    // refuse to promote it. Better to demote to external_reference than to
    // wrongly elevate something the guard couldn't classify.
    return "external_reference";
  }
  switch (legacy) {
    case "primary_legislation":
    case "basic_law":
      return "primary_legislation";
    case "supreme_court":
    case "district_court":
    case "labor_court":
      return "primary_caselaw";
    case "knesset_research":
    case "protocol":
      return "secondary_official";
    case "academic_book":
    case "academic_article":
      return "secondary_academic";
    case "external_web":
      return "external_reference";
    case "document":
      return "user_document";
    case "other":
    default:
      return url ? "external_reference" : "unknown";
  }
}

function mapProvenance(
  p: InternalSourcePackEntry["provenance"],
): LegalProvenanceInternal {
  return p ?? "unknown";
}

/** Convert a single internal entry to the formal contract item. */
function toItem(entry: InternalSourcePackEntry): LegalSourcePackItem {
  return {
    sourceId: `src-${entry.source_id}`,
    title: entry.title,
    sourceType: entry.source_type,
    authorityClass: mapAuthorityClass(
      entry.authority_class,
      entry.provenance,
      entry.url,
      entry.completion_candidate_type,
    ),
    url: entry.url,
    caseNumber: entry.case_number,
    excerpt: entry.excerpt,
    anchorPresent: entry.anchor_present,
    usableForAnalysis: entry.usable_for_analysis,
    usableForCitation: entry.usable_for_citation,
    provenanceInternal: mapProvenance(entry.provenance),
    relevanceScore: entry.relevance_score,
  };
}

/**
 * Milestone A.5 — Promotion threshold for non-primary local sources.
 * 0.55 mirrors the rerank floor in index.ts: anything below 0.55 wouldn't be
 * in the candidate set in the first place. Promotion starts well above floor.
 */
const PROMOTION_THRESHOLD = 0.55;

/** Build the 3-group `LegalSourcePack` from internal entries. */
export function assembleSourcePack(entries: InternalSourcePackEntry[]): LegalSourcePack {
  const core: LegalSourcePackItem[] = [];
  const supporting: LegalSourcePackItem[] = [];
  const secondary: LegalSourcePackItem[] = [];
  for (const raw of entries) {
    const item = toItem(raw);

    // Milestone A.5: promote knesset_research / journal_article from
    // `supporting` → `core` ONLY when locally retrieved, anchored, substantive,
    // AND topically relevant (relevance_score >= PROMOTION_THRESHOLD).
    // Without the relevance gate, a passing-mention chunk would land in core.
    const isPromotable =
      (item.authorityClass === "secondary_official" ||   // knesset_research
       item.authorityClass === "secondary_academic") &&  // journal_article
      item.anchorPresent &&
      item.usableForAnalysis &&
      (item.relevanceScore ?? 0) >= PROMOTION_THRESHOLD &&
      item.provenanceInternal === "local";

    if (isPromotable) {
      core.push(item);
      continue;
    }

    switch (item.authorityClass) {
      case "primary_legislation":
      case "primary_caselaw":
      case "user_document":
        core.push(item);
        break;
      case "secondary_official":
      case "secondary_academic":
        supporting.push(item);
        break;
      case "external_reference":
      case "unknown":
      default:
        secondary.push(item);
        break;
    }
  }
  return { coreSources: core, supportingSources: supporting, secondarySources: secondary };
}

export interface SourcePackSummary {
  core: number;
  supporting: number;
  secondary: number;
  anchored: number;
}

export function summarizeSourcePack(pack: LegalSourcePack): SourcePackSummary {
  let anchored = 0;
  for (const group of [pack.coreSources, pack.supportingSources, pack.secondarySources]) {
    for (const it of group) if (it.anchorPresent) anchored++;
  }
  return {
    core: pack.coreSources.length,
    supporting: pack.supportingSources.length,
    secondary: pack.secondarySources.length,
    anchored,
  };
}

/**
 * Milestone A.5 — Per-source-type counts for diagnostic exposure.
 * Surfaces in qa_logs.metadata.source_type_counts so admins can answer
 * "did the model receive enough core authority?" in a single SQL query
 * (e.g. {caselaw: 6, israeli_law: 2, knesset_research: 3, journal_article: 1,
 *        perplexity: 4, document: 0}).
 */
export interface SourceTypeCounts {
  caselaw: number;
  israeli_law: number;
  knesset_research: number;
  journal_article: number;
  perplexity: number;
  /** Milestone B — verified primary sources recovered via Perplexity completion. */
  perplexity_completion: number;
  document: number;
  other: number;
  /** Of the above, how many landed in `core` after the A.5 promotion gate. */
  promoted_to_core: number;
}

export function countSourcesByType(
  entries: InternalSourcePackEntry[],
  pack: LegalSourcePack | null,
): SourceTypeCounts {
  const counts: SourceTypeCounts = {
    caselaw: 0,
    israeli_law: 0,
    knesset_research: 0,
    journal_article: 0,
    perplexity: 0,
    perplexity_completion: 0,
    document: 0,
    other: 0,
    promoted_to_core: 0,
  };
  for (const e of entries) {
    if (e.provenance === "perplexity_completion") counts.perplexity_completion++;
    else if (e.provenance === "perplexity") counts.perplexity++;
    else if (e.provenance === "document") counts.document++;
    else if (e.source_type === "caselaw" || e.source_type === "פסיקה") counts.caselaw++;
    else if (e.source_type === "israeli_law" || e.source_type === "חקיקה ישראלית") counts.israeli_law++;
    else if (e.source_type === "knesset_research" || e.source_type === "מחקר כנסת / חקיקה") counts.knesset_research++;
    else if (e.source_type === "journal_article" || e.source_type === "מאמר אקדמי") counts.journal_article++;
    else counts.other++;
  }
  if (pack) {
    // Of the core items, count how many came from the A.5 promotion path
    // (i.e. local secondary_official / secondary_academic that crossed the gate).
    for (const it of pack.coreSources) {
      if (
        it.provenanceInternal === "local" &&
        (it.authorityClass === "secondary_official" || it.authorityClass === "secondary_academic")
      ) {
        // The mapping in toItem keeps authorityClass as-is for these; promotion
        // is bucket-only. So this branch counts true promotions.
        counts.promoted_to_core++;
      }
    }
  }
  return counts;
}
