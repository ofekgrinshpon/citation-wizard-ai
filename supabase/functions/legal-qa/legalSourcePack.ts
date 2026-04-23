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
  provenance: "local" | "perplexity" | "document";
  excerpt: string;
  case_number?: string;
  usable_for_analysis: boolean;
  usable_for_citation: boolean;
  anchor_present: boolean;
  /** Retrieval similarity (0–1). 0 if absent (e.g. perplexity/document). */
  relevance_score?: number;
}

/** Map the legacy 12-value authority enum to the formal 7-value enum. */
function mapAuthorityClass(
  legacy: string,
  provenance: InternalSourcePackEntry["provenance"],
  url: string | undefined,
): LegalAuthorityClass {
  if (provenance === "document") return "user_document";
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
    authorityClass: mapAuthorityClass(entry.authority_class, entry.provenance, entry.url),
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
    document: 0,
    other: 0,
    promoted_to_core: 0,
  };
  for (const e of entries) {
    if (e.provenance === "perplexity") counts.perplexity++;
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
