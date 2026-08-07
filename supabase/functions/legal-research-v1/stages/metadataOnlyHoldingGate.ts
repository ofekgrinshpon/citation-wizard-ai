// metadata_only_holding_gate_v1 — deterministic gate that prevents a drafted
// answer from resting a case holding / doctrinal proposition on a judgment
// source whose body was never acquired (metadata-only: title, caption, docket,
// listing page).
//
// Scope: post-model, pre-footnote. It rewrites the validated StructuredDraft's
// source_refs only. It never changes prose, never touches retrieval,
// sufficiency, or the drafter prompt/model.
//
// Rule: a source may carry a case-law proposition only when it is a judgment
// document whose body text was acquired (full_text / substantive_excerpt /
// holding_text, or has_holding_text === true). Metadata-only judgment sources
// are demoted to "reference only — case located, body not read" and are
// removed from proposition footnotes.

import type { StructuredDraft } from "./structuredValidation.ts";

const BODY_ACQUIRED_USABILITY = new Set([
  "full_text",
  "substantive_excerpt",
  "holding_text",
]);

export interface GateSourceLike {
  ref: string;
  candidate_id: string;
  title: string;
  url: string | null;
  source_type?: string;
  citable_as?: string;
  text_usability?: string;
  is_judgment_document?: boolean;
  has_holding_text?: boolean;
}

/** True when the source is a judgment document (by classification or type). */
export function isJudgmentSource(s: GateSourceLike): boolean {
  if (String(s.citable_as ?? "") === "judgment") return true;
  if (s.is_judgment_document === true) return true;
  return false;
}

/** True when the judgment body text was actually acquired. */
export function bodyAcquired(s: GateSourceLike): boolean {
  if (s.has_holding_text === true) return true;
  return BODY_ACQUIRED_USABILITY.has(String(s.text_usability ?? "").toLowerCase());
}

/** A judgment source that was located but whose body was never read. */
export function isMetadataOnlyJudgment(s: GateSourceLike): boolean {
  return isJudgmentSource(s) && !bodyAcquired(s);
}

export interface MetadataOnlyHoldingGateReport {
  applied: boolean;
  metadata_only_judgment_refs: string[];
  stripped_ref_occurrences: number;
  blocks_stripped: number;
  blocks_left_unsupported: number;
  unsupported_block_samples: string[];
  reference_only_sources: Array<{
    ref: string;
    candidate_id: string;
    title: string;
    url: string | null;
  }>;
  source_split: {
    read_in_full: string[];
    reference_only: string[];
  };
  source_split_counts: {
    read_in_full: number;
    reference_only: number;
  };
  /** Invariant: must stay 0 — metadata-only refs surviving in the draft. */
  metadata_only_holdings_remaining: number;
}

export function emptyGateReport(): MetadataOnlyHoldingGateReport {
  return {
    applied: false,
    metadata_only_judgment_refs: [],
    stripped_ref_occurrences: 0,
    blocks_stripped: 0,
    blocks_left_unsupported: 0,
    unsupported_block_samples: [],
    reference_only_sources: [],
    source_split: { read_in_full: [], reference_only: [] },
    source_split_counts: { read_in_full: 0, reference_only: 0 },
    metadata_only_holdings_remaining: 0,
  };
}

const REFERENCE_ONLY_HEADING = "מקורות שאותרו אך גופם לא נקרא (לעיון בלבד)";

export function referenceOnlySection(
  sources: Array<{ title: string; url: string | null }>,
): string {
  if (sources.length === 0) return "";
  const lines = [
    "",
    `**${REFERENCE_ONLY_HEADING}**`,
    "",
    "פסקי הדין הבאים אותרו במהלך החיפוש, אך גוף פסק הדין עצמו לא נקרא ולכן לא נגזרה מהם הלכה, יישום או סייג:",
  ];
  for (const s of sources) {
    lines.push(`- ${s.title}${s.url ? ` — ${s.url}` : ""}`);
  }
  return lines.join("\n");
}

/**
 * Strip metadata-only judgment refs from every cited segment of the draft.
 * Returns a new draft (input is not mutated) plus a report.
 */
export function applyMetadataOnlyHoldingGate(
  draft: StructuredDraft | null,
  inputSources: GateSourceLike[],
): { draft: StructuredDraft | null; report: MetadataOnlyHoldingGateReport } {
  const report = emptyGateReport();

  const judgmentSources = inputSources.filter((s) => isJudgmentSource(s));
  const metaOnly = judgmentSources.filter((s) => isMetadataOnlyJudgment(s));
  const metaRefs = new Set(metaOnly.map((s) => s.ref));

  report.metadata_only_judgment_refs = [...metaRefs];
  report.source_split.read_in_full = judgmentSources
    .filter((s) => bodyAcquired(s))
    .map((s) => s.ref);
  report.source_split.reference_only = [...metaRefs];
  report.source_split_counts = {
    read_in_full: report.source_split.read_in_full.length,
    reference_only: report.source_split.reference_only.length,
  };

  if (!draft) return { draft, report };
  if (metaRefs.size === 0) {
    report.applied = true;
    return { draft, report };
  }

  const usedMetaRefs = new Set<string>();
  const blocks = draft.blocks.map((b) => {
    if (b.kind === "heading") return b;
    const refs = b.source_refs ?? [];
    const kept = refs.filter((r) => !metaRefs.has(r));
    if (kept.length === refs.length) return b;
    for (const r of refs) if (metaRefs.has(r)) usedMetaRefs.add(r);
    report.stripped_ref_occurrences += refs.length - kept.length;
    report.blocks_stripped += 1;
    if (kept.length === 0) {
      report.blocks_left_unsupported += 1;
      if (report.unsupported_block_samples.length < 5) {
        report.unsupported_block_samples.push(b.text.slice(0, 160));
      }
    }
    return { ...b, source_refs: kept };
  });

  const nextDraft: StructuredDraft = { blocks };

  // Invariant check on the rewritten draft.
  let remaining = 0;
  for (const b of nextDraft.blocks) {
    if (b.kind === "heading") continue;
    for (const r of b.source_refs ?? []) if (metaRefs.has(r)) remaining += 1;
  }
  report.metadata_only_holdings_remaining = remaining;

  // Reference-only disclosure list: only sources the model actually tried to
  // lean on (they are otherwise invisible to the reader).
  report.reference_only_sources = metaOnly
    .filter((s) => usedMetaRefs.has(s.ref))
    .map((s) => ({
      ref: s.ref,
      candidate_id: s.candidate_id,
      title: s.title,
      url: s.url ?? null,
    }));

  report.applied = true;
  return { draft: nextDraft, report };
}
