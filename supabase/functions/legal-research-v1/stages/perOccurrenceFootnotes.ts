// footnote_density_v1_part_a_per_occurrence_emission
//
// Pure helpers that convert a block-level list of ALREADY-APPROVED sources
// (post CSM / topic-aware alignment / integrity gates) into per-occurrence
// footnote groups anchored at the sentence they support.
//
// Safety: this module NEVER adds, revives or reorders-in sources. Its input is
// exactly the list the block-level compound footnote would have rendered; the
// only change is *where* and *how many markers* those same sources produce.

export interface OccurrenceGroup {
  /** index into the sentence array returned by splitSentences() */
  sentence_index: number;
  /** subset of the block's approved sources rendered at this sentence */
  source_indices: number[];
}

export interface BlockEmissionTelemetry {
  block_id: number;
  refs_available_after_csm: number;
  refs_rendered_before: number;
  refs_rendered_after: number;
  compound_before: number;
  compound_after: number;
  split_count: number;
  dropped_weak_companions: number;
  per_occurrence_markers: number;
}

/** Max distinct sources rendered for one block (guardrail 4). */
export const MAX_SOURCES_PER_BLOCK = 3;
/** Max markers attached to a single sentence (guardrail 4). */
export const MAX_MARKERS_PER_SENTENCE = 2;

const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+/u;

/** Split Hebrew prose into sentences, preserving punctuation. Never returns []. */
export function splitSentences(text: string): string[] {
  const t = text.trim();
  if (!t) return [""];
  const parts = t.split(SENTENCE_SPLIT_RE).map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [t];
}

/**
 * Decide how a block's approved sources become footnote markers.
 *
 * - 1 source, or a single-sentence block → one group (compound preserved when
 *   the sources genuinely support the same single claim).
 * - multiple sources over multiple sentences → one marker per distinct source,
 *   spread over the sentences in source order, the last source anchored on the
 *   last sentence.
 */
export function planBlockOccurrences(
  sentences: string[],
  sourceCount: number,
): OccurrenceGroup[] {
  const n = Math.min(sourceCount, MAX_SOURCES_PER_BLOCK);
  if (n <= 0) return [];
  const sCount = sentences.length;
  if (n === 1 || sCount <= 1) {
    return [{ sentence_index: sCount - 1, source_indices: Array.from({ length: n }, (_, i) => i) }];
  }

  // Spread sources across sentences: source i → sentence ~ ((i+1)/n)*sCount - 1.
  const bySentence = new Map<number, number[]>();
  let prev = -1;
  for (let i = 0; i < n; i++) {
    let idx = Math.ceil(((i + 1) / n) * sCount) - 1;
    if (idx <= prev) idx = Math.min(prev + 1, sCount - 1);
    if (idx < 0) idx = 0;
    // respect the per-sentence marker cap
    const existing = bySentence.get(idx) ?? [];
    if (existing.length >= MAX_MARKERS_PER_SENTENCE && idx < sCount - 1) {
      idx = Math.min(idx + 1, sCount - 1);
    }
    const list = bySentence.get(idx) ?? [];
    list.push(i);
    bySentence.set(idx, list);
    prev = idx;
  }

  return [...bySentence.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([sentence_index, source_indices]) => ({ sentence_index, source_indices }));
}

/**
 * Clean multi-source footnote label. Never concatenates titles into one
 * garbled title string — sub-sources are separated by an explicit Hebrew
 * connector so the label reads as a list of distinct sources.
 */
export function compoundLabel(titles: string[]): string {
  const clean = titles.map((t) => (t ?? "").trim()).filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0];
  return `${clean[0]}; כן ראו: ${clean.slice(1).join("; ")}`;
}
