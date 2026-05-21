// Research Core v1 — Core-only Citation Enrichment layer.
//
// Single entrypoint for all per-source enrichment work. Owns the full flow:
//
//   Verified LedgerSource
//     → collectFields  (title / citation / snippet / url / metadata /
//                       source_type / origin / reporter / pinpoint /
//                       merged with per-pass `recovered` hints)
//     → normalizeSourceType
//     → extractStructured  (source-type-aware regex; reuses citationCleanup
//                           helpers; lives inside `buildCitationForSource`)
//     → citation engine  (resolveCitation, via buildCitationForSource)
//     → manualPartialEmit  (LAST RESORT only — when the engine couldn't
//                           format verified docket + parties)
//
// Rules:
//   - The citation engine is the ONLY formatter. We never invent fields.
//   - No GPT / LLM calls live here. Regex + structured metadata only.
//   - `manualPartialEmit` runs ONLY when:
//        passLabel !== "initial"
//        AND declared === "caselaw"
//        AND engine result is bare-reporter / unresolved
//        AND recovered.caseNumber + recovered.party1 + recovered.party2 exist
//     It writes only values already present in `recovered`. No invention.
//
// All four post-initial passes in runCore.ts (metadata / text_regex /
// official_fetch / party_lookup) MUST go through `enrichLedgerSource` —
// they do not call the engine directly.

import {
  enrichBareReporterCitationWithDebug,
  type EnrichmentDebug,
} from "./citations.ts";
import { cleanCitationText, isBareReporter } from "./citationCleanup.ts";
import type { LedgerSource, LedgerSourceCitation } from "./types.ts";

export type PassLabel =
  | "initial"
  | "metadata"
  | "text_regex"
  | "official_fetch"
  | "party_lookup";

/**
 * Structured fields a pass has independently recovered for a LedgerSource.
 * Only verified values — never inferred by an LLM.
 */
export interface RecoveredFields {
  caseNumber?: string;
  /** Hebrew docket prefix (e.g. `בג"ץ`, `ע"א`, `רע"א`). */
  caseType?: string;
  party1?: string;
  party2?: string;
  year?: string;
  fullDate?: string;
  // Reserved for future legislation enrichment:
  // lawName?: string; hebrewYear?: string; gregorianYear?: string;
  // collection?: string; firstPage?: string;
}

export interface EnrichmentInput {
  ls: LedgerSource;
  recovered?: RecoveredFields;
  passLabel: Exclude<PassLabel, "initial">;
}

export type EnrichmentPath = "engine" | "manual_partial" | "engine_unresolved";

export interface EnrichmentOutput {
  citation: LedgerSourceCitation;
  debug: EnrichmentDebug & { enrichment_path: EnrichmentPath };
}

/**
 * Take a verified LedgerSource + any structured fields the caller pass has
 * recovered, hand them to the citation engine, and — only as a last resort —
 * synthesize a `partial_enriched` canonical from the verified docket + parties.
 *
 * Returns the new `LedgerSourceCitation` and a debug envelope including which
 * path produced the final citation.
 */
export function enrichLedgerSource(
  { ls, recovered, passLabel }: EnrichmentInput,
): EnrichmentOutput {
  // 1) Engine call. `enrichBareReporterCitationWithDebug` already forces
  //    enrichmentRetry=true (so the resolver runs in placeholder-emission +
  //    relaxed-fullDate mode). It returns the citation built by the engine
  //    plus a debug envelope describing resolver inputs/outputs.
  const { citation, debug } = enrichBareReporterCitationWithDebug(ls, {
    caseNumber: recovered?.caseNumber,
    caseType: recovered?.caseType,
    party1: recovered?.party1,
    party2: recovered?.party2,
    year: recovered?.year,
    fullDate: recovered?.fullDate,
  });

  // 2) Decide the enrichment path.
  let enrichment_path: EnrichmentPath;
  const stillBare = citation.citation_errors.includes("failed_bare_reporter");
  const isCaselaw = citation.declared_type === "caselaw";

  const hasVerifiedCaselawParts =
    isCaselaw &&
    !!recovered?.caseNumber?.trim() &&
    !!recovered?.party1?.trim() &&
    !!recovered?.party2?.trim();

  if (stillBare && hasVerifiedCaselawParts) {
    // 3) manualPartialEmit — LAST RESORT.
    //    The engine couldn't format a canonical even with placeholder mode,
    //    but we have verified docket + both parties. Synthesize a minimal
    //    canonical line from ONLY those fields. Never invent year/date.
    manualPartialEmit(citation, recovered!);
    enrichment_path = "manual_partial";
  } else if (stillBare) {
    enrichment_path = "engine_unresolved";
  } else {
    enrichment_path = "engine";
  }

  return {
    citation,
    debug: { ...debug, enrichment_path },
  };
}

/**
 * Mutate `citation` in place to carry a manually-emitted caselaw canonical
 * built from verified `recovered` fields. Strips the bare-reporter / engine
 * failure markers, sets `partial_enriched`, marks `quality = needs_review`,
 * and records `placeholder:fullDate` when neither fullDate nor year were
 * available. No field is ever invented.
 */
function manualPartialEmit(
  citation: LedgerSourceCitation,
  recovered: RecoveredFields,
): void {
  const docket = recovered.caseNumber!.trim();
  const p1 = recovered.party1!.trim();
  const p2 = recovered.party2!.trim();
  const yearOrDate = recovered.fullDate?.trim()
    ? ` (${recovered.fullDate.trim()})`
    : recovered.year?.trim()
    ? ` (${recovered.year.trim()})`
    : "";

  const canonical = cleanCitationText(`${docket} ${p1} נ' ${p2}${yearOrDate}.`);

  // Defensive: if for any reason the synthesized line still reads as bare,
  // abort the rewrite — `engine_unresolved` is preferable to a fake fix.
  if (isBareReporter(canonical)) return;

  citation.canonical_citation = canonical;
  citation.citation_quality = "needs_review";

  // Strip prior failure markers; this no longer reads as bare-reporter.
  const filtered = citation.citation_errors.filter((e) =>
    e !== "failed_bare_reporter" &&
    !e.startsWith("engine:") &&
    !e.startsWith("missing:")
  );
  citation.citation_errors = filtered;
  if (!citation.citation_errors.includes("partial_enriched")) {
    citation.citation_errors.push("partial_enriched");
  }
  if (!yearOrDate && !citation.citation_errors.includes("placeholder:fullDate")) {
    citation.citation_errors.push("placeholder:fullDate");
  }
}
