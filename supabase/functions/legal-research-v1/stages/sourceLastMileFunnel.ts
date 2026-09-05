/**
 * canonical_registry_discovery_and_representative_source_use_v1 — fix 5.
 *
 * Per-source last-mile diagnostics: for every source that reached the drafter
 * pack, record where it stopped on the way to the final answer. Report-only —
 * this module reads state, never changes a draft, a gate or a footnote.
 */

import type { DrafterInputSource } from "./drafter.ts";
import type { StructuredDraft } from "./structuredValidation.ts";
import type { RepresentativeSourceReport } from "./representativeSourceSelection.ts";

export const SOURCE_LAST_MILE_VERSION =
  "canonical_registry_discovery_and_representative_source_use_v1";

export type LossStage =
  | "none"
  | "not_selected_as_representative"
  | "not_emitted_by_drafter"
  | "dropped_by_claim_source_match"
  | "dropped_by_alignment"
  | "dropped_before_footnotes";

export interface SourceLastMileRow {
  run_id: string | null;
  source_id: string;
  title: string;
  source_type: string;
  role: string;
  found: boolean;
  admitted: boolean;
  body_acquired: boolean;
  in_pack: boolean;
  representative_selected: boolean;
  emitted_by_drafter: boolean;
  survived_csm: boolean;
  survived_alignment: boolean;
  final_cited: boolean;
  loss_stage: LossStage;
  loss_reason: string | null;
}

export interface SourceLastMileFunnelReport {
  version: string;
  run_id: string | null;
  rows: SourceLastMileRow[];
  counts: {
    in_pack: number;
    body_acquired: number;
    representative_selected: number;
    emitted_by_drafter: number;
    survived_csm: number;
    survived_alignment: number;
    final_cited: number;
  };
}

export interface SourceLastMileInput {
  run_id?: string | null;
  sources: DrafterInputSource[];
  representative: RepresentativeSourceReport | null;
  /** Draft as the model produced it (pre-gate). */
  rawDraft: StructuredDraft | null;
  /** Draft after claim_source_match. */
  postCsmDraft: StructuredDraft | null;
  /** Draft after topic-aware alignment. */
  postAlignmentDraft: StructuredDraft | null;
  /** Refs that actually carry a footnote in the rendered answer. */
  citedRefs: string[];
}

function refsOf(draft: StructuredDraft | null): Set<string> {
  const out = new Set<string>();
  for (const b of draft?.blocks ?? []) {
    if (b.kind === "heading") continue;
    for (const r of b.source_refs ?? []) out.add(r);
  }
  return out;
}

export function buildSourceLastMileFunnel(
  input: SourceLastMileInput,
): SourceLastMileFunnelReport {
  const representativeRefs = new Set(
    Object.values(input.representative?.by_claim ?? {}).flat(),
  );
  const emitted = refsOf(input.rawDraft);
  const postCsm = refsOf(input.postCsmDraft);
  const postAlign = refsOf(input.postAlignmentDraft);
  const cited = new Set(input.citedRefs);

  const rows: SourceLastMileRow[] = input.sources.map((s) => {
    const emitted_by_drafter = emitted.has(s.ref);
    const survived_csm = postCsm.has(s.ref);
    const survived_alignment = postAlign.has(s.ref);
    const final_cited = cited.has(s.ref);
    let loss_stage: LossStage = "none";
    let loss_reason: string | null = null;
    if (!final_cited) {
      if (!emitted_by_drafter) {
        loss_stage = representativeRefs.has(s.ref)
          ? "not_emitted_by_drafter"
          : "not_selected_as_representative";
        loss_reason = representativeRefs.has(s.ref)
          ? "representative_source_not_cited_by_model"
          : s.body_acquired === true
          ? "in_pack_but_not_chosen_by_model"
          : "no_acquired_body_or_weak_fit";
      } else if (!survived_csm) {
        loss_stage = "dropped_by_claim_source_match";
        loss_reason = "claim_source_match_removed_ref";
      } else if (!survived_alignment) {
        loss_stage = "dropped_by_alignment";
        loss_reason = "topic_aware_alignment_removed_ref";
      } else {
        loss_stage = "dropped_before_footnotes";
        loss_reason = "footnote_builder_or_reference_only";
      }
    }
    return {
      run_id: input.run_id ?? null,
      source_id: s.ref,
      title: s.title,
      source_type: String(s.source_type ?? ""),
      role: String(s.role ?? ""),
      found: true,
      admitted: true,
      body_acquired: s.body_acquired === true ||
        /full_text|substantive_excerpt/.test(String(s.text_usability ?? "")),
      in_pack: true,
      representative_selected: representativeRefs.has(s.ref),
      emitted_by_drafter,
      survived_csm,
      survived_alignment,
      final_cited,
      loss_stage,
      loss_reason,
    };
  });

  return {
    version: SOURCE_LAST_MILE_VERSION,
    run_id: input.run_id ?? null,
    rows,
    counts: {
      in_pack: rows.length,
      body_acquired: rows.filter((r) => r.body_acquired).length,
      representative_selected: rows.filter((r) => r.representative_selected).length,
      emitted_by_drafter: rows.filter((r) => r.emitted_by_drafter).length,
      survived_csm: rows.filter((r) => r.survived_csm).length,
      survived_alignment: rows.filter((r) => r.survived_alignment).length,
      final_cited: rows.filter((r) => r.final_cited).length,
    },
  };
}
