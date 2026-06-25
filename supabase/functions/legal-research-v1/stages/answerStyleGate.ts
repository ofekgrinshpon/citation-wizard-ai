// Phase C — Answer-style quality gate (REPORT-ONLY).
//
// Evaluates a finished drafter result against style/quality heuristics.
// Does NOT trigger any retry or rewrite — purely telemetry for now.
//
// Triggers reported:
//   * unsafe_display_title          — any source's display_title is fallback
//   * broken_hebrew_denylist        — denylist phrase found in answer
//   * compound_footnote_ratio_high  — > 0.30 of footnotes are compound (>=2 sources)
//   * avg_sources_per_block_high    — > 1.6 average sources per cited block
//   * excessive_headings            — > 0.25 of blocks are headings, or > 5 headings total
//   * partial_supported_strong_claim — strong-language phrase in a paragraph
//     whose source_refs all map to `partial` support.

import type { Footnote } from "../lib/types.ts";
import type { DrafterInputSource } from "./drafter.ts";
import type { StructuredDraft } from "./structuredValidation.ts";
import type { DisplayTitleStatus } from "./displayTitleHygiene.ts";

export const STYLE_DENYLIST: readonly string[] = [
  "פוקודה",
  "המסקנהיות",
  "כלים עיליים",
  "הדין הפרשני האקטיבי",
  "כלי עובדני",
];

const STRONG_LANGUAGE: readonly string[] = [
  "מכאן נובע",
  "ברור כי",
  "הדבר מחייב",
  "המסקנה היא",
  "יש לקבוע",
  "המקורות מוכיחים",
  "אין ספק",
  "ודאי כי",
];

export interface AnswerStyleReport {
  triggered_reasons: string[];
  metrics: {
    unsafe_display_title_count: number;
    unsafe_display_title_examples: Array<{
      ref: string;
      status: DisplayTitleStatus;
      display_title: string;
    }>;
    denylist_hits: Array<{ phrase: string; index: number }>;
    compound_footnote_count: number;
    total_footnote_count: number;
    compound_footnote_ratio: number;
    cited_block_count: number;
    total_source_refs_in_cited_blocks: number;
    avg_sources_per_cited_block: number;
    heading_count: number;
    block_count: number;
    heading_ratio: number;
    partial_supported_strong_claims: Array<{
      phrase: string;
      block_text_excerpt: string;
      partial_refs: string[];
    }>;
  };
  report_only: true;
}

export interface AnswerStyleInput {
  answer: string;
  draft: StructuredDraft | null;
  footnotes: Footnote[];
  inputSources: DrafterInputSource[];
}

export function evaluateAnswerStyle(input: AnswerStyleInput): AnswerStyleReport {
  const reasons: string[] = [];
  const sourceByRef = new Map(input.inputSources.map((s) => [s.ref, s]));

  // ── Unsafe display titles ────────────────────────────────────────────────
  // We rely on the caller to mark display_title via the title_status attached
  // to each input source. We look at the optional title_status field.
  const unsafeExamples: AnswerStyleReport["metrics"]["unsafe_display_title_examples"] = [];
  for (const s of input.inputSources) {
    const status = (s as unknown as { title_status?: DisplayTitleStatus }).title_status;
    if (status && status !== "ok") {
      unsafeExamples.push({
        ref: s.ref,
        status,
        display_title: s.title, // by this point .title is already the display_title
      });
    }
  }
  if (unsafeExamples.length > 0) reasons.push("unsafe_display_title");

  // ── Denylist ─────────────────────────────────────────────────────────────
  const denylistHits: Array<{ phrase: string; index: number }> = [];
  for (const phrase of STYLE_DENYLIST) {
    let idx = input.answer.indexOf(phrase);
    while (idx !== -1) {
      denylistHits.push({ phrase, index: idx });
      idx = input.answer.indexOf(phrase, idx + phrase.length);
    }
  }
  if (denylistHits.length > 0) reasons.push("broken_hebrew_denylist");

  // ── Compound footnote ratio ──────────────────────────────────────────────
  const totalFn = input.footnotes.length;
  const compoundFn = input.footnotes.filter(
    (f) => Array.isArray(f.sources) && f.sources.length > 1,
  ).length;
  const compoundRatio = totalFn > 0 ? compoundFn / totalFn : 0;
  if (compoundRatio > 0.3) reasons.push("compound_footnote_ratio_high");

  // ── Avg sources per cited block / heading density ────────────────────────
  let citedBlockCount = 0;
  let totalRefsInCited = 0;
  let headingCount = 0;
  let blockCount = 0;
  const partialStrong: AnswerStyleReport["metrics"]["partial_supported_strong_claims"] = [];

  if (input.draft) {
    for (const b of input.draft.blocks) {
      blockCount++;
      if (b.kind === "heading") {
        headingCount++;
        continue;
      }
      const refs = b.source_refs ?? [];
      if (refs.length === 0) continue;
      citedBlockCount++;
      totalRefsInCited += refs.length;

      // Partial-supported strong-claim check.
      const allPartial = refs.length > 0 && refs.every((r) => {
        const s = sourceByRef.get(r);
        return s ? s.best_support === "partial" : false;
      });
      if (allPartial) {
        for (const phrase of STRONG_LANGUAGE) {
          if (b.text.includes(phrase)) {
            partialStrong.push({
              phrase,
              block_text_excerpt: b.text.slice(0, 160),
              partial_refs: refs,
            });
          }
        }
      }
    }
  }
  const avgPerBlock = citedBlockCount > 0 ? totalRefsInCited / citedBlockCount : 0;
  if (avgPerBlock > 1.6) reasons.push("avg_sources_per_block_high");
  const headingRatio = blockCount > 0 ? headingCount / blockCount : 0;
  if (headingCount > 5 || headingRatio > 0.25) reasons.push("excessive_headings");
  if (partialStrong.length > 0) reasons.push("partial_supported_strong_claim");

  return {
    triggered_reasons: Array.from(new Set(reasons)),
    metrics: {
      unsafe_display_title_count: unsafeExamples.length,
      unsafe_display_title_examples: unsafeExamples.slice(0, 10),
      denylist_hits: denylistHits.slice(0, 20),
      compound_footnote_count: compoundFn,
      total_footnote_count: totalFn,
      compound_footnote_ratio: Number(compoundRatio.toFixed(3)),
      cited_block_count: citedBlockCount,
      total_source_refs_in_cited_blocks: totalRefsInCited,
      avg_sources_per_cited_block: Number(avgPerBlock.toFixed(3)),
      heading_count: headingCount,
      block_count: blockCount,
      heading_ratio: Number(headingRatio.toFixed(3)),
      partial_supported_strong_claims: partialStrong.slice(0, 10),
    },
    report_only: true,
  };
}
