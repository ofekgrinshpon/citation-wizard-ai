/**
 * legal-research-v2 — durable quote references (durable_quote_references_v1).
 *
 * The research agent used to be able to support a claim only by re-sending the
 * literal text of an excerpt. After context compaction that text is gone, so a
 * source it genuinely read could no longer be used — the run lost evidence it
 * already held.
 *
 * A memo evidence pair may therefore point at a quote the evidence store
 * already holds:
 *
 *     { source_id: "S6", quote_id: "S6-q17", reason: "..." }
 *
 * TRUST BOUNDARY — a quote_id is NOT new evidence:
 *   • it can only resolve to text that was extracted from that source's stored
 *     body and served earlier in this run;
 *   • the resolved text comes from the store, never from the model;
 *   • a quote belonging to another source is refused;
 *   • an unknown id is refused — nothing is ever invented as a fallback.
 *
 * Resolution happens BEFORE verification and produces an ordinary
 * `quoted_span`, so the verifier (body read → identity → span → support) runs
 * completely unchanged.
 */

import type { MemoClaim, MemoEvidence, ResearchMemo } from "../types.ts";
import type { EvidenceStore } from "./evidenceStore.ts";

export interface QuoteResolutionStats {
  /** Evidence pairs that referenced a stored quote by id. */
  quote_ids_referenced_in_memo: number;
  /** Pairs whose quoted_span came from the store via a quote_id. */
  memo_evidence_resolved_from_quote_id: number;
  /** quote_id not present in the evidence store. */
  invalid_quote_id: number;
  /** quote_id exists but belongs to a different source_id. */
  quote_source_mismatch: number;
  /** Pairs dropped because neither a resolvable quote_id nor a span remained. */
  memo_evidence_dropped_unresolvable: number;
}

export function emptyQuoteResolutionStats(): QuoteResolutionStats {
  return {
    quote_ids_referenced_in_memo: 0,
    memo_evidence_resolved_from_quote_id: 0,
    invalid_quote_id: 0,
    quote_source_mismatch: 0,
    memo_evidence_dropped_unresolvable: 0,
  };
}

function resolvePair(
  ev: MemoEvidence,
  store: EvidenceStore,
  stats: QuoteResolutionStats,
): MemoEvidence | null {
  const legacySpan = String(ev.quoted_span ?? "").trim();
  const quoteId = String(ev.quote_id ?? "").trim();
  if (!quoteId) {
    if (legacySpan) return { ...ev, quoted_span: legacySpan };
    stats.memo_evidence_dropped_unresolvable += 1;
    return null;
  }
  stats.quote_ids_referenced_in_memo += 1;
  const quote = store.quote(quoteId);
  if (!quote) {
    stats.invalid_quote_id += 1;
  } else if (quote.source_id !== ev.source_id) {
    stats.quote_source_mismatch += 1;
  } else {
    stats.memo_evidence_resolved_from_quote_id += 1;
    // Store text wins: the model never controls the text a quote_id yields.
    return { ...ev, quote_id: quoteId, quoted_span: quote.text };
  }
  // A refused quote_id never becomes text. The pair survives only if the
  // agent also sent a literal span, which then faces the unchanged span check.
  if (legacySpan) return { ...ev, quote_id: undefined, quoted_span: legacySpan };
  stats.memo_evidence_dropped_unresolvable += 1;
  return null;
}

/**
 * Resolve every quote_id in a memo into an ordinary verbatim `quoted_span`.
 * Legacy memos that carry only `quoted_span` pass through byte-identical.
 */
export function resolveMemoQuoteRefs(
  memo: ResearchMemo | null,
  store: EvidenceStore,
): { memo: ResearchMemo | null; stats: QuoteResolutionStats } {
  const stats = emptyQuoteResolutionStats();
  if (!memo) return { memo, stats };
  const claims: MemoClaim[] = memo.claims.map((c) => ({
    ...c,
    evidence: (c.evidence ?? [])
      .map((ev) => resolvePair(ev, store, stats))
      .filter((ev): ev is MemoEvidence => ev !== null),
  }));
  return { memo: { ...memo, claims }, stats };
}
