// V2.1 — deterministic footnote builder.
// Input: a validated StructuredDraft + the same DrafterInputSource[] passed
// to the model. Output: Hebrew markdown with superscript markers placed by
// code, plus footnotes and used_sources lists.
//
// Guarantees by construction:
//   * answer_markdown contains exactly one superscript marker per cited
//     paragraph/list_item segment (compound footnote when multiple sources).
//   * No two markers are adjacent (each marker sits on its own line/segment
//     because we emit at most one per block).
//   * Marker is placed AFTER trailing punctuation.
//   * Every footnote maps to ≥1 verified source.
//   * used_sources[].candidate_id ⊆ verifier.usable (because allowedRefs are
//     derived from inputSources, which themselves are built from
//     verifier.usable).
//   * Numbering is chronological by first appearance.

import type { Footnote, UsedSource } from "../lib/types.ts";
import type { DrafterInputSource } from "./drafter.ts";
import type { StructuredBlock, StructuredDraft } from "./structuredValidation.ts";

const SUP_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";
function toSuperscript(n: number): string {
  return String(n).split("").map((d) => SUP_DIGITS[Number(d)] ?? d).join("");
}

const TRAILING_PUNCT_RE = /[.!?:;,]$/u;

export interface BuildResult {
  answer_markdown: string;
  footnotes: Footnote[];
  used_sources: UsedSource[];
  builder_report: {
    paragraph_count: number;
    list_item_count: number;
    heading_count: number;
    cited_segment_count: number;
    compound_segment_count: number;
    marker_count: number;
    distinct_source_count: number;
    compound_footnote_count: number;
    adjacent_marker_count: number; // invariant: must be 0
    avg_sources_per_cited_segment: number;
  };
}

interface MarkerEntry {
  // key for de-dup: single source uses candidate_id; compound uses sorted joined ids
  key: string;
  number: number;
  // for footnote rendering
  title: string;
  url: string | null;
  source_type: string;
  // for used_sources mapping
  source_candidate_ids: string[];
  source_inputs: DrafterInputSource[];
}

function placeMarker(text: string, marker: string): string {
  // Place marker AFTER trailing punctuation if present, otherwise after a
  // period we append. Keeps Hebrew prose readable.
  if (TRAILING_PUNCT_RE.test(text)) return text + marker;
  return text + "." + marker;
}

