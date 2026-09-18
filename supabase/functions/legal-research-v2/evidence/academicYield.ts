/**
 * legal-research-v2 — academic evidence-yield accounting
 * (academic_evidence_yield_v1).
 *
 * Diagnostic only. Nothing here gates evidence, changes verification, or
 * imposes a source quota. Its single job is to answer, per source, the
 * question the literature-review acceptance could not:
 *
 *   "this document was read — so where exactly did it stop contributing?"
 */

import type {
  AcademicSourceYieldRow,
  EvidenceSource,
  ResearchMemo,
  SpanYieldOutcome,
  TerminalLossStage,
  VerifiedEvidencePack,
  VerificationOutcome,
} from "../types.ts";
import type { ServedQuote } from "./quotable.ts";

/**
 * Deterministic "this is scholarship" signal, from the URL/host shape only.
 * It is a TELEMETRY label: nothing about how a source is fetched, read,
 * verified or cited depends on it.
 */
export function looksAcademicSource(src: { url?: string; origin?: string }): boolean {
  if ((src.origin ?? "").includes("academic")) return true;
  const url = (src.url ?? "").toLowerCase();
  if (!url) return false;
  return /(\.ac\.il|\.edu|lawjournal|lawreview|law-review|journals?\.|journal\.|scholarship|scholarlycommons|digitalcommons|repository|ssrn|jstor|heinonline|cambridge\.org|oup\.com|tandfonline|papers\.|ecgi\.org|nber\.org)/
    .test(url);
}

function outcomeFor(args: {
  src: EvidenceSource;
  quotes: number;
  memoPairs: number;
  spanPairs: number;
  supportPairs: number;
}): { outcome: SpanYieldOutcome; stage: TerminalLossStage } {
  const { src, quotes, memoPairs, spanPairs, supportPairs } = args;
  if (src.fetch_status !== "ok") return { outcome: "NOT_ACQUIRED", stage: "acquisition" };
  if (!src.is_actual_document || src.extraction_status === "empty" || src.extraction_status === "failed") {
    return { outcome: "UNUSABLE_EXTRACTION", stage: "extraction" };
  }
  if (supportPairs > 0) return { outcome: "VERIFIED", stage: null };
  if (spanPairs > 0) return { outcome: "MEMOED_SUPPORT_FAILED", stage: "support_verification" };
  if (memoPairs > 0) return { outcome: "MEMOED_SPAN_NOT_FOUND", stage: "span_verification" };
  if (quotes > 0) return { outcome: "WINDOW_SERVED_NOT_MEMOED", stage: "memo_selection" };
  return { outcome: "READ_NO_QUOTE_REQUESTED", stage: "quote_generation" };
}

export interface AcademicYieldReport {
  rows: AcademicSourceYieldRow[];
  counters: Record<string, number>;
  ratios: Record<string, number>;
}

export function buildAcademicYield(args: {
  sources: EvidenceSource[];
  quotes: ServedQuote[];
  memo: ResearchMemo | null | undefined;
  verification: VerificationOutcome | null | undefined;
  pack: VerifiedEvidencePack | null | undefined;
  cited_source_ids: string[];
}): AcademicYieldReport {
  const quotesBySource = new Map<string, number>();
  for (const q of args.quotes ?? []) {
    quotesBySource.set(q.source_id, (quotesBySource.get(q.source_id) ?? 0) + 1);
  }
  const memoPairs = new Map<string, number>();
  for (const c of args.memo?.claims ?? []) {
    for (const ev of c.evidence ?? []) {
      memoPairs.set(ev.source_id, (memoPairs.get(ev.source_id) ?? 0) + 1);
    }
  }
  const per = args.verification?.per_source ?? {};
  const supportPairs = new Map<string, number>();
  for (const c of args.pack?.claims ?? []) {
    for (const s of c.sources) {
      supportPairs.set(s.source_id, (supportPairs.get(s.source_id) ?? 0) + 1);
    }
  }
  const cited = new Set(args.cited_source_ids ?? []);

  const rows: AcademicSourceYieldRow[] = [];
  for (const src of args.sources) {
    const quotes = quotesBySource.get(src.source_id) ?? 0;
    const memo = memoPairs.get(src.source_id) ?? 0;
    const spanOk = per[src.source_id]?.span === true;
    const support = supportPairs.get(src.source_id) ?? 0;
    const spanPairs = support > 0 ? Math.max(support, spanOk ? 1 : 0) : (spanOk ? 1 : 0);
    const { outcome, stage } = outcomeFor({
      src,
      quotes,
      memoPairs: memo,
      spanPairs,
      supportPairs: support,
    });
    rows.push({
      source_id: src.source_id,
      url: src.url,
      title: src.title,
      academic_source: looksAcademicSource(src),
      acquisition_status: src.acquisition_status,
      extraction_status: src.extraction_status,
      content_type: src.content_type,
      text_chars: src.text_length,
      text_quality: src.text_quality,
      pdf_extraction: src.pdf_extraction,
      quotes_served: quotes,
      memo_evidence_pairs: memo,
      span_verified_pairs: spanPairs,
      support_verified_pairs: support,
      outcome,
      terminal_loss_stage: stage,
      has_bibliographic: !!src.bibliographic,
      metadata_basis: src.bibliographic?.metadata_basis,
      cited: cited.has(src.source_id),
    });
  }

  const acad = rows.filter((r) => r.academic_source);
  const count = (fn: (r: AcademicSourceYieldRow) => boolean) => acad.filter(fn).length;
  const counters = {
    academic_discovered: acad.length,
    academic_fetch_attempted: count((r) => r.acquisition_status !== "not_attempted"),
    academic_acquired: count((r) => r.acquisition_status === "acquired"),
    academic_extracted_usable: count((r) => r.extraction_status === "usable"),
    academic_quotes_served: count((r) => r.quotes_served > 0),
    academic_sources_memoed: count((r) => r.memo_evidence_pairs > 0),
    academic_sources_span_verified: count((r) => r.span_verified_pairs > 0),
    academic_sources_support_verified: count((r) => r.support_verified_pairs > 0),
    academic_sources_final_pack: count((r) => r.support_verified_pairs > 0),
    bibliographic_sources_with_metadata: count((r) => r.has_bibliographic),
  };
  const ratio = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) / 100 : 0);
  const ratios = {
    acquisition_yield: ratio(counters.academic_acquired, counters.academic_fetch_attempted),
    extraction_yield: ratio(counters.academic_extracted_usable, counters.academic_acquired),
    quote_yield: ratio(counters.academic_quotes_served, counters.academic_extracted_usable),
    span_yield: ratio(counters.academic_sources_span_verified, counters.academic_sources_memoed),
    support_yield: ratio(
      counters.academic_sources_support_verified,
      counters.academic_sources_span_verified,
    ),
    read_to_verified_source_yield: ratio(
      counters.academic_sources_support_verified,
      counters.academic_extracted_usable,
    ),
  };
  return { rows, counters, ratios };
}
