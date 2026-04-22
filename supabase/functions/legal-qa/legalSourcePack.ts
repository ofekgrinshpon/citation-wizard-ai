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
  };
}

/** Build the 3-group `LegalSourcePack` from internal entries. */
export function assembleSourcePack(entries: InternalSourcePackEntry[]): LegalSourcePack {
  const core: LegalSourcePackItem[] = [];
  const supporting: LegalSourcePackItem[] = [];
  const secondary: LegalSourcePackItem[] = [];
  for (const raw of entries) {
    const item = toItem(raw);
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