export function buildFootnotedAnswer(
  draft: StructuredDraft,
  inputSources: DrafterInputSource[],
): BuildResult {
  const inputByRef = new Map(inputSources.map((s) => [s.ref, s]));

  // Allocate fn numbers by first-appearance order over (key) = single id OR
  // sorted joined ids for compound.
  const keyToEntry = new Map<string, MarkerEntry>();
  const entriesInOrder: MarkerEntry[] = [];

  // First pass: assign numbers.
  for (const b of draft.blocks) {
    if (b.kind === "heading") continue;
    if (b.source_refs.length === 0) continue;
    const resolved = b.source_refs
      .map((r) => inputByRef.get(r))
      .filter((s): s is DrafterInputSource => !!s);
    if (resolved.length === 0) continue;
    // De-dup within one segment (model may repeat a ref).
    const seen = new Set<string>();
    const distinct: DrafterInputSource[] = [];
    for (const s of resolved) {
      if (seen.has(s.candidate_id)) continue;
      seen.add(s.candidate_id);
      distinct.push(s);
    }
    const sortedIds = [...distinct.map((s) => s.candidate_id)].sort();
    const key = sortedIds.join("|");
    if (keyToEntry.has(key)) continue;
    const entry: MarkerEntry = {
      key,
      number: entriesInOrder.length + 1,
      title: distinct.length === 1
        ? distinct[0].title
        : distinct.map((s) => s.title).join("; "),
      // Footnote hygiene: even for compound footnotes, expose the first
      // sub-source URL as the top-level URL so downstream consumers/reports
      // never render `None`/`null`. Full per-source URL list remains in
      // `source_inputs`/`sources`.
      url: distinct.length === 1
        ? distinct[0].url
        : (distinct.find((s) => s.url)?.url ?? null),
      source_type: distinct.length === 1 ? distinct[0].source_type : "compound",
      source_candidate_ids: distinct.map((s) => s.candidate_id),
      source_inputs: distinct,
    };
    keyToEntry.set(key, entry);
    entriesInOrder.push(entry);
  }

  // Second pass: render markdown.
  const out: string[] = [];
  let paragraph_count = 0;
  let list_item_count = 0;
  let heading_count = 0;
  let cited_segment_count = 0;
  let compound_segment_count = 0;
  let marker_count = 0;

  const renderSegment = (block: Extract<StructuredBlock, { source_refs: string[] }>): string => {
    let text = block.text.trim();
    if (block.source_refs.length === 0) {
      return text;
    }
    const resolved = block.source_refs
      .map((r) => inputByRef.get(r))
      .filter((s): s is DrafterInputSource => !!s);
    if (resolved.length === 0) return text;
    const seen = new Set<string>();
    const distinct: DrafterInputSource[] = [];
    for (const s of resolved) {
      if (seen.has(s.candidate_id)) continue;
      seen.add(s.candidate_id);
      distinct.push(s);
    }
    const sortedIds = [...distinct.map((s) => s.candidate_id)].sort();
    const key = sortedIds.join("|");
    const entry = keyToEntry.get(key);
    if (!entry) return text;
    cited_segment_count++;
    if (distinct.length > 1) compound_segment_count++;
    marker_count++;
    return placeMarker(text, toSuperscript(entry.number));
  };

  for (const b of draft.blocks) {
    if (b.kind === "heading") {
      heading_count++;
      out.push(`**${b.text.trim()}**`);
    } else if (b.kind === "paragraph") {
      paragraph_count++;
      out.push(renderSegment(b));
    } else if (b.kind === "list_item") {
      list_item_count++;
      out.push(`- ${renderSegment(b)}`);
    }
  }

  // Group consecutive list_items together (no blank line between), but
  // separate paragraphs/headings with a blank line.
  const joined: string[] = [];
  for (let i = 0; i < out.length; i++) {
    const line = out[i];
    const isList = line.startsWith("- ");
    const prevIsList = i > 0 && out[i - 1].startsWith("- ");
    if (isList && prevIsList) {
      joined[joined.length - 1] = joined[joined.length - 1] + "\n" + line;
    } else {
      joined.push(line);
    }
  }
  const answer_markdown = joined.join("\n\n");

  // Footnotes (chronological).
  const footnotes: Footnote[] = entriesInOrder.map((e) => ({
    number: e.number,
    title: e.title,
    url: e.url,
    source_type: e.source_type,
    sources: e.source_inputs.map((s) => ({
      title: s.title,
      url: s.url,
      source_type: s.source_type,
    })),
  }));

  // used_sources: one entry per (candidate_id) with the number of the entry
  // that first carries it. (For compound footnotes, multiple candidate_ids
  // share the same number — this matches V2's compound semantics.)
  const usedSeen = new Set<string>();
  const used_sources: UsedSource[] = [];
  for (const e of entriesInOrder) {
    for (const s of e.source_inputs) {
      if (usedSeen.has(s.candidate_id)) continue;
      usedSeen.add(s.candidate_id);
      used_sources.push({
        candidate_id: s.candidate_id,
        number: e.number,
        title: s.title,
        url: s.url,
        source_type: s.source_type,
        origin: s.origin as UsedSource["origin"],
      });
    }
  }

  // Adjacent marker invariant check (telemetry only — must be 0).
  // A "marker" is a maximal superscript run (so multi-digit numerals like
  // ¹⁰, ¹¹, ¹² count as ONE marker, not two). Adjacency means two such
  // markers separated by nothing but whitespace — which the builder cannot
  // produce by construction, because every emitted marker is followed by
  // either a block boundary or body text from the next segment.
  const SUP_RUN_RE = /[\u2070-\u209F\u00B2\u00B3\u00B9]+/gu;
  let adjacent_marker_count = 0;
  let prevEnd = -1;
  for (const m of answer_markdown.matchAll(SUP_RUN_RE)) {
    const start = (m.index ?? 0);
    if (prevEnd >= 0) {
      const between = answer_markdown.slice(prevEnd, start);
      if (/^\s*$/.test(between)) adjacent_marker_count++;
    }
    prevEnd = start + m[0].length;
  }

  const totalRefs = entriesInOrder.reduce((s, e) => s + e.source_candidate_ids.length, 0);
  const compound_footnote_count = entriesInOrder.filter((e) => e.source_candidate_ids.length > 1).length;

  return {
    answer_markdown,
    footnotes,
    used_sources,
    builder_report: {
      paragraph_count,
      list_item_count,
      heading_count,
      cited_segment_count,
      compound_segment_count,
      marker_count,
      distinct_source_count: used_sources.length,
      compound_footnote_count,
      adjacent_marker_count,
      avg_sources_per_cited_segment:
        cited_segment_count > 0 ? totalRefs / entriesInOrder.length : 0,
    },
  };
}
